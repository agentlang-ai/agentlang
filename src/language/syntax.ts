export class Pattern {
  alias: string | undefined;

  setAlias(alias: string) {
    this.alias = alias;
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
    return this.value.toString().concat(super.toString());
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
  relationships: CrudPattern[] | undefined;

  constructor(recordName: string) {
    super();
    this.recordName = recordName;
    this.attributes = new Map<string, Pattern>();
  }

  addAttribute(n: string, p: Pattern) {
    this.attributes.set(n, p);
  }

  removeAttribute(n: string) {
    this.attributes.delete(n);
  }

  addRelationship(p: CrudPattern) {
    if (this.relationships == undefined) {
      this.relationships = [];
    }
    this.relationships.push(p);
  }

  removeRelationship(index: number) {
    if (this.relationships) {
      this.relationships.splice(index, 1);
    }
  }

  private attributesAsString(): string {
    const result: Array<string> = [];
    this.attributes.forEach((p: Pattern, n: string) => {
      result.push(`${n} ${p.toString()}`);
    });
    const s = result.join(',\n');
    return `{${s}}`;
  }

  private relationshipsAsString(): string {
    if (this.relationships != undefined) {
      const result: Array<string> = [];
      this.relationships.forEach((v: CrudPattern) => {
        result.push(v.toString());
      });
      return result.join(',\n');
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
  }

  removePattern(index: number) {
    this.body.splice(index, 1);
  }

  override toString(): string {
    let s = `for ${this.variable} in ${this.source.toString()} {\n`;
    s = s.concat(`{\n ${patternsToString(this.body)} \n}`);
    return s.concat(super.toString()).concat('\n');
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
  }

  removePattern(index: number) {
    this.body.splice(index, 1);
  }

  setElseIf(p: IfPattern) {
    this.elseIf = p;
  }

  setElseBody(elseBody: Pattern[]) {
    this.elseBody = elseBody;
  }

  removeElseIf() {
    this.elseIf = undefined;
  }

  removeElseBody() {
    this.elseBody = undefined;
  }

  override toString(): string {
    let s = `if(${this.condition.toString()}) { \n`;
    s = s.concat(patternsToString(this.body), ' }');
    if (this.elseIf) {
      s = s.concat(` else ${this.elseIf.toString()}`);
    } else if (this.elseBody) {
      s = s.concat(` else { \n${patternsToString(this.elseBody)} }`);
    }
    return s.concat(super.toString()).concat('\n');
  }
}

function patternsToString(body: Pattern[]): string {
  const pats: Array<string> = [];
  body.forEach((p: Pattern) => {
    pats.push(p.toString());
  });
  return pats.join(';\n');
}
