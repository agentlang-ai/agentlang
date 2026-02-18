import { createAgentlangServices } from '../language/agentlang-module.js';
import { AstNode, EmptyFileSystem, LangiumCoreServices, LangiumDocument, URI } from 'langium';
import {
  CrudMap,
  Delete,
  Expr,
  FnCall,
  ForEach,
  FullTextSearch,
  Group,
  GroupByClause,
  Handler,
  If,
  isExpr,
  isGroup,
  isLiteral,
  isNegExpr,
  isNotExpr,
  isPrimExpr,
  isWorkflowDefinition,
  JoinSpec,
  LimitClause,
  Literal,
  MapEntry,
  MapLiteral,
  ModuleDefinition,
  NegExpr,
  NotExpr,
  OffsetClause,
  OrderByClause,
  Pattern,
  PrimExpr,
  QueryOption,
  RelationshipPattern,
  Return,
  SelectIntoEntry,
  SelectIntoSpec,
  SetAttribute,
  Statement,
  WhereSpec,
  WhereSpecClause,
  WorkflowDefinition,
} from './generated/ast.js';
import { firstAliasSpec, firstCatchSpec, isString, QuerySuffix } from '../runtime/util.js';
import {
  BasePattern,
  CrudPattern,
  DeletePattern,
  ExpressionPattern,
  ForEachPattern,
  FullTextSearchPattern,
  FunctionCallPattern,
  GroupExpressionPattern,
  IfPattern,
  JoinPattern,
  LiteralPattern,
  NegExpressionPattern,
  NotExpressionPattern,
  ReturnPattern,
  WhereSpecClausePattern,
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

const ErrorIndicator = '<-- ERROR';

export function maybeGetValidationErrors(
  document: LangiumDocument,
  lines?: string[]
): string[] | undefined {
  if (lines === undefined) {
    lines = document.textDocument.getText().split('\n');
  }
  const validationErrors = (document.diagnostics ?? []).filter(e => e.severity === 1);

  const sls = new Set<number>();
  const scs = new Set<number>();
  if (validationErrors.length > 0) {
    for (const validationError of validationErrors) {
      if (
        !sls.has(validationError.range.start.line) &&
        !scs.has(validationError.range.start.character)
      ) {
        const t = document.textDocument.getText(validationError.range);
        const s = `(${validationError.range.start.line + 1}:${validationError.range.start.character + 1}) unexpected token(s) '${t}'`;
        const ln = lines[validationError.range.start.line];
        if (ln.indexOf(ErrorIndicator) > 0) {
          lines[validationError.range.start.line] = `${ln}, ${s}`;
        } else {
          lines[validationError.range.start.line] = `${ln}    ${ErrorIndicator} ${s}`;
        }
        sls.add(validationError.range.start.line);
        scs.add(validationError.range.start.character);
      }
    }
    return trimErrorLines(lines);
  } else {
    return undefined;
  }
}

function trimErrorLines(lines: string[]): string[] {
  let startidx = 0;
  for (let i = 0; i < lines.length; ++i) {
    if (lines[i].indexOf(ErrorIndicator) > 0) {
      startidx = i;
      break;
    }
  }
  let endidx = startidx;
  for (let i = startidx + 1; i < lines.length; ++i) {
    if (lines[i].indexOf(ErrorIndicator) > 0) {
      endidx = i;
      break;
    }
  }
  if (startidx > 0) {
    --startidx;
  }
  if (endidx != lines.length) {
    ++endidx;
  }
  return lines.slice(startidx, endidx);
}

function trimErrorMessage(s: string): string {
  const start = s.indexOf('Expecting:');
  if (start >= 0) {
    const end = s.indexOf('but found:');
    if (end > 0) {
      return `Expecting a valid token sequence, ${s.substring(end)}`;
    }
  }
  return s;
}

export function maybeRaiseParserErrors(document: LangiumDocument) {
  const code = document.textDocument.getText();
  const lines = code.split('\n');
  let hasErrors = false;
  const errLines = new Set<number>();
  if (document.parseResult.lexerErrors.length > 0) {
    document.parseResult.lexerErrors.forEach((err: any) => {
      if (!errLines.has(err.line)) {
        const errMsg = trimErrorMessage(err.message);
        const s = `${ErrorIndicator} (${err.line}:${err.column}) ${errMsg}`;
        lines[err.line - 1] = `${lines[err.line - 1]}    ${s}`;
        errLines.add(err.line);
      }
    });
    hasErrors = true;
  }
  if (document.parseResult.parserErrors.length > 0) {
    document.parseResult.parserErrors.forEach((err: any) => {
      const errMsg = trimErrorMessage(err.message);
      if (err.token.startLine && err.token.endLine) {
        if (!errLines.has(err.token.startLine)) {
          const s = `${ErrorIndicator} (${err.token.startLine}:${err.token.startColumn}) ${errMsg}`;
          lines[err.token.endLine - 1] = `${lines[err.token.endLine - 1]}    ${s}`;
          lines.join('\n');
          errLines.add(err.token.startLine);
        }
      } else {
        lines.push(`ERROR: ${errMsg}`);
      }
    });
    hasErrors = true;
  }
  const errs = maybeGetValidationErrors(document, lines);
  if (hasErrors || errs !== undefined) {
    throw new Error(lines.join('\n'));
  }
}

export async function introspect(s: string): Promise<BasePattern[]> {
  let result: BasePattern[] = [];
  const v: LangiumDocument<ModuleDefinition> = await parse(`module Temp workflow Test {${s}}`);
  maybeRaiseParserErrors(v);
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
    const opts = extractQueryOptions(pat.crudMap);
    if (opts.into) {
      r = introspectInto(opts.into, r as CrudPattern);
    }
  } else if (pat.expr) {
    r = introspectExpression(pat.expr);
  } else if (pat.forEach) {
    r = introspectForEach(pat.forEach);
  } else if (pat.if) {
    r = introspectIf(pat.if);
  } else if (pat.delete) {
    r = introspectDelete(pat.delete);
  } else if (pat.return) {
    r = introspectReturn(pat.return);
  } else if (pat.fullTextSearch) {
    r = introspectFullTextSearch(pat.fullTextSearch);
  }
  if (r) return r;
  else {
    throw new Error(`Failed to introspect pattern: ${pat}`);
  }
}

function introspectInto(intoSpec: SelectIntoSpec, p: CrudPattern): CrudPattern {
  intoSpec.entries.forEach((se: SelectIntoEntry) => {
    if (se.attribute) p.addInto(se.alias, se.attribute);
    else if (se.aggregate) {
      const args = se.aggregate.args
        .map((s: string) => {
          return s;
        })
        .join(', ');
      p.addInto(se.alias, `@${se.aggregate?.name}(${args})`);
    }
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

function introspectExpression(expr: Expr | undefined): BasePattern {
  if (expr !== undefined) {
    if (isPrimExpr(expr)) {
      return introspectPrimExpr(expr);
    }
    if (expr.$cstNode) {
      return new ExpressionPattern(expr.$cstNode.text);
    }
  }
  throw new Error('Failed to introspect expression - ' + expr);
}

function introspectQueryPattern(crudMap: CrudMap): CrudPattern {
  if (crudMap) {
    const cp: CrudPattern = new CrudPattern(crudMap.name);
    crudMap.body?.attributes.forEach((sa: SetAttribute) => {
      cp.addAttribute(sa.name, introspectExpression(sa.value), sa.op);
    });
    const opts = extractQueryOptions(crudMap);
    crudMap.relationships?.forEach((rp: RelationshipPattern) => {
      cp.addRelationship(rp.name, introspectPattern(rp.pattern) as CrudPattern | CrudPattern[]);
    });
    opts.joins?.forEach((js: JoinSpec) => {
      const jp: JoinPattern = {
        type: js.type,
        targetEntity: js.name,
        conditionLhs: js.lhs,
        conditionOperator: js.op ? js.op : '=',
        conditionRhs: js.rhs,
      };
      cp.joins.push(jp);
    });
    if (opts.where?.clauses) {
      cp.where = new Array<WhereSpecClausePattern>();
      opts.where.clauses.forEach((wc: WhereSpecClause) => {
        cp.where?.push({ lhs: wc.lhs, op: wc.op || '=', rhs: wc.rhs.$cstNode?.text || '' });
      });
    }
    if (opts.groupByClause) {
      cp.groupBy = opts.groupByClause.colNames;
    }
    if (opts.orderByClause) {
      cp.orderBy = opts.orderByClause.colNames;
    }
    if (opts.limitClause) {
      cp.limit = opts.limitClause.value;
    }
    if (opts.offsetClause) {
      cp.offset = opts.offsetClause.value;
    }
    cp.isCreate = false;
    cp.isQueryUpdate = false;
    cp.isQuery = true;
    return cp;
  }
  throw new Error(`Failed to introspect query-pattern: ${crudMap}`);
}

export type ExtractedQueryOptions = {
  joins: JoinSpec[] | undefined;
  into: SelectIntoSpec | undefined;
  where: WhereSpec | undefined;
  groupByClause: GroupByClause | undefined;
  orderByClause: OrderByClause | undefined;
  limitClause: LimitClause | undefined;
  offsetClause: OffsetClause | undefined;
  upsert: '@upsert' | undefined;
  distinct: '@distinct' | undefined;
};

export function extractQueryOptions(crudMap: CrudMap): ExtractedQueryOptions {
  const r: ExtractedQueryOptions = {
    joins: undefined,
    into: undefined,
    where: undefined,
    groupByClause: undefined,
    orderByClause: undefined,
    limitClause: undefined,
    offsetClause: undefined,
    upsert: undefined,
    distinct: undefined,
  };
  crudMap.queryOptions.forEach((qo: QueryOption) => {
    if (qo.join) {
      if (r.joins === undefined) {
        r.joins = new Array<JoinSpec>();
      }
      r.joins.push(qo.join);
    } else if (qo.into) {
      r.into = qo.into;
    } else if (qo.where) {
      r.where = qo.where;
    } else if (qo.groupByClause) {
      r.groupByClause = qo.groupByClause;
    } else if (qo.orderByClause) {
      r.orderByClause = qo.orderByClause;
    } else if (qo.limitClause) {
      r.limitClause = qo.limitClause;
    } else if (qo.offsetClause) {
      r.offsetClause = qo.offsetClause;
    } else if (qo.upsert) {
      r.upsert = qo.upsert;
    } else if (qo.distinct) {
      r.distinct = qo.distinct;
    }
  });
  return r;
}

function introspectCreatePattern(crudMap: CrudMap): CrudPattern {
  if (crudMap) {
    const cp: CrudPattern = new CrudPattern(crudMap.name);
    cp.isCreate = false;
    cp.isQuery = false;
    let qup = false;
    crudMap.body?.attributes.forEach((sa: SetAttribute) => {
      if (!qup && sa.name.endsWith(QuerySuffix)) {
        qup = true;
      }
      cp.addAttribute(sa.name, introspectExpression(sa.value), sa.op);
    });
    crudMap.relationships?.forEach((rp: RelationshipPattern) => {
      cp.addRelationship(rp.name, introspectPattern(rp.pattern) as CrudPattern | CrudPattern[]);
    });
    cp.isQueryUpdate = qup;
    if (!qup) {
      cp.isCreate = true;
      cp.isQuery = false;
    } else {
      cp.isCreate = false;
      cp.isQuery = false;
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
  if (lit.id !== undefined) {
    return LiteralPattern.Id(lit.id);
  } else if (lit.num !== undefined) {
    return LiteralPattern.Number(lit.num);
  } else if (lit.ref !== undefined) {
    return LiteralPattern.Reference(lit.ref);
  } else if (lit.str !== undefined) {
    return LiteralPattern.String(lit.str);
  } else if (lit.bool !== undefined) {
    return LiteralPattern.Boolean(lit.bool == 'true' ? true : false);
  } else if (lit.fnCall !== undefined) {
    return asFnCallPattern(lit.fnCall);
  } else if (lit.asyncFnCall !== undefined) {
    return asFnCallPattern(lit.asyncFnCall.fnCall).asAsync();
  } else if (lit.array !== undefined) {
    return LiteralPattern.Array(
      lit.array.vals.map((stmt: Statement) => {
        return introspectStatement(stmt);
      })
    );
  } else if (lit.map !== undefined) {
    return introspectMapLiteral(lit.map);
  } else {
    throw new Error(`Invalid literal - ${lit}`);
  }
}

function introspectMapLiteral(mapLit: MapLiteral): LiteralPattern {
  const m = new Map<any, BasePattern>();
  mapLit.entries.forEach((me: MapEntry) => {
    m.set(me.key, introspectExpression(me.value));
  });
  return LiteralPattern.Map(m);
}

function introspectForEach(forEach: ForEach): ForEachPattern {
  const fp: ForEachPattern = new ForEachPattern(forEach.var, introspectPattern(forEach.src));
  forEach.statements.forEach((stmt: Statement) => {
    fp.addPattern(introspectStatement(stmt));
  });
  return fp;
}

export function introspectIf(ifpat: If): IfPattern {
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

function introspectReturn(returnPat: Return): ReturnPattern {
  return new ReturnPattern(introspectPattern(returnPat.pattern));
}

function introspectFullTextSearch(fullTextSearch: FullTextSearch): FullTextSearchPattern {
  let options: BasePattern | undefined = undefined;
  if (fullTextSearch.options) {
    options = introspectMapLiteral(fullTextSearch.options);
  }
  return new FullTextSearchPattern(
    fullTextSearch.name,
    introspectLiteral(fullTextSearch.query),
    options
  );
}

export type CasePattern = {
  condition: BasePattern;
  body: BasePattern;
};

export async function introspectCase(caseStr: string): Promise<CasePattern> {
  const s = `if ${caseStr.trim().substring(4).trimStart()}`;
  const pat = await introspect(s);
  const ifPat = pat[0] as IfPattern;
  return { condition: ifPat.condition, body: ifPat.body[0] };
}

export function canParse(s: string): boolean {
  const ts = s.trim();
  if (ts) {
    const contents = ts.substring(1, ts.length - 1).trim();
    return contents.length > 0;
  }
  return false;
}

export function objectToQueryPattern(obj: any): string {
  const strs = new Array<string>();
  Object.keys(obj).forEach((k: string) => {
    if (k.startsWith('@')) {
      const xs: any = obj[k];
      if (k.endsWith('join')) {
        xs.forEach((x: any[]) => {
          strs.push(`${k} ${x[0]} ${objectToQuerySpecPattern(x[1], true)}`);
        });
      } else if (k === '@groupBy' || k === '@orderBy') {
        strs.push(`${k} ( ${xs.join(', ')} )`);
      } else if (k === '@limit' || k === '@offset') {
        strs.push(`${k}(${xs})`);
      } else {
        strs.push(`${k} ${objectToQuerySpecPattern(xs, true)}`);
      }
    } else {
      strs.push(`${k} ${objectToQuerySpecPattern(obj[k])}`);
    }
  });
  return `{${strs.join(',\n')}}`;
}

function objectToQuerySpecPattern(obj: any, refMode: boolean = false): string {
  const strs = new Array<string>();
  Object.keys(obj).forEach((k: string) => {
    let v = obj[k];
    if (!refMode && isString(v) && !v.startsWith('@')) {
      v = `"${v}"`;
    }
    strs.push(`${k} ${v}`);
  });
  return `{${strs.join(', ')}}`;
}
