import { createAgentlangServices } from '../language/agentlang-module.js';
import { AstNode, EmptyFileSystem, LangiumCoreServices, LangiumDocument, URI } from 'langium';
import {
  CrudMap,
  Delete,
  Expr,
  FnCall,
  ForEach,
  Group,
  Handler,
  If,
  isExpr,
  isGroup,
  isLiteral,
  isNegExpr,
  isNotExpr,
  isPrimExpr,
  isWorkflowDefinition,
  Literal,
  MapEntry,
  ModuleDefinition,
  NegExpr,
  NotExpr,
  Pattern,
  PrimExpr,
  RelationshipPattern,
  SelectIntoEntry,
  SelectIntoSpec,
  SetAttribute,
  Statement,
  WorkflowDefinition,
} from './generated/ast.js';
import { firstAliasSpec, firstCatchSpec, QuerySuffix } from '../runtime/util.js';
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
  NotExpressionPattern,
} from './syntax.js';

let nextDocumentId = 1;

export function parseHelper<T extends AstNode = AstNode>(
  services: LangiumCoreServices
): (input: string, options?: any) => Promise<LangiumDocument<T>> {
  const metaData = services.LanguageMetaData;
  const documentBuilder = services.shared.workspace.DocumentBuilder;
  return async (input: string, options?: any) => {
    const uri = URI.parse(
      options?.documentUri ?? `file:///${nextDocumentId++}${metaData.fileExtensions[0] ?? ''}`
    );
    const document = services.shared.workspace.LangiumDocumentFactory.fromString<T>(
      input,
      uri,
      options?.parserOptions
    );
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await documentBuilder.build([document], options);
    return document;
  };
}

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

export async function parseStatements(stmts: string[]): Promise<Statement[]> {
  const wf = await parseWorkflow(`workflow W {${stmts.join(';\n')}}`);
  return wf.statements;
}

export async function parseWorkflow(workflowDef: string): Promise<WorkflowDefinition> {
  const mod = await parseModule(`module Temp ${workflowDef}`);
  if (isWorkflowDefinition(mod.defs[0])) {
    return mod.defs[0] as WorkflowDefinition;
  } else {
    throw new Error(`Failed to generate workflow from ${workflowDef}`);
  }
}

export function maybeGetValidationErrors(document: LangiumDocument): string[] | undefined {
  const validationErrors = (document.diagnostics ?? []).filter(e => e.severity === 1);

  const sls = new Set<number>();
  const scs = new Set<number>();
  if (validationErrors.length > 0) {
    const lineErrs = new Array<string>();
    for (const validationError of validationErrors) {
      if (
        !sls.has(validationError.range.start.line) &&
        !scs.has(validationError.range.start.character)
      ) {
        const s = document.textDocument.getText(validationError.range);
        lineErrs.push(
          `Error on line ${validationError.range.start.line + 1}, column ${validationError.range.start.character + 1}, unexpected token(s) '${s}'`
        );
        sls.add(validationError.range.start.line);
        scs.add(validationError.range.start.character);
      }
    }

    return lineErrs;
  } else {
    return undefined;
  }
}

function maybeRaiseParserErrors(document: LangiumDocument) {
  const errs = maybeGetValidationErrors(document);
  if (errs) {
    throw new Error(errs.join('\n'));
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
  const aliasSpec = firstAliasSpec(stmt);
  if (aliasSpec) {
    if (aliasSpec.alias) {
      r.setAlias(aliasSpec.alias);
    } else if (aliasSpec.aliases.length > 0) {
      r.setAliases(aliasSpec.aliases);
    }
  }
  const catchSpec = firstCatchSpec(stmt);
  if (catchSpec) {
    catchSpec.handlers.forEach((h: Handler) => {
      r.addHandler(h.except, introspectStatement(h.stmt));
    });
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
    if (pat.crudMap.into) {
      r = introspectInto(pat.crudMap.into, r as CrudPattern);
    }
  } else if (pat.expr) {
    r = introspectExpression(pat.expr);
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

function introspectInto(intoSpec: SelectIntoSpec, p: CrudPattern): CrudPattern {
  intoSpec.entries.forEach((se: SelectIntoEntry) => {
    p.addInto(se.alias, se.attribute);
  });
  return p;
}

function isQueryPattern(pat: Pattern): boolean {
  if (pat.crudMap) {
    const crudMap: CrudMap = pat.crudMap;
    const r = crudMap.name.endsWith(QuerySuffix);
    if (!r && crudMap.body) {
      return (
        crudMap.body.attributes.length > 0 &&
        crudMap.body.attributes.every((v: SetAttribute) => {
          return v.name.endsWith(QuerySuffix);
        })
      );
    } else {
      return r;
    }
  }
  return false;
}

function introspectGroup(expr: Group): GroupExpressionPattern {
  return new GroupExpressionPattern(introspectExpression(expr.ge) as ExpressionPattern);
}

function introspectNegExpr(expr: NegExpr): NegExpressionPattern {
  return new NegExpressionPattern(introspectExpression(expr.ne) as ExpressionPattern);
}

function introspectNotExpr(expr: NotExpr): NotExpressionPattern {
  return new NotExpressionPattern(introspectExpression(expr.ne) as ExpressionPattern);
}

function introspectPrimExpr(expr: PrimExpr): BasePattern {
  if (isLiteral(expr)) {
    return introspectLiteral(expr);
  } else if (isGroup(expr)) {
    return introspectGroup(expr);
  } else if (isNegExpr(expr)) {
    return introspectNegExpr(expr);
  } else if (isNotExpr(expr)) {
    return introspectNotExpr(expr);
  } else {
    throw new Error(`Not a PrimExpr - ${expr}`);
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
    crudMap.body?.attributes.forEach((sa: SetAttribute) => {
      cp.addAttribute(sa.name, introspectExpression(sa.value), sa.op);
    });
    crudMap.relationships.forEach((rp: RelationshipPattern) => {
      cp.addRelationship(rp.name, introspectPattern(rp.pattern) as CrudPattern | CrudPattern[]);
    });
    cp.isCreate = false;
    cp.isQuery = true;
    return cp;
  }
  throw new Error(`Failed to introspect query-pattern: ${crudMap}`);
}

function introspectCreatePattern(crudMap: CrudMap): CrudPattern {
  if (crudMap) {
    const cp: CrudPattern = new CrudPattern(crudMap.name);
    cp.isCreate = false;
    crudMap.body?.attributes.forEach((sa: SetAttribute) => {
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

function asFnCallPattern(fnCall: FnCall): FunctionCallPattern {
  return new FunctionCallPattern(
    fnCall.name,
    fnCall.args.map((v: Literal | Expr) => {
      if (isExpr(v)) {
        return introspectExpression(v);
      } else {
        return introspectLiteral(v);
      }
    })
  );
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
    return asFnCallPattern(lit.fnCall);
  } else if (lit.asyncFnCall) {
    return asFnCallPattern(lit.asyncFnCall.fnCall).asAsync();
  } else if (lit.array) {
    return LiteralPattern.Array(
      lit.array.vals.map((stmt: Statement) => {
        return introspectStatement(stmt);
      })
    );
  } else if (lit.map) {
    const m = new Map<any, BasePattern>();
    lit.map.entries.forEach((me: MapEntry) => {
      m.set(me.key, introspectExpression(me.value));
    });
    return LiteralPattern.Map(m);
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
