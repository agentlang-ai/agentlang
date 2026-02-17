import {
  BasePattern,
  CrudPattern,
  DeletePattern,
  ExpressionPattern,
  ForEachPattern,
  FunctionCallPattern,
  IfPattern,
  JoinPattern,
  LiteralPattern,
  MapKey,
  ReferencePattern,
  ReturnPattern,
  newCreatePattern,
  newQueryPattern,
  newQueryUpdatePattern,
} from '../language/syntax.js';

// ── Type aliases ──

export type ValueExpr = BasePattern;
export type Statement = BasePattern;

export type QueryAttr = {
  value: ValueExpr;
  op?: string;
};

export type JoinSpec = {
  type: '@join' | '@inner_join' | '@left_join' | '@right_join' | '@full_join';
  entity: string;
  on: { lhs: string; rhs: string; op?: string };
};

export type CatchHandlers = {
  not_found?: Statement;
  error?: Statement;
};

export type WhereClause = {
  lhs: string;
  op?: string;
  rhs: ValueExpr;
};

// ── Extended CrudPattern with extra query options ──

class ExtendedCrudPattern extends CrudPattern {
  _upsert = false;
  _distinct = false;
  _where: WhereClause[] = [];
  _groupBy: string[] = [];
  _orderBy: { columns: string[]; order?: 'asc' | 'desc' } | undefined;
  _then: BasePattern[] = [];

  constructor(base: CrudPattern) {
    // Preserve the recordName exactly as-is (it already has ? if needed)
    super(base.recordName);
    this.attributes = base.attributes;
    this.relationships = base.relationships;
    this.joins = base.joins;
    this.into = base.into;
    this.isQuery = base.isQuery;
    this.isQueryUpdate = base.isQueryUpdate;
    this.isCreate = base.isCreate;
    this.alias = base.alias;
    this.aliases = base.aliases;
    this.handlers = base.handlers;
  }

  override toString(): string {
    // Build the core: {RecordName {attrs}, rels, joins, queryOptions, into}
    let s = `{${this.recordName} ${this.attributesAsStr()}`;

    const rs = this.relationshipsAsStr();
    if (rs) {
      s += `,\n${rs}`;
    }
    if (this.joins.length > 0) {
      const js = this.joins.map((jp) => joinPatternToStr(jp));
      s += `,\n${js.join(',\n')}`;
    }
    if (this._where.length > 0) {
      s += `,\n${whereToString(this._where)}`;
    }
    if (this._groupBy.length > 0) {
      s += `,\n@groupBy(${this._groupBy.join(', ')})`;
    }
    if (this._orderBy) {
      const orderSuffix = this._orderBy.order ? ` @${this._orderBy.order}` : '';
      s += `,\n@orderBy(${this._orderBy.columns.join(', ')})${orderSuffix}`;
    }
    const ins = this.intoAsStr();
    if (ins) {
      s += `,\n${ins}`;
    }
    if (this._upsert) {
      s += ', @upsert';
    }
    if (this._distinct) {
      s += ', @distinct';
    }
    s += '}';

    // Hints (@as, @catch) go after the closing }
    s += this.renderHints();

    // @then goes after hints
    if (this._then.length > 0) {
      const thenBody = this._then
        .map((t) => renderStatement(t))
        .join(';\n');
      s += `\n${INDENT}@then {\n${indentStr(thenBody, 2)}\n${INDENT}}`;
    }

    return s;
  }

  private renderHints(): string {
    let result = '';
    // @as alias
    if (this.alias) {
      result += ` @as ${this.alias}`;
    } else if (this.aliases) {
      result += ` @as [${this.aliases.join(',')}]`;
    }
    // @catch handlers
    if (this.handlers && this.handlers.size > 0) {
      let h = '@catch {';
      this.handlers.forEach((handler, k) => {
        h += `${k} ${handler.toString()}\n`;
      });
      h += '}';
      result += (result ? '\n' : '') + h;
    }
    return result;
  }

  private attributesAsStr(): string {
    const result: string[] = [];
    for (const ap of this.attributes) {
      result.push(`${ap.name}${ap.op ? ap.op : ''} ${ap.value.toString()}`);
    }
    return `{${result.join(', ')}}`;
  }

  private relationshipsAsStr(): string | undefined {
    if (!this.relationships) return undefined;
    const result: string[] = [];
    this.relationships.forEach((p, n) => {
      const ps = Array.isArray(p)
        ? `[${p.map((x) => renderStatement(x)).join(',')}]`
        : renderStatement(p);
      result.push(`${n} ${ps}`);
    });
    return result.join(',\n');
  }

  private intoAsStr(): string | undefined {
    if (!this.into) return undefined;
    const ss: string[] = [];
    this.into.forEach((attr, alias) => {
      ss.push(`${alias} ${attr}`);
    });
    return `@into {${ss.join(',\n')}}`;
  }
}

function joinPatternToStr(jp: JoinPattern): string {
  const opr = jp.conditionOperator === '=' ? '' : jp.conditionOperator;
  return `${jp.type} ${jp.targetEntity} {${jp.conditionLhs}${opr} ${jp.conditionRhs}}`;
}

function whereToString(clauses: WhereClause[]): string {
  const parts = clauses.map((c) => {
    const lhs = c.lhs.endsWith('?') ? c.lhs : c.lhs + '?';
    const op = c.op && c.op !== '=' ? c.op : '';
    return `${lhs}${op} ${c.rhs.toString()}`;
  });
  return `@where {${parts.join(', ')}}`;
}

function wrapExtended(cp: CrudPattern): ExtendedCrudPattern {
  return new ExtendedCrudPattern(cp);
}

// ── Value constructors ──

export function ref(record: string, member: string): ReferencePattern {
  return new ReferencePattern(record, member);
}

export function str(value: string): LiteralPattern {
  return LiteralPattern.String(value);
}

export function num(value: number): LiteralPattern {
  return LiteralPattern.Number(value);
}

export function bool(value: boolean): LiteralPattern {
  return LiteralPattern.Boolean(value);
}

export function id(value: string): LiteralPattern {
  return LiteralPattern.Id(value);
}

export function arr(values: ValueExpr[]): LiteralPattern {
  return LiteralPattern.Array(values);
}

export function map(entries: Record<string, ValueExpr>): LiteralPattern {
  const m = new Map<MapKey, BasePattern>();
  for (const [k, v] of Object.entries(entries)) {
    m.set({ str: k }, v);
  }
  return LiteralPattern.Map(m);
}

export function expr(expression: string): ExpressionPattern {
  return new ExpressionPattern(expression);
}

export function fnCall(name: string, args: ValueExpr[]): FunctionCallPattern {
  return new FunctionCallPattern(name, args);
}

export function asyncFnCall(name: string, args: ValueExpr[]): FunctionCallPattern {
  return new FunctionCallPattern(name, args).asAsync();
}

// ── CRUD pattern constructors ──

export interface CreateOptions {
  relationships?: Record<string, Statement | Statement[]>;
  upsert?: boolean;
  alias?: string | string[];
  catch?: CatchHandlers;
  then?: Statement[];
}

export function create(
  entityName: string,
  attributes: Record<string, ValueExpr>,
  options?: CreateOptions
): Statement {
  const cp = newCreatePattern(entityName);
  for (const [name, value] of Object.entries(attributes)) {
    cp.addAttribute(name, value);
  }
  const ext = wrapExtended(cp);
  applyCommonOptions(ext, options);
  if (options?.upsert) {
    ext._upsert = true;
  }
  if (options?.then) {
    ext._then = options.then;
  }
  return ext;
}

export interface QueryOptions {
  relationships?: Record<string, Statement | Statement[]>;
  joins?: JoinSpec[];
  into?: Record<string, string>;
  where?: WhereClause[];
  groupBy?: string[];
  orderBy?: { columns: string[]; order?: 'asc' | 'desc' };
  distinct?: boolean;
  alias?: string | string[];
  catch?: CatchHandlers;
  then?: Statement[];
}

export function query(
  entityName: string,
  attributes?: Record<string, QueryAttr>,
  options?: QueryOptions
): Statement {
  const cp = newQueryPattern(entityName);
  if (attributes) {
    for (const [name, attr] of Object.entries(attributes)) {
      const qname = name.endsWith('?') ? name : name + '?';
      cp.addAttribute(qname, attr.value, attr.op);
    }
  }
  const ext = wrapExtended(cp);
  if (options?.joins) {
    for (const join of options.joins) {
      const jp: JoinPattern = {
        type: join.type,
        targetEntity: join.entity,
        conditionLhs: join.on.lhs.endsWith('?') ? join.on.lhs : join.on.lhs + '?',
        conditionOperator: join.on.op || '=',
        conditionRhs: join.on.rhs,
      };
      ext.joins.push(jp);
    }
  }
  if (options?.into) {
    for (const [alias, attr] of Object.entries(options.into)) {
      ext.addInto(alias, attr);
    }
  }
  if (options?.where) {
    ext._where = options.where;
  }
  if (options?.groupBy) {
    ext._groupBy = options.groupBy;
  }
  if (options?.orderBy) {
    ext._orderBy = options.orderBy;
  }
  if (options?.distinct) {
    ext._distinct = true;
  }
  if (options?.then) {
    ext._then = options.then;
  }
  applyCommonOptions(ext, options);
  return ext;
}

export interface QueryUpdateOptions {
  alias?: string | string[];
  catch?: CatchHandlers;
  then?: Statement[];
}

export function queryUpdate(
  entityName: string,
  queryAttrs: Record<string, QueryAttr>,
  setAttrs: Record<string, ValueExpr>,
  options?: QueryUpdateOptions
): Statement {
  const cp = newQueryUpdatePattern(entityName);
  for (const [name, attr] of Object.entries(queryAttrs)) {
    const qname = name.endsWith('?') ? name : name + '?';
    cp.addAttribute(qname, attr.value, attr.op);
  }
  for (const [name, value] of Object.entries(setAttrs)) {
    cp.addAttribute(name, value);
  }
  const ext = wrapExtended(cp);
  applyCommonOptions(ext, options);
  if (options?.then) {
    ext._then = options.then;
  }
  return ext;
}

function applyCommonOptions(
  cp: CrudPattern,
  options?: {
    relationships?: Record<string, Statement | Statement[]>;
    alias?: string | string[];
    catch?: CatchHandlers;
  }
) {
  if (!options) return;
  if (options.relationships) {
    for (const [relName, relPattern] of Object.entries(options.relationships)) {
      if (Array.isArray(relPattern)) {
        cp.addRelationship(relName, relPattern as CrudPattern[]);
      } else {
        cp.addRelationship(relName, relPattern as CrudPattern);
      }
    }
  }
  if (options.alias) {
    if (Array.isArray(options.alias)) {
      cp.setAliases(options.alias);
    } else {
      cp.setAlias(options.alias);
    }
  }
  if (options.catch) {
    if (options.catch.not_found) {
      cp.addHandler('not_found', options.catch.not_found);
    }
    if (options.catch.error) {
      cp.addHandler('error', options.catch.error);
    }
  }
}

// ── Control flow ──

export function ifThen(
  condition: string | ValueExpr,
  body: Statement[],
  elseBody?: Statement[]
): Statement {
  const condPattern =
    typeof condition === 'string' ? new ExpressionPattern(condition) : condition;
  const ifp = new IfPattern(condPattern);
  for (const stmt of body) {
    ifp.addPattern(stmt);
  }
  if (elseBody) {
    ifp.setElse(elseBody);
  }
  return ifp;
}

export function forEach(variable: string, source: Statement, body: Statement[]): Statement {
  const fep = new ForEachPattern(variable, source);
  for (const stmt of body) {
    fep.addPattern(stmt);
  }
  return fep;
}

export function del(pattern: Statement): Statement {
  return new DeletePattern(pattern);
}

export class PurgePattern extends BasePattern {
  pattern: BasePattern;

  constructor(pattern: BasePattern) {
    super();
    this.pattern = pattern;
  }

  override toString(): string {
    return `purge ${this.pattern.toString()}`.concat(this.hintsAsString());
  }
}

export function purge(pattern: Statement): Statement {
  return new PurgePattern(pattern);
}

export function ret(pattern: Statement): Statement {
  return new ReturnPattern(pattern);
}

export class ThrowPattern extends BasePattern {
  reason: BasePattern;

  constructor(reason: BasePattern) {
    super();
    this.reason = reason;
  }

  override toString(): string {
    return `throw (${this.reason.toString()})`.concat(this.hintsAsString());
  }
}

export function throwError(reason: string | ValueExpr): Statement {
  const reasonPattern = typeof reason === 'string' ? new ExpressionPattern(reason) : reason;
  return new ThrowPattern(reasonPattern);
}

// ── Pretty-printing helpers ──

const INDENT = '    '; // 4 spaces

function indentStr(text: string, level: number): string {
  const prefix = INDENT.repeat(level);
  return text
    .split('\n')
    .map((line) => (line.trim() ? prefix + line : line))
    .join('\n');
}

function renderStatement(stmt: BasePattern): string {
  return stmt.toString();
}

function renderBody(body: Statement[], level: number): string {
  const lines = body.map((stmt) => renderStatement(stmt));
  const joined = lines.length > 1 ? lines.join(';\n') : lines[0] || '';
  return indentStr(joined, level);
}

// ── Workflow wrappers ──

export function workflow(
  name: string,
  body: Statement[],
  options?: { isPublic?: boolean; withRole?: string }
): string {
  const prefix = options?.isPublic ? '@public ' : '';
  const directives = options?.withRole ? ` @withRole(${options.withRole})` : '';
  const bodyStr = renderBody(body, 1);
  return `${prefix}workflow ${name}${directives} {\n${bodyStr}\n}`;
}

export function triggerWorkflow(
  tag: 'before' | 'after',
  operation: 'create' | 'update' | 'delete',
  entityName: string,
  body: Statement[],
  options?: { isPublic?: boolean; withRole?: string }
): string {
  const prefix = options?.isPublic ? '@public ' : '';
  const directives = options?.withRole ? ` @withRole(${options.withRole})` : '';
  const bodyStr = renderBody(body, 1);
  return `${prefix}workflow @${tag} ${operation}:${entityName}${directives} {\n${bodyStr}\n}`;
}
