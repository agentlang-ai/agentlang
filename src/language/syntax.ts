export class BasePattern {
  alias: string | undefined;
  aliases: string[] | undefined;

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

  aliasAsString(): string {
    if (this.alias) {
      return ` as ${this.alias}`;
    } else if (this.aliases) {
      return ` as [${this.aliases.join(',')}]`;
    } else {
      return '';
    }
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
}

export class LiteralPattern extends BasePattern {
  type: LiteralPatternType;
  value: any;

  constructor(type: LiteralPatternType, value: any) {
    super();
    this.type = type;
    this.value = value;
  }

  override toString(): string {
    const s = this.type == LiteralPatternType.STRING ? `"${this.value}"` : this.value.toString();
    return s.concat(this.aliasAsString());
  }
}

export class ArrayPattern extends BasePattern {
  values: Array<BasePattern>;

  constructor(values: Array<BasePattern>) {
    super();
    this.values = values;
  }

  override toString(): string {
    if (this.values.length > 0) {
      const vs: Array<string> = [];
      this.values.forEach((v: BasePattern) => {
        vs.push(v.toString());
      });
      return `[${vs.join(', ')}]`;
    } else {
      return '[]';
    }
  }
}

export class FunctionCallPattern extends BasePattern {
  fnName: string;
  arguments: BasePattern[];

  constructor(fnName: string, args: BasePattern[]) {
    super();
    this.fnName = fnName;
    this.arguments = args;
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
    return s.concat(this.aliasAsString());
  }
}

export class ExpressionPattern extends BasePattern {
  expression: string;

  constructor(expression: any) {
    super();
    this.expression = expression;
  }

  override toString(): string {
    return this.expression.concat(this.aliasAsString());
  }
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
    return `${this.record}.${this.member}`.concat(this.aliasAsString());
  }
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
  isQuery: boolean = false;
  isQueryUpdate: boolean = false;
  isCreate: boolean = false;

  constructor(recordName: string) {
    super();
    this.recordName = recordName;
    this.attributes = [];
  }

  addAttribute(n: string, p: BasePattern, op?: string) {
    this.attributes.push({ name: n, op: op, value: p });
    return this;
  }

  removeAttribute(n: string) {
    const idx: number = this.attributes.findIndex((ap: AttributePattern) => {
      return n == ap.name;
    });
    if (idx >= 0) {
      this.attributes.splice(idx, 1);
    }
    return this;
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

  private relationshipsAsString(): string {
    if (this.relationships != undefined) {
      const result: Array<string> = [];
      this.relationships.forEach((p: CrudPattern | CrudPattern[], n: string) => {
        const ps = p instanceof Array ? `[${patternsToString(p, ',')}]` : p.toString();
        result.push(`${n} ${ps}`);
      });
      return result.join(',');
    } else {
      return '';
    }
  }

  override toString(): string {
    let s = `{${this.recordName} ${this.attributesAsString()}`;
    const rs = this.relationshipsAsString();
    if (rs.length > 0) {
      s = s.concat(`,${rs}`);
    }
    return s.concat('}', this.aliasAsString());
  }
}

export class ForEachPattern extends BasePattern {
  variable: string;
  source: BasePattern;
  body: BasePattern[];

  constructor(variable: string, source: BasePattern) {
    super();
    this.variable = variable;
    this.source = source;
    this.body = [];
  }

  addPattern(p: BasePattern) {
    this.body.push(p);
    return this;
  }

  removePattern(index: number) {
    this.body.splice(index, 1);
    return this;
  }

  override toString(): string {
    let s = `for ${this.variable} in ${this.source.toString()}`;
    s = s.concat(`{${patternsToString(this.body)}}`);
    return s.concat(this.aliasAsString());
  }
}

export class IfPattern extends BasePattern {
  condition: ExpressionPattern;
  body: BasePattern[];
  elseIf: BasePattern | undefined;
  elseBody: BasePattern[] | undefined;

  constructor(condition: ExpressionPattern) {
    super();
    this.condition = condition;
    this.body = [];
  }

  addPattern(p: BasePattern) {
    this.body.push(p);
    return this;
  }

  removePattern(index: number) {
    this.body.splice(index, 1);
    return this;
  }

  setElseIf(p: IfPattern) {
    this.elseIf = p;
    return this;
  }

  setElseBody(elseBody: BasePattern[]) {
    this.elseBody = elseBody;
    return this;
  }

  removeElseIf() {
    this.elseIf = undefined;
    return this;
  }

  removeElseBody() {
    this.elseBody = undefined;
    return this;
  }

  override toString(): string {
    let s = `if(${this.condition.toString()}) {`;
    s = s.concat(patternsToString(this.body), '}');
    if (this.elseIf) {
      s = s.concat(` else ${this.elseIf.toString()}`);
    }
    if (this.elseBody) {
      s = s.concat(` else {${patternsToString(this.elseBody)}}`);
    }
    return s.concat(this.aliasAsString());
  }
}

export class DeletePattern extends BasePattern {
  pattern: BasePattern;

  constructor(pattern: BasePattern) {
    super();
    this.pattern = pattern;
  }

  override toString(): string {
    return `delete ${this.pattern.toString()}`.concat(this.aliasAsString());
  }
}

function patternsToString(body: BasePattern[], sep = ';'): string {
  const pats: Array<string> = [];
  body.forEach((p: BasePattern) => {
    pats.push(p.toString());
  });
  return pats.join(sep);
}
