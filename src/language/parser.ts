import { createAgentlangServices } from '../language/agentlang-module.js';
import { EmptyFileSystem, LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import {
  CrudMap,
  Delete,
  Expr,
  ForEach,
  If,
  isWorkflow,
  Literal,
  LogicalExpression,
  Module,
  Pattern,
  RelationshipPattern,
  SetAttribute,
  Statement,
} from './generated/ast.js';
import { QuerySuffix } from '../runtime/util.js';
import {
  ArrayPattern,
  BasePattern,
  CrudPattern,
  DeletePattern,
  ExpressionPattern,
  ForEachPattern,
  FunctionCallPattern,
  IfPattern,
  LiteralPattern,
  LiteralPatternType,
} from './syntax.js';

const services = createAgentlangServices(EmptyFileSystem);
export const parse = parseHelper<Module>(services.Agentlang);

export async function introspect(s: string): Promise<BasePattern[]> {
  let result: BasePattern[] = [];
  await parse(`module Temp workflow Test {${s}}`).then((v: LangiumDocument<Module>) => {
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
    if (isWorkflow(v.parseResult.value.defs[0])) {
      result = introspectHelper(v.parseResult.value.defs[0].statements);
    } else {
      throw new Error(`Failed to parse statements`);
    }
  });
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
      crudMap.attributes.every((v: SetAttribute) => {
        return v.name.endsWith(QuerySuffix);
      })
    );
  }
  return false;
}

function introspectExpression(expr: Expr | LogicalExpression): string {
  if (expr.$cstNode) {
    return expr.$cstNode.text;
  }
  return '???';
}

function introspectQueryPattern(crudMap: CrudMap): CrudPattern {
  if (crudMap) {
    const cp: CrudPattern = new CrudPattern(crudMap.name);
    crudMap.attributes.forEach((sa: SetAttribute) => {
      cp.addAttribute(sa.name, new ExpressionPattern(introspectExpression(sa.value)), sa.op);
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
      cp.addAttribute(sa.name, new ExpressionPattern(introspectExpression(sa.value)));
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
    return new LiteralPattern(LiteralPatternType.ID, lit.id);
  } else if (lit.num) {
    return new LiteralPattern(LiteralPatternType.NUMBER, lit.num);
  } else if (lit.ref) {
    return new LiteralPattern(LiteralPatternType.REFERENCE, lit.ref);
  } else if (lit.str) {
    return new LiteralPattern(LiteralPatternType.STRING, lit.str);
  } else if (lit.bool) {
    return new LiteralPattern(LiteralPatternType.BOOLEAN, lit.bool);
  } else if (lit.fnCall) {
    return new FunctionCallPattern(
      lit.fnCall.name,
      lit.fnCall.args.map((v: Literal) => {
        return introspectLiteral(v);
      })
    );
  } else if (lit.array) {
    return new ArrayPattern(
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
  const ifp: IfPattern = new IfPattern(new ExpressionPattern(introspectExpression(ifpat.cond)));
  ifpat.statements.forEach((stmt: Statement) => {
    ifp.addPattern(introspectStatement(stmt));
  });
  if (ifpat.elseif) {
    ifp.setElseIf(introspectIf(ifpat.elseif));
  }
  if (ifpat.else) {
    ifp.setElseBody(
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
