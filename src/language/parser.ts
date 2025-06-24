import { createAgentlangServices } from '../language/agentlang-module.js';
import { EmptyFileSystem, LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import {
  CrudMap,
  Delete,
  Expr,
  ForEach,
  Group,
  If,
  isGroup,
  isLiteral,
  isPrimExpr,
  isWorkflowDefinition,
  Literal,
  ModuleDefinition,
  NegExpr,
  Pattern,
  PrimExpr,
  RelationshipPattern,
  SetAttribute,
  Statement,
} from './generated/ast.js';
import { QuerySuffix } from '../runtime/util.js';
import {
  BasePattern,
  CrudPattern,
  DeletePattern,
  ExpressionPattern,
  ForEachPattern,
  FunctionCallPattern,
  GroupExpressionPattern,
  IfPattern,
  LiteralPattern,
  NegExpressionPattern,
} from './syntax.js';

const services = createAgentlangServices(EmptyFileSystem);
export const parse = parseHelper<ModuleDefinition>(services.Agentlang);

export async function parseModule(moduleDef: string): Promise<ModuleDefinition> {
  const document = await parse(moduleDef, { validation: true });
  maybeRaiseParserErrors(document);
  return document.parseResult.value;
}

export async function parseStatement(stmt: string): Promise<Statement> {
  let result: Statement | undefined;
  const mod: ModuleDefinition = await parseModule(`module Temp\nworkflow TempEvent { ${stmt} }`);
  if (isWorkflowDefinition(mod.defs[0])) {
    result = mod.defs[0].statements[0];
  } else {
    throw new Error('Failed to extract workflow-statement');
  }
  if (result) {
    return result;
  } else {
    throw new Error('There was an error parsing the statement');
  }
}

function maybeRaiseParserErrors(document: LangiumDocument) {
  if (document.parseResult.lexerErrors.length > 0 || document.parseResult.parserErrors.length > 0) {
    const errs: Array<string> = [];
    document.parseResult.lexerErrors.forEach((v: any) => {
      errs.push(v.message);
    });
    document.parseResult.parserErrors.forEach((v: any) => {
      errs.push(v.message);
    });
    throw new Error(`There were parser errors: \n ${errs.join('\n')}`);
  }
}

export async function introspect(s: string): Promise<BasePattern[]> {
  let result: BasePattern[] = [];
  const v: LangiumDocument<ModuleDefinition> = await parse(`module Temp workflow Test {${s}}`);
  if (v.parseResult.lexerErrors.length > 0) {
    throw new Error(
      `Lexer errors: ${v.parseResult.lexerErrors
        .map((err: any) => {
          return err.message;
        })
        .join('\n')}`
    );
  }
  if (v.parseResult.parserErrors.length > 0) {
    throw new Error(
      `Parser errors: ${v.parseResult.parserErrors
        .map((err: any) => {
          return err.message;
        })
        .join('\n')}`
    );
  }
  if (isWorkflowDefinition(v.parseResult.value.defs[0])) {
    result = introspectHelper(v.parseResult.value.defs[0].statements);
  } else {
    throw new Error(`Failed to parse statements`);
  }
  return result;
}

function introspectHelper(stmts: Statement[]): BasePattern[] {
  const result: BasePattern[] = [];
  stmts.forEach((stmt: Statement) => {
    result.push(introspectStatement(stmt));
  });
  return result;
}

function introspectStatement(stmt: Statement): BasePattern {
  const r: BasePattern = introspectPattern(stmt.pattern);
  if (stmt.alias) {
    r.setAlias(stmt.alias);
  } else if (stmt.aliases.length > 0) {
    r.setAliases(stmt.aliases);
  }
  return r;
}

function introspectPattern(pat: Pattern): BasePattern {
  let r: BasePattern | undefined;
  if (pat.crudMap) {
    if (isQueryPattern(pat)) {
      r = introspectQueryPattern(pat.crudMap);
    } else {
      r = introspectCreatePattern(pat.crudMap);
    }
  } else if (pat.literal) {
    r = introspectLiteral(pat.literal);
  } else if (pat.forEach) {
    r = introspectForEach(pat.forEach);
  } else if (pat.if) {
    r = introspectIf(pat.if);
  } else if (pat.delete) {
    r = introspectDelete(pat.delete);
  }
  if (r) return r;
  else {
    throw new Error(`Failed to introspect pattern: ${pat}`);
  }
}

function isQueryPattern(pat: Pattern): boolean {
  if (pat.crudMap) {
    const crudMap: CrudMap = pat.crudMap;
    return (
      crudMap.name.endsWith(QuerySuffix) ||
      (crudMap.attributes.length > 0 &&
        crudMap.attributes.every((v: SetAttribute) => {
          return v.name.endsWith(QuerySuffix);
        }))
    );
  }
  return false;
}

function introspectGroup(expr: Group): GroupExpressionPattern {
  return new GroupExpressionPattern(introspectExpression(expr.ge) as ExpressionPattern);
}

function introspectNegExpr(expr: NegExpr): NegExpressionPattern {
  return new NegExpressionPattern(introspectExpression(expr.ne) as ExpressionPattern);
}

function introspectPrimExpr(expr: PrimExpr): BasePattern {
  if (isLiteral(expr)) {
    return introspectLiteral(expr);
  } else if (isGroup(expr)) {
    return introspectGroup(expr);
  } else {
    return introspectNegExpr(expr);
  }
}

function introspectExpression(expr: Expr | Expr): BasePattern {
  if (isPrimExpr(expr)) {
    return introspectPrimExpr(expr);
  }
  if (expr.$cstNode) {
    return new ExpressionPattern(expr.$cstNode.text);
  }
  throw new Error('Failed to introspect expression - ' + expr);
}

function introspectQueryPattern(crudMap: CrudMap): CrudPattern {
  if (crudMap) {
    const cp: CrudPattern = new CrudPattern(crudMap.name);
    crudMap.attributes.forEach((sa: SetAttribute) => {
      cp.addAttribute(sa.name, introspectExpression(sa.value), sa.op);
    });
    crudMap.relationships.forEach((rp: RelationshipPattern) => {
      cp.addRelationship(rp.name, introspectPattern(rp.pattern) as CrudPattern | CrudPattern[]);
    });
    cp.isQuery = true;
    return cp;
  }
  throw new Error(`Failed to introspect query-pattern: ${crudMap}`);
}

function introspectCreatePattern(crudMap: CrudMap): CrudPattern {
  if (crudMap) {
    const cp: CrudPattern = new CrudPattern(crudMap.name);
    crudMap.attributes.forEach((sa: SetAttribute) => {
      if (!cp.isQueryUpdate && sa.name.endsWith(QuerySuffix)) {
        cp.isQueryUpdate = true;
      }
      cp.addAttribute(sa.name, introspectExpression(sa.value), sa.op);
    });
    crudMap.relationships.forEach((rp: RelationshipPattern) => {
      cp.addRelationship(rp.name, introspectPattern(rp.pattern) as CrudPattern | CrudPattern[]);
    });
    if (!cp.isQueryUpdate) {
      cp.isCreate = true;
    }
    return cp;
  }
  throw new Error(`Failed to introspect create-pattern: ${crudMap}`);
}

function introspectLiteral(lit: Literal): BasePattern {
  if (lit.id) {
    return LiteralPattern.Id(lit.id);
  } else if (lit.num) {
    return LiteralPattern.Number(lit.num);
  } else if (lit.ref) {
    return LiteralPattern.Reference(lit.ref);
  } else if (lit.str) {
    return LiteralPattern.String(lit.str);
  } else if (lit.bool) {
    return LiteralPattern.Boolean(lit.bool == 'true' ? true : false);
  } else if (lit.fnCall) {
    return new FunctionCallPattern(
      lit.fnCall.name,
      lit.fnCall.args.map((v: Literal) => {
        return introspectLiteral(v);
      })
    );
  } else if (lit.array) {
    return LiteralPattern.Array(
      lit.array.vals.map((stmt: Statement) => {
        return introspectStatement(stmt);
      })
    );
  } else {
    throw new Error(`Invalid literal - ${lit}`);
  }
}

function introspectForEach(forEach: ForEach): ForEachPattern {
  const fp: ForEachPattern = new ForEachPattern(forEach.var, introspectPattern(forEach.src));
  forEach.statements.forEach((stmt: Statement) => {
    fp.addPattern(introspectStatement(stmt));
  });
  return fp;
}

function introspectIf(ifpat: If): IfPattern {
  const ifp: IfPattern = new IfPattern(introspectExpression(ifpat.cond));
  ifpat.statements.forEach((stmt: Statement) => {
    ifp.addPattern(introspectStatement(stmt));
  });
  if (ifpat.else) {
    ifp.setElse(
      ifpat.else.statements.map((stmt: Statement) => {
        return introspectStatement(stmt);
      })
    );
  }
  return ifp;
}

function introspectDelete(deletePat: Delete): DeletePattern {
  return new DeletePattern(introspectPattern(deletePat.pattern));
}
