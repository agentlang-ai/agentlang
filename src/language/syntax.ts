import { parseHelper } from 'langium/test';
import { escapeQueryName } from '../runtime/util.js';
import { ModuleDefinition } from './generated/ast.js';
import { createAgentlangServices } from './agentlang-module.js';
import { EmptyFileSystem } from 'langium';

export class BasePattern {
  alias: string | undefined;
  aliases: string[] | undefined;
  handlers: Map<string, BasePattern> | undefined;

  setAlias(alias: string) {
    this.alias = alias;
    return this;
  }

  unsetAlias() {
    this.alias = undefined;
    return this;
  }

  addAlias(alias: string) {
    if (this.aliases == undefined) {
      this.aliases = [];
    }
    this.aliases.push(alias);
  }

  setAliases(aliases: string[]) {
    this.aliases = aliases;
  }

  addHandler(k: 'not_found' | 'error', handler: BasePattern) {
    if (this.handlers == undefined) {
      this.handlers = new Map();
    }
    this.handlers.set(k, handler);
  }

  private aliasesAsString(): string | undefined {
    if (this.alias) {
      return ` @as ${this.alias}`;
    } else if (this.aliases) {
      return ` @as [${this.aliases.join(',')}]`;
    } else {
      return undefined;
    }
  }

  private handlersAsString(): string | undefined {
    if (this.handlers) {
      let s = '{';
      this.handlers.forEach((handler: BasePattern, k: string) => {
        s = `${s} ${k} ${handler.toString()}\n`;
      });
      return s + '}';
    } else {
      return undefined;
    }
  }
  hintsAsString(): string {
    const a = this.aliasesAsString();
    const h = this.handlersAsString();
    if (!a && !h) return '';
    if (a && !h) return a;
    if (!a && h) return h;
    return `${a}\n${h}`;
  }

  toString(): string {
    return '';
  }
}

export const EmptyBasePattern = new BasePattern();

export enum LiteralPatternType {
  ID,
  NUMBER,
  BOOLEAN,
  STRING,
  REFERENCE,
  MAP,
  ARRAY,
}

export type MapKey = {
  str?: string;
  num?: number;
  bool?: boolean;
};

export class LiteralPattern extends BasePattern {
  type: LiteralPatternType;
  value: any;

  static EmptyArray = new LiteralPattern(LiteralPatternType.ARRAY, []);

  constructor(type: LiteralPatternType, value: any) {
    super();
    this.type = type;
    this.value = value;
  }

  static Id(value: string): LiteralPattern {
    return new LiteralPattern(LiteralPatternType.ID, value);
  }

  static Number(value: number): LiteralPattern {
    return new LiteralPattern(LiteralPatternType.NUMBER, value);
  }

  static Boolean(value: boolean): LiteralPattern {
    return new LiteralPattern(LiteralPatternType.BOOLEAN, value);
  }

  static String(value: string): LiteralPattern {
    return new LiteralPattern(LiteralPatternType.STRING, value);
  }

  static Reference(value: string): LiteralPattern {
    if (value.indexOf('.') < 0) {
      throw new Error(`${value} does not look like a reference`);
    }
    return new LiteralPattern(LiteralPatternType.REFERENCE, value);
  }

  static Map(value: Map<MapKey, BasePattern>): LiteralPattern {
    return new LiteralPattern(LiteralPatternType.MAP, value);
  }

  static Array(value: Array<BasePattern>): LiteralPattern {
    return new LiteralPattern(LiteralPatternType.ARRAY, value);
  }

  override toString(): string {
    let s = '';
    switch (this.type) {
      case LiteralPatternType.ARRAY: {
        const a = this.value as Array<BasePattern>;
        s = `[${a
          .map((v: BasePattern) => {
            return v.toString();
          })
          .join(', ')}]`;
        break;
      }
      case LiteralPatternType.MAP: {
        const m = this.value as Map<MapKey, BasePattern>;
        const arr = new Array<string>();
        m.forEach((v: BasePattern, key: any) => {
          let k: any = key.str;
          if (k == undefined) {
            k = key.num;
          } else {
            k = `"${k}"`;
          }
          if (k == undefined) {
            k = key.bool;
          }
          arr.push(`${k}: ${v.toString()}`);
        });
        s = `{${arr.join(', ')}}`;
        break;
      }
      case LiteralPatternType.STRING: {
        s = `"${this.value}"`;
        break;
      }
      default:
        s = this.value.toString();
    }
    return s.concat(this.hintsAsString());
  }
}

export function isLiteralPattern(p: BasePattern): boolean {
  return p instanceof LiteralPattern;
}

export function isReferenceLiteral(p: LiteralPattern): boolean {
  return p.type == LiteralPatternType.REFERENCE;
}

export function referenceParts(p: LiteralPattern): string[] | undefined {
  if (isReferenceLiteral(p)) {
    const s: string = p.value as string;
    return s.split('.');
  }
  return undefined;
}

export function isStringLiteral(p: LiteralPattern): boolean {
  return p.type == LiteralPatternType.STRING;
}

export function isNumberLiteral(p: LiteralPattern): boolean {
  return p.type == LiteralPatternType.NUMBER;
}

export function isBooleanLiteral(p: LiteralPattern): boolean {
  return p.type == LiteralPatternType.BOOLEAN;
}

export function isIdentifierLiteral(p: LiteralPattern): boolean {
  return p.type == LiteralPatternType.ID;
}

export function isArrayLiteral(p: LiteralPattern): boolean {
  return p.type == LiteralPatternType.ARRAY;
}

export function isMapLiteral(p: LiteralPattern): boolean {
  return p.type == LiteralPatternType.MAP;
}

export class FunctionCallPattern extends BasePattern {
  fnName: string;
  arguments: BasePattern[];
  isAsync: boolean = false;

  constructor(fnName: string, args: BasePattern[]) {
    super();
    this.fnName = fnName;
    this.arguments = args;
  }

  asAsync(): FunctionCallPattern {
    this.isAsync = true;
    return this;
  }

  override toString(): string {
    let s = '';
    if (this.arguments.length > 0) {
      const args: Array<string> = [];
      this.arguments.forEach((bp: BasePattern) => {
        args.push(bp.toString());
      });
      s = `${this.fnName}(${args.join(', ')})`;
    } else {
      s = `${this.fnName}()`;
    }
    s = s.concat(this.hintsAsString());
    if (this.isAsync) {
      return `await ${s}`;
    } else {
      return s;
    }
  }
}

export function isFunctionCallPattern(p: BasePattern): boolean {
  return p instanceof FunctionCallPattern;
}

export class ExpressionPattern extends BasePattern {
  expression: any;
  private static services: ReturnType<typeof createAgentlangServices> =
    createAgentlangServices(EmptyFileSystem);
  private static doParse = parseHelper<ModuleDefinition>(this.services.Agentlang);
  private static parse: ReturnType<typeof parseHelper<ModuleDefinition>> = (input: string) =>
    this.doParse(input, { validation: true });

  constructor(expression: any) {
    super();
    this.expression = expression;
  }

  static async Validated(exprString: string): Promise<ExpressionPattern> {
    const result = await ExpressionPattern.parse(
      `module Temp workflow Test { if (${exprString}) {} }`
    );
    if (result.parseResult.lexerErrors.length > 0) {
      throw new Error(result.parseResult.lexerErrors.join('\n'));
    }
    if (result.parseResult.parserErrors.length > 0) {
      throw new Error(result.parseResult.parserErrors.join('\n'));
    }
    return new ExpressionPattern(exprString);
  }

  override toString(): string {
    const s = this.expression.toString();
    return s.concat(this.hintsAsString());
  }
}

export function isExpressionPattern(p: BasePattern): boolean {
  return p instanceof ExpressionPattern;
}

export class GroupExpressionPattern extends BasePattern {
  expression: ExpressionPattern;

  constructor(expr: ExpressionPattern) {
    super();
    this.expression = expr;
  }

  override toString(): string {
    return `(${this.expression.toString()})`;
  }
}

export function isGroupExpressionPattern(p: BasePattern): boolean {
  return p instanceof GroupExpressionPattern;
}

export class NegExpressionPattern extends BasePattern {
  expression: ExpressionPattern;

  constructor(expr: ExpressionPattern) {
    super();
    this.expression = expr;
  }

  override toString(): string {
    return `-${this.expression.toString}`;
  }
}

export class NotExpressionPattern extends BasePattern {
  expression: ExpressionPattern;

  constructor(expr: ExpressionPattern) {
    super();
    this.expression = expr;
  }

  override toString(): string {
    return `not(${this.expression.toString})`;
  }
}

export function isNegExpressionPattern(p: BasePattern): boolean {
  return p instanceof NegExpressionPattern;
}

export function isNotExpressionPattern(p: BasePattern): boolean {
  return p instanceof NotExpressionPattern;
}

export class ReferencePattern extends BasePattern {
  record: string;
  member: string;

  constructor(record: string, member: string) {
    super();
    this.record = record;
    this.member = member;
  }

  override toString(): string {
    return `${this.record}.${this.member}`.concat(this.hintsAsString());
  }
}

export function isReferencePattern(p: BasePattern): boolean {
  return p instanceof ReferencePattern;
}

export type AttributePattern = {
  name: string;
  op: string | undefined;
  value: BasePattern;
};

export class CrudPattern extends BasePattern {
  recordName: string;
  attributes: Array<AttributePattern>;
  relationships: Map<string, CrudPattern[] | CrudPattern> | undefined;
  into: Map<string, string> | undefined;
  isQuery: boolean = false;
  isQueryUpdate: boolean = false;
  isCreate: boolean = false;

  constructor(recordName: string) {
    super();
    this.recordName = recordName;
    this.attributes = [];
    if (recordName.endsWith('?')) {
      this.isQuery = true;
    } else {
      this.isCreate = true;
    }
  }

  addAttribute(n: string, p: BasePattern, op?: string): CrudPattern {
    this.attributes.push({ name: n, op: op, value: p });
    if (this.recordName.endsWith('?')) {
      this.recordName = this.recordName.substring(0, this.recordName.length - 1);
    }
    this.flagType();
    return this;
  }

  removeAttribute(n: string): CrudPattern {
    const idx: number = this.attributes.findIndex((ap: AttributePattern) => {
      return n == ap.name;
    });
    if (idx >= 0) {
      this.attributes.splice(idx, 1);
    }
    this.flagType();
    return this;
  }

  addInto(alias: string, attr: string): CrudPattern {
    if (this.into == undefined) {
      this.into = new Map();
    }
    this.into.set(alias, attr);
    return this;
  }

  removeInto(alias: string): CrudPattern {
    if (this.into) {
      this.into.delete(alias);
    }
    return this;
  }

  resetInto(into?: Map<string, string>): CrudPattern {
    this.into = into;
    return this;
  }

  hasInto(): boolean {
    if (this.into && this.into.size > 0) {
      return true;
    } else {
      return false;
    }
  }

  private flagType() {
    let hasq = false;
    let hasc = false;
    for (let i = 0; i < this.attributes.length; ++i) {
      if (hasq && hasc) break;
      const ap = this.attributes[i];
      hasq = ap.name.endsWith('?');
      if (!hasc) hasc = !hasq;
    }
    if (hasq && hasc) {
      this.isQueryUpdate = true;
    } else if (hasc) {
      this.isCreate = true;
    } else {
      this.isQuery = hasq;
    }
  }

  addRelationship(n: string, p: CrudPattern[] | CrudPattern) {
    if (this.relationships == undefined) {
      this.relationships = new Map();
    }
    this.relationships.set(n, p);
    return this;
  }

  removeRelationship(n: string) {
    if (this.relationships) {
      this.relationships.delete(n);
    }
    return this;
  }

  private attributesAsString(): string {
    const result: Array<string> = [];
    this.attributes.forEach((ap: AttributePattern) => {
      result.push(`${ap.name}${ap.op ? ap.op : ''} ${ap.value.toString()}`);
    });
    const s = result.join(', ');
    return `{${s}}`;
  }

  private relationshipsAsString(): string | undefined {
    if (this.relationships != undefined) {
      const result: Array<string> = [];
      this.relationships.forEach((p: CrudPattern | CrudPattern[], n: string) => {
        const ps = p instanceof Array ? `[${patternsToString(p, ',')}]` : p.toString();
        result.push(`${n} ${ps}`);
      });
      return result.join(',');
    } else {
      return undefined;
    }
  }

  getNormalizedRecordName(): string {
    return escapeQueryName(this.recordName);
  }

  private intoAsString(): string | undefined {
    if (this.into) {
      const ss = new Array<string>();
      this.into.forEach((attr: string, alias: string) => {
        ss.push(`${alias} ${attr}`);
      });
      return `@into { ${ss.join(',\n')} }`;
    }
    return undefined;
  }

  override toString(): string {
    let s = `{${this.recordName} ${this.attributesAsString()}`;
    const rs = this.relationshipsAsString();
    if (rs) {
      s = s.concat(`,${rs}`);
    }
    const ins = this.intoAsString();
    if (ins) {
      s = s.concat(`,${ins}`);
    }
    return s.concat('}', this.hintsAsString());
  }
}

export function isCrudPattern(p: BasePattern): boolean {
  return p instanceof CrudPattern;
}

export function isCreatePattern(p: BasePattern): boolean {
  return isCrudPattern(p) && (p as CrudPattern).isCreate;
}

export function isQueryPattern(p: BasePattern): boolean {
  return isCrudPattern(p) && (p as CrudPattern).isQuery;
}

export function isQueryUpdatePattern(p: BasePattern): boolean {
  return isCrudPattern(p) && (p as CrudPattern).isQueryUpdate;
}

export class ForEachPattern extends BasePattern {
  variable: string;
  source: BasePattern;
  body: BasePattern[];

  constructor(variable?: string, source?: BasePattern) {
    super();
    this.variable = variable ? variable : 'X';
    this.source = source ? source : LiteralPattern.EmptyArray;
    this.body = [];
  }

  addPattern(p: BasePattern): ForEachPattern {
    this.body.push(p);
    return this;
  }

  removePattern(index: number): ForEachPattern {
    this.body.splice(index, 1);
    return this;
  }

  setPatternAt(p: BasePattern, index: number): ForEachPattern {
    this.body[index] = p;
    return this;
  }

  removePatternAt(index: number): ForEachPattern {
    this.body.splice(index, 1);
    return this;
  }

  getPatternAt(index: number): BasePattern {
    return this.body[index];
  }

  setVariable(s: string): ForEachPattern {
    this.variable = s;
    return this;
  }

  setSourcePattern(p: BasePattern): ForEachPattern {
    this.source = p;
    return this;
  }

  override toString(): string {
    if (this.source == undefined || this.variable == undefined) {
      throw new Error('`for` requires variable and source-pattern');
    }
    let s = `for ${this.variable} in ${this.source.toString()}`;
    s = s.concat(`{${patternsToString(this.body)}}`);
    return s.concat(this.hintsAsString());
  }
}

export function isForEachPattern(p: BasePattern): boolean {
  return p instanceof ForEachPattern;
}

export class IfPattern extends BasePattern {
  condition: BasePattern;
  body: BasePattern[];
  elseBody: BasePattern[] | undefined;

  private static True = new LiteralPattern(LiteralPatternType.BOOLEAN, true);

  constructor(condition?: BasePattern) {
    super();
    this.condition = condition ? condition : IfPattern.True;
    this.body = [];
  }

  addPattern(p: BasePattern): IfPattern {
    this.body.push(p);
    return this;
  }

  removePattern(index: number): IfPattern {
    this.body.splice(index, 1);
    return this;
  }

  setPatternAt(p: BasePattern, index: number): IfPattern {
    this.body[index] = p;
    return this;
  }

  removePatternAt(index: number): IfPattern {
    this.body.splice(index, 1);
    return this;
  }

  getPatternAt(index: number): BasePattern {
    return this.body[index];
  }

  setConditionPattern(p: BasePattern): IfPattern {
    this.condition = p;
    return this;
  }

  setElse(elseBody?: BasePattern[]): IfPattern {
    this.elseBody = elseBody ? elseBody : new Array<BasePattern>();
    return this;
  }

  removeElse(): IfPattern {
    this.elseBody = undefined;
    return this;
  }

  override toString(): string {
    let s = `if(${this.condition.toString()}) {`;
    s = s.concat(patternsToString(this.body), '}');
    if (this.elseBody) {
      if (this.elseBody.length == 1 && this.elseBody[0] instanceof IfPattern) {
        s = s.concat(` else ${this.elseBody[0].toString()}`);
      } else {
        s = s.concat(` else {${patternsToString(this.elseBody)}}`);
      }
    }
    return s.concat(this.hintsAsString());
  }
}

export function isIfPattern(p: BasePattern): boolean {
  return p instanceof IfPattern;
}

export function newCreatePattern(recName: string): CrudPattern {
  const cp: CrudPattern = new CrudPattern(recName);
  cp.isCreate = true;
  return cp;
}

export function newQueryPattern(recName: string, forQueryUpdate: boolean = false): CrudPattern {
  recName = recName.charAt(recName.length - 1) == '?' ? recName : recName + '?';
  const cp: CrudPattern = new CrudPattern(recName);
  cp.isCreate = false;
  if (forQueryUpdate) {
    cp.isQueryUpdate = true;
  } else {
    cp.isQuery = true;
  }
  return cp;
}

export function newQueryUpdatePattern(recName: string): CrudPattern {
  return newQueryPattern(recName, true);
}

export class DeletePattern extends BasePattern {
  pattern: BasePattern;

  constructor(pattern: BasePattern) {
    super();
    this.pattern = pattern;
  }

  override toString(): string {
    return `delete ${this.pattern.toString()}`.concat(this.hintsAsString());
  }
}

export function isDeletePattern(p: BasePattern): boolean {
  return p instanceof DeletePattern;
}

export function newDeletePattern(recName: string): DeletePattern {
  const qp: CrudPattern = newQueryPattern(recName);
  return new DeletePattern(qp);
}

function patternsToString(body: BasePattern[], sep = ';\n'): string {
  return body
    .map((p: BasePattern) => {
      return p.toString();
    })
    .join(sep);
}
