import { isString } from '../runtime/util.js';

export class Pattern {
  alias: string | undefined;

  setAlias(alias: string) {
    this.alias = alias;
    return this;
  }

  unsetAlias() {
    this.alias = undefined;
    return this;
  }

  toString(): string {
    if (this.alias) {
      return ` as ${this.alias}`;
    } else {
      return '';
    }
  }
}

export class LiteralPattern extends Pattern {
  value: any;

  constructor(value: any) {
    super();
    this.value = value;
  }

  override toString(): string {
    const s = isString(this.value) ? `"${this.value}"` : this.value.toString();
    return s.concat(super.toString());
  }
}

export class ExpressionPattern extends Pattern {
  expression: string;

  constructor(expression: any) {
    super();
    this.expression = expression;
  }

  override toString(): string {
    return this.expression.concat(super.toString());
  }
}

export class ReferencePattern extends Pattern {
  record: string;
  member: string;

  constructor(record: string, member: string) {
    super();
    this.record = record;
    this.member = member;
  }

  override toString(): string {
    return `${this.record}.${this.member}`.concat(super.toString());
  }
}

export class CrudPattern extends Pattern {
  recordName: string;
  attributes: Map<string, Pattern>;
  relationships: Map<string, CrudPattern[] | CrudPattern> | undefined;

  constructor(recordName: string) {
    super();
    this.recordName = recordName;
    this.attributes = new Map<string, Pattern>();
  }

  addAttribute(n: string, p: Pattern) {
    this.attributes.set(n, p);
    return this;
  }

  removeAttribute(n: string) {
    this.attributes.delete(n);
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
    this.attributes.forEach((p: Pattern, n: string) => {
      result.push(`${n} ${p.toString()}`);
    });
    const s = result.join(',');
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
    return s.concat('}', super.toString());
  }
}

export class ForEachPattern extends Pattern {
  variable: string;
  source: Pattern;
  body: Pattern[];

  constructor(variable: string, source: Pattern) {
    super();
    this.variable = variable;
    this.source = source;
    this.body = [];
  }

  addPattern(p: Pattern) {
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
    return s.concat(super.toString());
  }
}

export class IfPattern extends Pattern {
  condition: ExpressionPattern;
  body: Pattern[];
  elseIf: Pattern | undefined;
  elseBody: Pattern[] | undefined;

  constructor(condition: ExpressionPattern) {
    super();
    this.condition = condition;
    this.body = [];
  }

  addPattern(p: Pattern) {
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

  setElseBody(elseBody: Pattern[]) {
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
    return s.concat(super.toString());
  }
}

function patternsToString(body: Pattern[], sep = ';'): string {
  const pats: Array<string> = [];
  body.forEach((p: Pattern) => {
    pats.push(p.toString());
  });
  return pats.join(sep);
}
