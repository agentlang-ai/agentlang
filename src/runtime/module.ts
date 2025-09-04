import chalk from 'chalk';
import {
  Statement,
  KvPair,
  Literal,
  FnCall,
  RelNodes,
  isRelNodes,
  AttributeDefinition,
  PropertyDefinition,
  NodeDefinition,
  RecordSchemaDefinition,
  MapEntry,
  isLiteral,
  MetaDefinition,
  PrePostTriggerDefinition,
  TriggerEntry,
  Expr,
  RbacSpecEntry,
  RbacSpecEntries,
  RbacOpr,
  WorkflowHeader,
} from '../language/generated/ast.js';
import {
  Path,
  splitFqName,
  isString,
  isNumber,
  isBoolean,
  isFqName,
  makeFqName,
  DefaultModuleName,
  DefaultModules,
  joinStatements,
  isMinusZero,
  now,
  findMetaSchema,
  findAllPrePostTriggerSchema,
  CrudType,
  asCrudType,
  isPath,
  findUqCompositeAttributes,
  escapeFqName,
  encryptPassword,
} from './util.js';
import { parseStatement } from '../language/parser.js';
import { ActiveSessionInfo, AdminSession } from './auth/defs.js';
import { FetchModuleFn, PathAttributeName } from './defs.js';
import { logger } from './logger.js';

export class ModuleEntry {
  name: string;
  moduleName: string;

  constructor(name: string, moduleName: string) {
    this.name = name;
    this.moduleName = moduleName;
  }

  getFqName(): string {
    return makeFqName(this.moduleName, this.name);
  }
}

export type AttributeSpec = {
  type: string;
  properties?: Map<string, any> | undefined;
};

function normalizePropertyNames(props: Map<string, any>) {
  // Convert iterator to array for compatibility with different Node.js versions
  const normKs = Array.from(props.keys()).filter((k: string) => {
    return k.charAt(0) === '@';
  });
  normKs.forEach((k: string) => {
    const v: any = props.get(k);
    props.delete(k);
    props.set(k.substring(1), v);
  });
}

const SystemAttributeProperty: string = 'system-attribute';
const SystemDefinedEvent = 'system-event';

function setAsSystemAttribute(attrSpec: AttributeSpec) {
  const props: Map<string, any> = attrSpec.properties ? attrSpec.properties : new Map();
  props.set(SystemAttributeProperty, true);
  attrSpec.properties = props;
}

function isSystemAttribute(attrSpec: AttributeSpec): boolean {
  if (attrSpec.properties) {
    return attrSpec.properties.get(SystemAttributeProperty) == true;
  }
  return false;
}

export type RecordSchema = Map<string, AttributeSpec>;

function recordSchemaToString(scm: RecordSchema): string {
  const ss: Array<string> = [];
  scm.forEach((attrSpec: AttributeSpec, n: string) => {
    if (!isSystemAttribute(attrSpec)) {
      ss.push(`    ${n} ${attributeSpecToString(attrSpec)}`);
    }
  });
  return `\n${ss.join(',\n')}`;
}

function attributeSpecToString(attrSpec: AttributeSpec): string {
  let s: string = getEnumValues(attrSpec) || getOneOfRef(attrSpec) ? '' : `${attrSpec.type}`;
  if (isArrayAttribute(attrSpec)) {
    s = `${s}[]`;
  }
  if (attrSpec.properties) {
    const ps: Array<string> = [];
    attrSpec.properties.forEach((v: any, k: string) => {
      if (k != 'array') {
        if (v == true) ps.push(` @${k}`);
        else ps.push(` @${k}(${attributePropertyValueToString(k, v, attrSpec.type)})`);
      }
    });
    s = s.concat(ps.join(' '));
  }
  return s;
}

function attributePropertyValueToString(
  propName: string,
  propValue: any,
  attrType: string
): string {
  if (propName == EnumPropertyName) {
    const v = propValue as Set<string>;
    const ss = new Array<string>();
    v.forEach((s: string) => {
      ss.push(`"${s}"`);
    });
    return ss.join(',');
  } else if (propName == 'default') {
    if (isTextualType(attrType) && propValue != 'now()' && propValue != 'uuid()') {
      return `"${propValue}"`;
    }
  } else if (propName == 'comment') {
    return `"${propValue}"`;
  }
  return `${propValue}`;
}

export function newRecordSchema(): RecordSchema {
  return new Map<string, AttributeSpec>();
}

type Meta = Map<string, any>;

export function newMeta(): Meta {
  return new Map<string, any>();
}

export enum RecordType {
  RECORD,
  ENTITY,
  EVENT,
  RELATIONSHIP,
  AGENT,
}

function normalizeMetaValue(metaValue: any): any {
  if (!isLiteral(metaValue)) {
    throw new Error(`Invalid entry ${metaValue} in meta specification - expected a literal`);
  }
  const v: Literal = metaValue as Literal;
  if (v.array) {
    return v.array.vals.map((value: Statement) => {
      return normalizeMetaValue(value.pattern.expr);
    });
  } else if (v.bool != undefined) {
    return v.bool == 'true' ? true : false;
  } else if (v.id) {
    return v.id;
  } else if (v.map) {
    const result = new Map<any, any>();
    v.map.entries.forEach((value: MapEntry) => {
      result.set(value.key, normalizeMetaValue(value.value));
    });
    return result;
  } else if (v.ref) {
    return v.ref;
  } else if (v.num) {
    return v.num;
  } else if (v.str) {
    return v.str;
  } else {
    throw new Error(`Invalid value ${metaValue} passed to meta specification`);
  }
}

export type TriggerInfo = {
  eventName: string;
  async: boolean;
};

function asTriggerInfo(te: any): TriggerInfo {
  return {
    eventName: te.event,
    async: te.async ? true : false,
  };
}

const EnumPropertyName = 'enum';
const OneOfPropertyName = 'oneof';

export function enumAttributeSpec(values: Set<string>): AttributeSpec {
  return {
    type: 'String',
    properties: new Map().set(EnumPropertyName, values),
  };
}

export function oneOfAttributeSpec(ref: string): AttributeSpec {
  return {
    type: 'String',
    properties: new Map().set(OneOfPropertyName, ref),
  };
}

export class Record extends ModuleEntry {
  schema: RecordSchema;
  meta: Meta | undefined;
  type: RecordType = RecordType.RECORD;
  parentEntryName: string | undefined;
  afterTriggers: Map<CrudType, TriggerInfo> | undefined;
  beforeTriggers: Map<CrudType, TriggerInfo> | undefined;
  compositeUqAttributes: Array<string> | undefined;
  oneOfRefAttributes: Array<string> | undefined;
  protected rbac: RbacSpecification[] | undefined;

  constructor(
    name: string,
    moduleName: string,
    scm?: RecordSchemaDefinition,
    parentEntryName?: string
  ) {
    super(name, moduleName);
    this.parentEntryName = parentEntryName;
    this.schema = parentEntryName
      ? cloneParentSchema(parentEntryName, moduleName)
      : newRecordSchema();
    const attributes: AttributeDefinition[] | undefined = scm ? scm.attributes : undefined;
    if (attributes != undefined) {
      attributes.forEach((a: AttributeDefinition) => {
        verifyAttribute(a);
        let props: Map<string, any> | undefined = asPropertiesMap(a.properties);
        const isArrayType: boolean = a.arrayType ? true : false;
        let t: string | undefined = isArrayType ? a.arrayType : a.type;
        if (a.refSpec) {
          let fp = a.refSpec.ref;
          const rp = splitFqName(fp);
          if (!rp.hasModule()) {
            rp.setModuleName(this.moduleName);
            fp = rp.asFqName();
          }
          if (props == undefined) {
            props = new Map();
          }
          props.set('ref', escapeFqName(fp));
          t = 'Path';
        }
        const enumValues: string[] | undefined = a.enumSpec?.values;
        const oneOfRef: string | undefined = a.oneOfSpec?.ref;
        if (!t) {
          if (enumValues || oneOfRef) {
            t = 'String';
          } else {
            throw new Error(`Attribute ${a.name} requires a type`);
          }
        }
        if (a.expr) {
          if (props == undefined) {
            props = new Map();
          }
          props.set('expr', a.expr).set('optional', true);
        }
        const isObjectType: boolean = t == 'Map' || !isBuiltInType(t);
        if (isArrayType || isObjectType || enumValues || oneOfRef) {
          if (props == undefined) {
            props = new Map<string, any>();
          }
          if (isArrayType) props.set('array', true);
          if (isObjectType) props.set('object', true);
          if (enumValues) props.set(EnumPropertyName, new Set(enumValues));
          if (oneOfRef) {
            props.set(OneOfPropertyName, oneOfRef);
            this.addOneOfRefAttribute(a.name);
          }
        }
        this.schema.set(a.name, { type: t, properties: props });
      });
    }
    const meta: MetaDefinition | undefined = findMetaSchema(scm);
    if (meta) {
      meta.spec.entries.forEach((entry: MapEntry) => {
        if (entry.key.str) this.addMeta(entry.key.str, normalizeMetaValue(entry.value));
        else
          throw new Error(
            `Key must be a string for meta-definition in ${this.moduleName}/${this.name}`
          );
      });
    }
    const prepostTrigs: PrePostTriggerDefinition[] | undefined = findAllPrePostTriggerSchema(scm);
    if (prepostTrigs) {
      prepostTrigs.forEach((ppt: PrePostTriggerDefinition) => {
        if (ppt.after) {
          if (this.afterTriggers == undefined) {
            this.afterTriggers = new Map();
          }
          ppt.after.triggers.entries.forEach((te: TriggerEntry) => {
            if (this.afterTriggers) this.afterTriggers.set(asCrudType(te.on), asTriggerInfo(te));
          });
        } else if (ppt.before) {
          if (this.beforeTriggers == undefined) {
            this.beforeTriggers = new Map();
          }
          ppt.before.triggers.entries.forEach((te: TriggerEntry) => {
            if (this.beforeTriggers) this.beforeTriggers.set(asCrudType(te.on), asTriggerInfo(te));
          });
        }
      });
    }
    this.compositeUqAttributes = findUqCompositeAttributes(scm);
  }

  private addOneOfRefAttribute(s: string): Record {
    if (this.oneOfRefAttributes == undefined) {
      this.oneOfRefAttributes = [];
    }
    this.oneOfRefAttributes.push(s);
    return this;
  }

  public addAfterTrigger(te: any): Record {
    if (this.afterTriggers == undefined) {
      this.afterTriggers = new Map();
    }
    this.afterTriggers?.set(asCrudType(te.on), asTriggerInfo(te));
    return this;
  }

  public addBeforeTrigger(te: any): Record {
    if (this.beforeTriggers == undefined) {
      this.beforeTriggers = new Map();
    }
    this.beforeTriggers?.set(asCrudType(te.on), asTriggerInfo(te));
    return this;
  }

  getCompositeUniqueAttributes(): Array<string> | undefined {
    return this.compositeUqAttributes;
  }

  getPreTriggerInfo(crudType: CrudType): TriggerInfo | undefined {
    if (this.beforeTriggers) {
      return this.beforeTriggers.get(crudType);
    }
    return undefined;
  }

  getPostTriggerInfo(crudType: CrudType): TriggerInfo | undefined {
    if (this.afterTriggers) {
      return this.afterTriggers.get(crudType);
    }
    return undefined;
  }

  addMeta(k: string, v: any): void {
    if (!this.meta) {
      this.meta = newMeta();
    }
    this.meta.set(k, v);
  }

  getMeta(k: string): any {
    if (this.meta) {
      return this.meta.get(k);
    } else {
      return undefined;
    }
  }

  getFullTextSearchAttributes(): string[] | undefined {
    const fts: string[] | string | undefined = this.getMeta('fullTextSearch');
    if (fts) {
      if (fts instanceof Array) {
        return fts as string[];
      } else if (fts == '*') {
        return [...this.schema.keys()];
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  addAttribute(n: string, attrSpec: AttributeSpec): Record {
    if (this.schema.has(n)) {
      throw new Error(`Attribute named ${n} already exists in ${this.moduleName}.${this.name}`);
    }
    if (attrSpec.properties != undefined) {
      normalizePropertyNames(attrSpec.properties);
    }
    this.schema.set(n, attrSpec);
    return this;
  }

  removeAttribute(n: string): Record {
    this.schema.delete(n);
    return this;
  }

  reorderAttributes(desiredOrder: string[]) {
    this.schema = new Map(
      [...this.schema].sort((a, b) => {
        return desiredOrder.indexOf(a[0]) - desiredOrder.indexOf(b[0]);
      })
    );
  }

  addSystemAttribute(n: string, attrSpec: AttributeSpec): Record {
    setAsSystemAttribute(attrSpec);
    this.addAttribute(n, attrSpec);
    return this;
  }

  findAttribute(predic: Function): AttributeEntry | undefined {
    for (const k of this.schema.keys()) {
      const attrSpec: AttributeSpec | undefined = this.schema.get(k);
      if (attrSpec != undefined) {
        if (predic(attrSpec))
          return {
            name: k,
            spec: attrSpec,
          };
      }
    }
    return undefined;
  }

  hasRefTo(modName: string, entryName: string): boolean {
    if (
      this.findAttribute((attrSpec: AttributeSpec) => {
        if (attrSpec.properties != undefined) {
          const ref: Path | undefined = attrSpec.properties.get('ref');
          if (ref != undefined) {
            if (ref.getModuleName() == modName && ref.getEntryName() == entryName) {
              return true;
            }
          }
        }
        return false;
      })
    )
      return true;
    else return false;
  }

  getIdAttributeName(): string | undefined {
    const e: AttributeEntry | undefined = this.findAttribute((attrSpec: AttributeSpec) => {
      return isIdAttribute(attrSpec);
    });
    if (e != undefined) {
      return e.name;
    }
    return undefined;
  }

  override toString(): string {
    if (this.type == RecordType.EVENT && this.meta && this.meta.get(SystemDefinedEvent)) {
      return '';
    }
    let s: string = `${RecordType[this.type].toLowerCase()} ${this.name}`;
    if (this.parentEntryName) {
      s = s.concat(` extends ${this.parentEntryName}`);
    }
    let scms = recordSchemaToString(this.schema);
    if (this.rbac && this.rbac.length > 0) {
      const rbs = this.rbac.map((rs: RbacSpecification) => {
        return rs.toString();
      });
      scms = `${scms},\n    @rbac [${rbs.join(',\n')}]`;
    }
    if (this.meta && this.meta.size > 0) {
      const metaObj = Object.fromEntries(this.meta);
      const ms = `@meta ${JSON.stringify(metaObj)}`;
      scms = `${scms},\n    ${ms}`;
    }
    return s.concat('\n{', scms, '\n}\n');
  }

  getUserAttributes(): RecordSchema {
    const recSchema: RecordSchema = newRecordSchema();
    this.schema.forEach((attrSpec: AttributeSpec, n: string) => {
      if (!isSystemAttribute(attrSpec)) {
        recSchema.set(n, attrSpec);
      }
    });
    return recSchema;
  }

  getUserAttributeNames(): string[] {
    return [...this.getUserAttributes().keys()];
  }
}

type FetchModuleByEntryNameResult = {
  module: Module;
  entryName: string;
  moduleName: string;
};

function fetchModuleByEntryName(
  entryName: string,
  suspectModuleName: string
): FetchModuleByEntryNameResult {
  if (isFqName(entryName)) {
    const path: Path = splitFqName(entryName);
    entryName = path.getEntryName();
    suspectModuleName = path.getModuleName();
  }
  return {
    module: fetchModule(suspectModuleName),
    entryName: entryName,
    moduleName: suspectModuleName,
  };
}

function cloneParentSchema(parentName: string, currentModuleName: string): RecordSchema {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(parentName, currentModuleName);
  parentName = fr.entryName;
  currentModuleName = fr.moduleName;
  const mod: Module = fr.module;
  const entry: Record = mod.getEntry(parentName) as Record;
  const result: RecordSchema = newRecordSchema();
  entry.schema.forEach((attrSpec: AttributeSpec, attrName: string) => {
    result.set(attrName, attrSpec);
  });
  return result;
}

function asPropertiesMap(props: PropertyDefinition[]): Map<string, any> | undefined {
  if (props != undefined && props.length > 0) {
    const result: Map<string, any> = new Map<string, any>();
    props.forEach((p: PropertyDefinition) => {
      const n: string = p.name.substring(1);
      if (p.value != undefined && p.value.pairs != undefined && p.value.pairs.length > 0) {
        if (p.value.pairs.length == 1) {
          const kvp: KvPair = p.value.pairs[0];
          if (kvp.key == undefined) {
            result.set(n, normalizeKvPairValue(kvp));
          } else {
            const v: Map<string, any> = new Map<string, any>();
            v.set(kvp.key, normalizeKvPairValue(kvp));
            result.set(n, v);
          }
        } else {
          const v: Map<string, any> = new Map<string, any>();
          p.value.pairs.forEach((kvp: KvPair) => {
            let k: string = 'null';
            if (kvp.key != undefined) k = kvp.key;
            v.set(k, normalizeKvPairValue(kvp));
          });
          result.set(n, v);
        }
      } else {
        result.set(n, true);
      }
    });
    return maybeProcessRefProperty(result);
  }
  return undefined;
}

function maybeProcessRefProperty(props: Map<string, any>): Map<string, any> {
  const v: string | undefined = props.get('ref');
  if (v != undefined) {
    const parts: Path = splitFqName(v);
    if (!parts.hasModule()) {
      parts.setModuleName(activeModule);
    }
    props.set('ref', parts);
  }
  return props;
}

function normalizeKvPairValue(kvp: KvPair): any | null {
  const v: Literal | undefined = kvp.value;
  if (v == undefined) return true;
  if (v.str != undefined) {
    return v.str;
  } else if (v.num != undefined) {
    return v.num;
  } else if (v.bool != undefined) {
    return v.bool == 'true' ? true : false;
  } else if (v.id != undefined) {
    return v.id;
  } else if (v.ref != undefined) {
    return v.ref;
  } else if (v.fnCall != undefined) {
    const fncall: FnCall = v.fnCall;
    if (fncall.args.length > 0) {
      throw new Error('Cannot allow arguments in properties function-call');
    }
    return fncall.name + '()';
  } else if (v.array != undefined) {
    return v.array;
  }
  return null;
}

export const PlaceholderRecordEntry = new Record('--', DefaultModuleName);

export enum RbacPermissionFlag {
  CREATE,
  READ,
  UPDATE,
  DELETE,
}

type RbacExpression = {
  lhs: string;
  rhs: string;
};

export class RbacSpecification {
  private static EmptyRoles: Set<string> = new Set();
  resource: string = '';
  roles: Set<string> = RbacSpecification.EmptyRoles;
  permissions: Set<RbacPermissionFlag>;
  expression: RbacExpression | undefined;

  constructor() {
    this.permissions = new Set();
  }

  static from(def: RbacSpecEntries): RbacSpecification {
    const result = new RbacSpecification();
    def.entries.forEach((se: RbacSpecEntry) => {
      if (se.role) {
        result.setRoles(se.role.roles);
      } else if (se.allow) {
        result.setPermissions(
          se.allow.oprs.map((opr: RbacOpr) => {
            return opr.value;
          })
        );
      } else if (se.expr) {
        result.setExpression(se.expr.lhs, se.expr.rhs);
      }
    });
    return result;
  }

  setResource(s: string): RbacSpecification {
    this.resource = s;
    return this;
  }

  hasResource(): boolean {
    return this.resource.length > 0;
  }

  setPermissions(perms: Array<string>): RbacSpecification {
    const ps = new Set<RbacPermissionFlag>();
    perms.forEach((v: string) => {
      const idx: any = v.toUpperCase();
      const a: any = RbacPermissionFlag[idx];
      if (a == undefined) {
        throw new Error(`Not a valid RBAC permission - ${v}`);
      }
      ps.add(a);
    });
    this.permissions = ps;
    return this;
  }

  hasPermissions(): boolean {
    return this.permissions.size > 0;
  }

  hasCreatePermission(): boolean {
    return this.permissions.has(RbacPermissionFlag.CREATE);
  }

  hasReadPermission(): boolean {
    return this.permissions.has(RbacPermissionFlag.READ);
  }

  hasUpdatePermission(): boolean {
    return this.permissions.has(RbacPermissionFlag.UPDATE);
  }

  hasDeletePermission(): boolean {
    return this.permissions.has(RbacPermissionFlag.DELETE);
  }

  setRoles(roles: Array<string>): RbacSpecification {
    if (this.expression) {
      throw new Error('Cannot set roles while `where` expression is set');
    }
    this.roles = new Set();
    roles.forEach((r: string) => {
      this.roles.add(r);
    });
    return this;
  }

  removeRoles(): RbacSpecification {
    this.roles = RbacSpecification.EmptyRoles;
    return this;
  }

  setExpression(lhs: string, rhs: string): RbacSpecification {
    if (this.roles != RbacSpecification.EmptyRoles) {
      logger.warn('Cannot set `where` expression along with roles, removing roles');
      this.removeRoles();
    }
    this.expression = {
      lhs: lhs,
      rhs: rhs,
    };
    return this;
  }

  removeExpression(): RbacSpecification {
    this.expression = undefined;
    return this;
  }

  toString(): string {
    if (this.permissions.size <= 0) {
      throw new Error(`Cannot emit RbacSpecification, no permissions are set`);
    }
    const rs = new Array<string>();
    this.roles.forEach((r: string) => {
      rs.push(r);
    });
    let cond = '';
    if (this.expression) {
      cond = `where: ${this.expression.lhs} = ${this.expression.rhs}`;
    } else {
      cond = `roles: [${rs.join(',')}]`;
    }
    const perms = new Array<string>();
    this.permissions.forEach((p: RbacPermissionFlag) => {
      perms.push(RbacPermissionFlag[p].toLowerCase());
    });
    return `(${cond}, allow: [${perms.join(',')}])`;
  }
}

export class Agent extends Record {
  override type: RecordType = RecordType.AGENT;
  attributes: InstanceAttributes;

  constructor(name: string, moduleName: string, attrs?: InstanceAttributes) {
    super(Agent.EscapeName(name), moduleName);
    this.attributes = attrs ? attrs : newInstanceAttributes();
  }

  setName(n: string): Agent {
    this.name = Agent.EscapeName(n);
    return this;
  }

  setLLM(llm: string): Agent {
    this.attributes.set('llm', llm);
    return this;
  }

  getLLM(): string {
    return this.attributes.get('llm');
  }

  private removeAgentAttribute(n: string): Agent {
    this.attributes.delete(n);
    return this;
  }

  removeLLM(): Agent {
    return this.removeAgentAttribute('llm');
  }

  setInstruction(s: string): Agent {
    this.attributes.set('instruction', s);
    return this;
  }

  getInstruction(): string {
    return this.attributes.get('instruction');
  }

  removeInstruction(): Agent {
    return this.removeAgentAttribute('instruction');
  }

  setType(type: 'chat' | 'planner'): Agent {
    this.attributes.set('type', type);
    return this;
  }

  getType(): string {
    return this.attributes.get('type');
  }

  removeType(): Agent {
    return this.removeAgentAttribute('type');
  }

  setTools(tools: string[]): Agent {
    this.attributes.set('tools', tools.join(','));
    return this;
  }

  getTools(): string[] | undefined {
    const tools = this.attributes.get('tools');
    if (tools) {
      return tools.split(',');
    } else {
      return undefined;
    }
  }

  removeTools(): Agent {
    return this.removeAgentAttribute('tools');
  }

  setDocuments(docs: string[]): Agent {
    this.attributes.set('documents', docs.join(','));
    return this;
  }

  getDocuments(): string {
    return this.attributes.get('documents');
  }

  removeDocuments(): Agent {
    return this.removeAgentAttribute('documents');
  }

  override toString(): string {
    const attrs = new Array<string>();
    this.attributes.forEach((value: any, key: string) => {
      if (key != 'moduleName') {
        const v = isString(value) ? `"${value}"` : value;
        attrs.push(`    ${key} ${v}`);
      }
    });
    return `agent ${Agent.NormalizeName(this.name)}
{
${attrs.join(',\n')}
}`;
  }

  static Suffix = '__agent';

  static EscapeName(n: string): string {
    if (n.endsWith(Agent.Suffix)) {
      return n;
    }
    return `${n}${Agent.Suffix}`;
  }

  static NormalizeName(n: string): string {
    if (n.endsWith(Agent.Suffix)) {
      return n.substring(0, n.lastIndexOf(Agent.Suffix));
    } else {
      return n;
    }
  }

  getName(): string {
    return Agent.NormalizeName(this.name);
  }
}

export class Entity extends Record {
  override type: RecordType = RecordType.ENTITY;

  constructor(
    name: string,
    moduleName: string,
    scm?: RecordSchemaDefinition,
    parentEntryName?: string
  ) {
    super(name, moduleName, scm, parentEntryName);
  }

  setRbacSpecifications(rbac: RbacSpecification[]): Entity {
    this.rbac = rbac;
    return this;
  }

  getRbacSpecifications(): RbacSpecification[] | undefined {
    return this.rbac;
  }

  isConfigEntity(): boolean {
    const v = this.getMeta('configEntity');
    return v == true;
  }
}

export class Event extends Record {
  override type: RecordType = RecordType.EVENT;
}

enum RelType {
  CONTAINS,
  BETWEEN,
}

export type RelationshipNode = {
  path: Path;
  alias: string;
  origName: string;
  origAlias: string | undefined;
};

export function newRelNodeEntry(nodeFqName: string, alias?: string): RelationshipNode {
  const p: Path = splitFqName(nodeFqName);
  return {
    path: p,
    alias: alias ? alias : p.getEntryName(),
    origName: nodeFqName,
    origAlias: alias,
  };
}

function relNodeEntryToString(node: RelationshipNode): string {
  let n = `${node.origName}`;
  if (node.origAlias) {
    n = n.concat(` as ${node.origAlias}`);
  }
  return n;
}

function asRelNodeEntry(n: NodeDefinition): RelationshipNode {
  const path: Path = splitFqName(n.name);
  let modName = activeModule;
  const entryName = path.getEntryName();
  if (path.hasModule()) {
    modName = path.getModuleName();
  }
  let alias = entryName;
  if (n.alias != undefined) {
    alias = n.alias;
  }
  return {
    path: new Path(modName, entryName),
    alias: alias,
    origName: n.name,
    origAlias: n.alias,
  };
}

const OneToOne = 'one_one';
const OneToMany = 'one_many';
const ManyToMany = 'many_many';

export class Relationship extends Record {
  override type: RecordType = RecordType.RELATIONSHIP;
  relType: RelType = RelType.CONTAINS;
  node1: RelationshipNode;
  node2: RelationshipNode;
  properties: Map<string, any> | undefined;

  constructor(
    name: string,
    typ: string,
    node1: RelationshipNode,
    node2: RelationshipNode,
    moduleName: string,
    scm?: RecordSchemaDefinition,
    props?: Map<string, any>
  ) {
    super(name, moduleName, scm);
    if (typ == 'between') this.relType = RelType.BETWEEN;
    this.node1 = node1;
    this.node2 = node2;
    this.properties = props;
    this.updateSchemaWithNodeAttributes();
  }

  private updateSchemaWithNodeAttributes() {
    const attrSpec1: AttributeSpec = {
      type: 'string',
    };
    this.addSystemAttribute(this.node1.alias, attrSpec1);
    const attrSpec2: AttributeSpec = {
      type: 'string',
    };
    this.addSystemAttribute(this.node2.alias, attrSpec2);
    if (this.relType == RelType.BETWEEN && this.isOneToMany()) {
      const attrSpec3: AttributeSpec = {
        type: 'string',
        properties: new Map().set('unique', true),
      };
      this.addSystemAttribute(this.joinNodesAttributeName(), attrSpec3);
    }
  }

  joinNodesAttributeName(): string {
    return this.node1.alias + '_' + this.node2.alias;
  }

  setBetweenRef(inst: Instance, refPath: string, isQuery: boolean = false) {
    const refAttrName: string = `__${this.node1.alias.toLowerCase()}`;
    if (isQuery) {
      inst.addQuery(refAttrName, '=', refPath);
    } else {
      inst.attributes.set(refAttrName, refPath);
    }
  }

  isContains(): boolean {
    return this.relType == RelType.CONTAINS;
  }

  isBetween(): boolean {
    return this.relType == RelType.BETWEEN;
  }

  parentNode(): RelationshipNode {
    return this.node1;
  }

  childNode(): RelationshipNode {
    return this.node2;
  }

  hasBooleanFlagSet(flag: string): boolean {
    if (this.properties != undefined) {
      return this.properties.get(flag) == true;
    }
    return false;
  }

  private setProperty(p: string, v: any): Relationship {
    if (this.properties == undefined) {
      this.properties = new Map();
    }
    this.properties.set(p, v);
    return this;
  }

  isOneToOne(): boolean {
    return this.isBetween() && this.hasBooleanFlagSet(OneToOne);
  }

  isOneToMany(): boolean {
    return this.isBetween() && this.hasBooleanFlagSet(OneToMany);
  }

  isManyToMany(): boolean {
    if (this.isBetween()) {
      return (
        this.hasBooleanFlagSet(ManyToMany) ||
        (!this.hasBooleanFlagSet(OneToOne) && !this.hasBooleanFlagSet(OneToMany))
      );
    } else {
      return false;
    }
  }

  setOneToOne(flag: boolean = true): Relationship {
    if (flag) {
      this.setOneToMany(false).setManyToMany(false);
    }
    return this.setProperty(OneToOne, flag);
  }

  setOneToMany(flag: boolean = true): Relationship {
    if (flag) {
      this.setOneToOne(false).setManyToMany(false);
    }
    return this.setProperty(OneToMany, flag);
  }

  setManyToMany(flag: boolean = true): Relationship {
    this.setOneToOne(false).setOneToMany(false);
    return this.setProperty(ManyToMany, flag);
  }

  isFirstNode(inst: Instance): boolean {
    return this.isFirstNodeName(inst.getFqName());
  }

  getAliasFor(inst: Instance): string {
    return this.getAliasForName(inst.getFqName());
  }

  getInverseAliasFor(inst: Instance): string {
    return this.getInverseAliasForName(inst.getFqName());
  }

  isFirstNodeName(fqName: string): boolean {
    return fqName == this.node1.path.asFqName();
  }

  getAliasForName(fqName: string): string {
    if (this.isFirstNodeName(fqName)) {
      return this.node1.alias;
    } else {
      return this.node2.alias;
    }
  }

  getInverseAliasForName(fqName: string): string {
    if (this.isFirstNodeName(fqName)) {
      return this.node2.alias;
    } else {
      return this.node1.alias;
    }
  }

  isParent(inst: Instance): boolean {
    return inst.getFqName() == this.node1.path.asFqName();
  }

  getParentFqName(): string {
    return this.node1.path.asFqName();
  }

  getChildFqName(): string {
    return this.node2.path.asFqName();
  }

  override toString(): string {
    const n1 = relNodeEntryToString(this.node1);
    const n2 = relNodeEntryToString(this.node2);
    let s = `relationship ${this.name} ${RelType[this.relType].toLowerCase()} (${n1}, ${n2})`;
    if (this.isBetween()) {
      if (this.isOneToOne()) {
        s = `${s} @${OneToOne}`;
      } else if (this.isOneToMany()) {
        s = `${s} @${OneToMany}`;
      }
    }
    if (this.getUserAttributes().size > 0) {
      const attrs: Array<string> = [];
      this.getUserAttributes().forEach((attrSpec: AttributeSpec, n: string) => {
        attrs.push(`${n} ${attributeSpecToString(attrSpec)}`);
      });
      s = s.concat(`{\n ${attrs.join(',\n')} }`);
    }
    return s.concat('\n');
  }
}

export class Workflow extends ModuleEntry {
  statements: Statement[];
  generatedName: boolean;

  constructor(
    name: string,
    patterns: Statement[],
    moduleName: string,
    generatedName: boolean = false
  ) {
    super(name, moduleName);
    this.statements = patterns;
    this.generatedName = generatedName;
  }

  async addStatement(stmtCode: string): Promise<Workflow> {
    const result: Statement = await parseStatement(stmtCode);
    this.statements.push(result);
    return this;
  }

  setStatementAtHelper(
    statements: Statement[],
    newStmt: Statement | undefined,
    index: number[]
  ): Workflow {
    let stmt = statements[index[0]];
    const isFe = stmt.pattern.forEach;
    const isIf = stmt.pattern.if;
    if (isFe || isIf) {
      for (let i = 1; i < index.length; ++i) {
        const found = i == index.length - 1;
        let idx = index[i];
        if (stmt.pattern.forEach) {
          if (found) {
            if (!newStmt) {
              stmt.pattern.forEach.statements.splice(idx, 1);
            } else {
              stmt.pattern.forEach.statements[idx] = newStmt;
            }
          } else stmt = stmt.pattern.forEach.statements[idx];
        } else if (stmt.pattern.if) {
          if (idx < 0 || isMinusZero(idx)) {
            if (stmt.pattern.if.else) {
              idx *= -1;
              if (found) {
                if (!newStmt) {
                  stmt.pattern.if.else.statements.splice(idx, 1);
                } else {
                  stmt.pattern.if.else.statements[idx] = newStmt;
                }
              } else stmt = stmt.pattern.if.else.statements[idx];
            } else {
              throw new Error('No else part in if');
            }
          } else {
            if (found) {
              if (!newStmt) {
                stmt.pattern.if.statements.splice(idx, 1);
              } else {
                stmt.pattern.if.statements[idx] = newStmt;
              }
            } else stmt = stmt.pattern.if.statements[idx];
          }
        } else {
          throw new Error('Cannot dig further into statements');
        }
      }
    }
    return this;
  }

  async setStatementAt(stmtCode: string, index: number | number[]): Promise<Workflow> {
    const result: Statement = await parseStatement(stmtCode);
    if (index instanceof Array) {
      if (index.length == 1) {
        this.statements[index[0]] = result;
        return this;
      } else {
        return this.setStatementAtHelper(this.statements, result, index);
      }
    } else {
      this.statements[index] = result;
    }
    return this;
  }

  removeStatementAt(index: number | number[]): Workflow {
    if (index instanceof Array) {
      if (index.length == 1) {
        this.statements.splice(index[0], 1);
        return this;
      } else {
        return this.setStatementAtHelper(this.statements, undefined, index);
      }
    } else {
      this.statements.splice(index, 1);
    }
    return this;
  }

  private statementsToStringsHelper(statements: Statement[]): string[] {
    const ss: Array<string> = [];
    statements.forEach((stmt: Statement) => {
      if (stmt.pattern.forEach) {
        ss.push(`   for ${stmt.pattern.forEach.var} in ${stmt.pattern.forEach.src.$cstNode?.text} {
        ${joinStatements(this.statementsToStringsHelper(stmt.pattern.forEach.statements))}
    }`);
      } else if (stmt.pattern.if) {
        let s = `   if (${stmt.pattern.if.cond.$cstNode?.text}) {
        ${joinStatements(this.statementsToStringsHelper(stmt.pattern.if.statements))}
    }`;
        if (stmt.pattern.if.else) {
          s = s.concat(` else {
            ${joinStatements(this.statementsToStringsHelper(stmt.pattern.if.else.statements))}
    }`);
        }
        ss.push(s);
      } else if (stmt.$cstNode) {
        ss.push(`    ${stmt.$cstNode.text.trimStart()}`);
      }
    });
    return ss;
  }

  statementsToStrings(): string[] {
    return this.statementsToStringsHelper(this.statements);
  }

  override toString() {
    const n = this.generatedName ? untangleWorkflowName(this.name) : this.name;
    let s: string = `workflow ${normalizeWorkflowName(n)} {\n`;
    const ss = this.statementsToStringsHelper(this.statements);
    s = s.concat(joinStatements(ss));
    return s.concat('\n}');
  }
}

const EmptyWorkflow: Workflow = new Workflow('', [], DefaultModuleName);

export function isEmptyWorkflow(wf: Workflow): boolean {
  return wf == EmptyWorkflow;
}

export class Module {
  name: string;
  entries: ModuleEntry[];
  entriesByTypeCache: Map<RecordType, ModuleEntry[]> | null;

  constructor(name: string) {
    this.name = name;
    this.entries = new Array<ModuleEntry>();
    this.entriesByTypeCache = null;
  }

  addEntry(entry: ModuleEntry): ModuleEntry {
    this.entries.push(entry);
    if (this.entriesByTypeCache != null) this.entriesByTypeCache = null;
    return entry;
  }

  getConfigEntity(): Entity | undefined {
    return this.getEntityEntries().find((e: Entity) => {
      return e.isConfigEntity();
    });
  }

  addAgent(agentEntry: Agent): Agent {
    return this.addEntry(agentEntry) as Agent;
  }

  getAgent(agentName: string): Agent | undefined {
    const n = Agent.EscapeName(agentName);
    if (this.hasEntry(n)) {
      return this.getEntry(n) as Agent;
    }
    return undefined;
  }

  removeAgent(agentName: string): boolean {
    return this.removeEntry(Agent.EscapeName(agentName));
  }

  private getEntryIndex(entryName: string): number {
    return this.entries.findIndex((v: ModuleEntry) => {
      return v.name == entryName;
    });
  }

  hasEntry(entryName: string): boolean {
    return this.getEntryIndex(entryName) >= 0;
  }

  getEntry(entryName: string): ModuleEntry {
    const idx: number = this.getEntryIndex(entryName);
    if (idx < 0) throw new Error(`Entry ${entryName} not found in module ${this.name}`);
    return this.entries[idx];
  }

  getRecord(recordName: string): Record {
    const e: ModuleEntry = this.getEntry(recordName);
    if (e instanceof Record) {
      return e as Record;
    }
    throw new Error(`${recordName} is not a record in module ${this.name}`);
  }

  removeEntry(entryName: string): boolean {
    const idx: number = this.getEntryIndex(entryName);
    if (idx >= 0) {
      this.entries.splice(idx, 1);
      if (this.entriesByTypeCache != null) this.entriesByTypeCache = null;
      return true;
    }
    return false;
  }

  private getEntriesOfType(t: RecordType): ModuleEntry[] {
    if (this.entriesByTypeCache != null && this.entriesByTypeCache.has(t)) {
      const result: ModuleEntry[] | undefined = this.entriesByTypeCache.get(t);
      if (result == undefined) return new Array<ModuleEntry>();
      return result;
    } else {
      const result: ModuleEntry[] = this.entries.filter((v: ModuleEntry) => {
        const r: Record = v as Record;
        return r.type == t;
      });
      if (this.entriesByTypeCache != null)
        this.entriesByTypeCache = new Map<RecordType, ModuleEntry[]>();
      this.entriesByTypeCache?.set(t, result);
      return result;
    }
  }

  getEntityEntries(): Entity[] {
    return this.getEntriesOfType(RecordType.ENTITY) as Entity[];
  }

  getEventEntries(): Event[] {
    return this.getEntriesOfType(RecordType.EVENT) as Event[];
  }

  getRecordEntries(): Record[] {
    return this.getEntriesOfType(RecordType.RECORD) as Record[];
  }

  getAgents(): Agent[] {
    return this.getEntriesOfType(RecordType.AGENT) as Agent[];
  }

  getAgentNames(): string[] {
    return this.getAgents().map((ae: Agent) => {
      return Agent.NormalizeName(ae.name);
    });
  }

  getRelationshipEntries(): Relationship[] {
    return this.getEntriesOfType(RecordType.RELATIONSHIP) as Relationship[];
  }

  private getRelationshipEntriesOfType(t: RelType) {
    const rels: Relationship[] = this.getRelationshipEntries();
    return rels.filter((e: Relationship) => {
      return e.relType == t;
    });
  }

  getBetweenRelationshipEntries(): Relationship[] {
    return this.getRelationshipEntriesOfType(RelType.BETWEEN);
  }

  getContainsRelationshipEntries(): Relationship[] {
    return this.getRelationshipEntriesOfType(RelType.CONTAINS);
  }

  getBetweenRelationshipEntriesThatNeedStore(): Relationship[] {
    return this.getBetweenRelationshipEntries().filter((re: Relationship) => {
      return re.isManyToMany() || re.isOneToMany();
    });
  }

  getWorkflowForEvent(eventName: string): Workflow {
    return this.getEntry(asWorkflowName(eventName)) as Workflow;
  }

  isPrePostEvent(eventName: string): boolean {
    return this.getWorkflowForEvent(eventName).generatedName;
  }

  isEntryOfType(t: RecordType, name: string): boolean {
    const entry: ModuleEntry | undefined = this.getEntriesOfType(t).find((v: ModuleEntry) => {
      const r: Record = v as Record;
      return r.name == name;
    });
    return entry != undefined;
  }

  isEntity(name: string): boolean {
    return this.isEntryOfType(RecordType.ENTITY, name);
  }

  isEvent(name: string): boolean {
    return this.isEntryOfType(RecordType.EVENT, name);
  }

  isRecord(name: string): boolean {
    return this.isEntryOfType(RecordType.RECORD, name);
  }

  isRelationship(name: string): boolean {
    return this.isEntryOfType(RecordType.RELATIONSHIP, name);
  }

  getEntityNames(): string[] {
    const names: string[] = [];
    this.getEntityEntries().forEach((me: ModuleEntry) => {
      names.push(me.name);
    });
    return names;
  }

  getEventNames(): string[] {
    const names: string[] = [];
    this.getEventEntries().forEach((me: ModuleEntry) => {
      names.push(me.name);
    });
    return names;
  }

  getRecordNames(): string[] {
    const names: string[] = [];
    this.getRecordEntries().forEach((me: ModuleEntry) => {
      names.push(me.name);
    });
    return names;
  }

  getRelationshipNames(): string[] {
    const names: string[] = [];
    this.getRelationshipEntries().forEach((me: ModuleEntry) => {
      names.push(me.name);
    });
    return names;
  }

  isContainsRelationship(entryName: string): boolean {
    if (this.hasEntry(entryName)) {
      const entry: ModuleEntry = this.getEntry(entryName);
      if (entry instanceof Relationship) return entry.isContains();
    }
    return false;
  }

  isBetweenRelationship(entryName: string): boolean {
    if (this.hasEntry(entryName)) {
      const entry: ModuleEntry = this.getEntry(entryName);
      if (entry instanceof Relationship) return entry.isBetween();
    }
    return false;
  }

  toString(): string {
    const ss: Array<string> = [];
    this.entries.forEach((me: ModuleEntry) => {
      if (me instanceof Event && isAgentEvent(me)) {
        return;
      }
      ss.push(me.toString());
    });
    return `module ${this.name}\n\n${ss.join('\n')}`;
  }
}

const moduleDb = new Map<string, Module>();
let activeModule: string = '';

export function getActiveModuleName() {
  return activeModule;
}

export function addModule(name: string): Module {
  const mod: Module = new Module(name);
  moduleDb.set(name, mod);
  activeModule = name;
  return mod;
}

export function removeModule(name: string): boolean {
  if (moduleDb.has(name)) {
    moduleDb.delete(name);
    return true;
  }
  return false;
}

addModule(DefaultModuleName);
addRecord('env', DefaultModuleName);

export function getModuleNames(): string[] {
  const ks: Iterable<string> = moduleDb.keys();
  return Array.from(ks);
}

export function getUserModuleNames(): string[] {
  const result: Array<string> = new Array<string>();
  Array.from(moduleDb.keys()).forEach((n: string) => {
    if (!DefaultModules.has(n)) {
      result.push(n);
    }
  });
  return result;
}

export function isModule(name: string): boolean {
  return moduleDb.has(name);
}

export function fetchModule(moduleName: string): Module {
  const module: Module | undefined = moduleDb.get(moduleName);
  if (module == undefined) {
    throw new Error(`Module not found - ${moduleName}`);
  }
  return module;
}

export function allModuleNames(): string[] {
  return [...moduleDb.keys()];
}

export function fetchModuleEntry(entryName: string, moduleName: string): ModuleEntry {
  const module: Module = fetchModule(moduleName);
  return module.getEntry(entryName);
}

const builtInChecks = new Map([
  ['String', isString],
  ['Int', Number.isSafeInteger],
  ['Number', isNumber],
  ['Email', isString],
  ['Date', isString],
  ['Time', isString],
  ['DateTime', isString],
  ['Boolean', isBoolean],
  ['UUID', isString],
  ['URL', isString],
  ['Path', isPath],
  ['Password', isString],
  [
    'Map',
    (obj: any) => {
      return obj instanceof Object || obj instanceof Map;
    },
  ],
  [
    'Any',
    (_: any) => {
      return true;
    },
  ],
]);

export const builtInTypes = new Set(Array.from(builtInChecks.keys()));
export const propertyNames = new Set([
  '@id',
  '@indexed',
  '@default',
  '@optional',
  '@check',
  '@unique',
  '@autoincrement',
  '@array',
  '@object',
  '@fk',
  '@ref',
  '@readonly',
  '@enum',
  '@oneof',
  '@comment',
]);

const TextualTypes = new Set(['String', 'Email', 'UUID', 'DateTime', 'Date', 'Time', 'Path']);

function isTextualType(type: string): boolean {
  return TextualTypes.has(type);
}

export function isBuiltInType(type: string): boolean {
  return builtInTypes.has(type);
}

export function isValidType(type: string): boolean {
  if (isBuiltInType(type)) return true;
  const path: Path = splitFqName(type);
  let modName: string = '';
  if (path.hasModule()) modName = path.getModuleName();
  else modName = activeModule;
  return isModule(modName) && fetchModule(modName).hasEntry(path.getEntryName());
}

function checkType(type: string | undefined): void {
  if (type == undefined) throw new Error('Attribute type is required');
  if (!isValidType(type)) {
    console.log(chalk.red(`WARN: type not found - ${type}`));
  }
}

function validateProperties(props: PropertyDefinition[] | undefined): void {
  if (props != undefined) {
    props.forEach((p: PropertyDefinition) => {
      if (!propertyNames.has(p.name)) throw new Error(`Invalid property ${p.name}`);
    });
  }
}

function verifyAttribute(attr: AttributeDefinition): void {
  if (attr.expr) return;
  if (!attr.enumSpec && !attr.oneOfSpec && !attr.refSpec) checkType(attr.type || attr.arrayType);
  validateProperties(attr.properties);
}

export function defaultAttributes(schema: RecordSchema): Map<string, any> {
  const result: Map<string, any> = new Map<string, any>();
  schema.forEach((v: AttributeSpec, k: string) => {
    const props: Map<string, any> | undefined = v.properties;
    if (props != undefined) {
      const d: any | undefined = props.get('default');
      if (d != undefined) {
        result.set(k, d);
      }
    }
  });
  return result;
}

export function passwordAttributes(schema: RecordSchema): Set<string> | undefined {
  let result: Set<string> | undefined = undefined;
  schema.forEach((v: AttributeSpec, k: string) => {
    if (v.type == 'Password') {
      if (result == undefined) {
        result = new Set<string>();
      }
      result?.add(k);
    }
  });
  return result;
}

export function objectAttributes(schema: RecordSchema): Array<string> | undefined {
  let result: Array<string> | undefined;
  schema.forEach((v: AttributeSpec, k: string) => {
    if (isObjectAttribute(v)) {
      if (result == undefined) result = new Array<string>();
      result.push(k);
    }
  });
  return result;
}

function getBooleanProperty(propName: string, attrSpec: AttributeSpec): boolean {
  if (attrSpec.properties != undefined) {
    return attrSpec.properties.get(propName) == true;
  }
  return false;
}

function getAnyProperty(propName: string, attrSpec: AttributeSpec): any | undefined {
  if (attrSpec.properties != undefined) {
    return attrSpec.properties.get(propName);
  }
  return undefined;
}

function setAnyProperty(propName: string, value: any, attrSpec: AttributeSpec): AttributeSpec {
  if (attrSpec.properties == undefined) {
    attrSpec.properties = new Map();
  }
  attrSpec.properties.set(propName, value);
  return attrSpec;
}

export function isIdAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('id', attrSpec);
}

export function asIdAttribute(attrSpec: AttributeSpec): AttributeSpec {
  return setAnyProperty('id', true, attrSpec);
}

export function isUniqueAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('unique', attrSpec);
}

export function asUniqueAttribute(attrSpec: AttributeSpec): AttributeSpec {
  return setAnyProperty('unique', true, attrSpec);
}

export function isIndexedAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('indexed', attrSpec);
}

export function asIndexedAttribute(attrSpec: AttributeSpec): AttributeSpec {
  return setAnyProperty('indexed', true, attrSpec);
}

export function isOptionalAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('optional', attrSpec);
}

export function asOptionalAttribute(attrSpec: AttributeSpec): AttributeSpec {
  return setAnyProperty('optional', true, attrSpec);
}

export function isArrayAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('array', attrSpec);
}

export function isObjectAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('object', attrSpec);
}

export function getAttributeExpr(attrSpec: AttributeSpec): Expr | undefined {
  return getAnyProperty('expr', attrSpec);
}

export function getEnumValues(attrSpec: AttributeSpec): Set<string> | undefined {
  return getAnyProperty(EnumPropertyName, attrSpec);
}

export function getOneOfRef(attrSpec: AttributeSpec): string | undefined {
  return getAnyProperty(OneOfPropertyName, attrSpec);
}

export function getAttributeDefaultValue(attrSpec: AttributeSpec): any | undefined {
  return getAnyProperty('default', attrSpec);
}

export function setDefaultAttributeValue(attrSpec: AttributeSpec, value: any): AttributeSpec {
  return setAnyProperty('default', value, attrSpec);
}

export function getAttributeLength(attrSpec: AttributeSpec): number | undefined {
  return getAnyProperty('length', attrSpec);
}

export function getFkSpec(attrSpec: AttributeSpec): string | undefined {
  return getAnyProperty('fk', attrSpec) as string;
}

export function getRefSpec(attrSpec: AttributeSpec): string | undefined {
  return getAnyProperty('ref', attrSpec) as string;
}

export function addEntity(
  name: string,
  moduleName = activeModule,
  scm?: RecordSchemaDefinition,
  ext?: string
): Entity {
  const module: Module = fetchModule(moduleName);
  return module.addEntry(new Entity(name, moduleName, scm, ext)) as Entity;
}

export function addEvent(
  name: string,
  moduleName = activeModule,
  scm?: RecordSchemaDefinition,
  ext?: string
): Event {
  const module: Module = fetchModule(moduleName);
  return module.addEntry(new Event(name, moduleName, scm, ext)) as Event;
}

export function addRecord(
  name: string,
  moduleName = activeModule,
  scm?: RecordSchemaDefinition,
  ext?: string
): Record {
  const module: Module = fetchModule(moduleName);
  return module.addEntry(new Record(name, moduleName, scm, ext)) as Record;
}

export function addRelationship(
  name: string,
  type: 'contains' | 'between',
  nodes: RelNodes | RelationshipNode[],
  moduleName = activeModule,
  scm?: RecordSchemaDefinition,
  props?: PropertyDefinition[]
): Relationship {
  const module: Module = fetchModule(moduleName);
  let n1: RelationshipNode | undefined;
  let n2: RelationshipNode | undefined;
  if (isRelNodes(nodes)) {
    n1 = asRelNodeEntry(nodes.node1);
    n2 = asRelNodeEntry(nodes.node2);
  } else {
    n1 = nodes[0];
    n2 = nodes[1];
  }
  let propsMap: Map<string, any> | undefined;
  if (props != undefined) propsMap = asPropertiesMap(props);
  return module.addEntry(
    new Relationship(name, type, n1, n2, moduleName, scm, propsMap)
  ) as Relationship;
}

export function addBetweenRelationship(
  name: string,
  moduleName: string,
  nodes: RelationshipNode[]
): Relationship {
  return addRelationship(name, 'between', nodes, moduleName);
}

export function addContainsRelationship(
  name: string,
  moduleName: string,
  nodes: RelationshipNode[]
): Relationship {
  return addRelationship(name, 'contains', nodes, moduleName);
}

export function addAgent(name: string, attrs: InstanceAttributes, moduleName: string): Agent {
  const m = fetchModule(moduleName);
  return m.addAgent(new Agent(name, moduleName, attrs)) as Agent;
}

function asWorkflowName(n: string): string {
  return n + '--workflow';
}

function normalizeWorkflowName(n: string): string {
  const i = n.indexOf('--workflow');
  if (i > 0) {
    return n.substring(0, i);
  }
  return n;
}

export type PrePostTag = '@after' | '@before';
export type PrePostOpr = 'create' | 'update' | 'delete';

export type ThinWfHeader = {
  tag: PrePostTag;
  prefix: PrePostOpr;
  name: string;
};

export function addWorkflow(
  name: string,
  moduleName = activeModule,
  statements?: Statement[],
  hdr?: WorkflowHeader | ThinWfHeader
): Workflow {
  if (hdr) {
    name = prePostWorkflowName(hdr.tag, hdr.prefix, hdr.name, moduleName);
  }
  const module: Module = fetchModule(moduleName);
  if (module.hasEntry(name)) {
    const entry: ModuleEntry = module.getEntry(name);
    if (!(entry instanceof Event))
      throw new Error(`Not an event, cannot attach workflow to ${entry.name}`);
  } else {
    addEvent(name, moduleName);
    const event: Record = module.getEntry(name) as Record;
    event.addMeta(SystemDefinedEvent, 'true');
  }
  if (!statements) statements = new Array<Statement>();
  if (hdr) {
    const eventFqName = makeFqName(moduleName, name);
    const entityDef = getEntityDef(hdr.name, moduleName);
    if (hdr.tag == '@after') {
      entityDef?.addAfterTrigger({
        on: hdr.prefix,
        event: eventFqName,
        async: false,
      });
    } else {
      entityDef?.addBeforeTrigger({
        on: hdr.prefix,
        event: eventFqName,
        async: false,
      });
    }
  }
  return module.addEntry(
    new Workflow(asWorkflowName(name), statements, moduleName, hdr ? true : false)
  ) as Workflow;
}

function addPrePostWorkflow(
  tag: PrePostTag,
  opr: PrePostOpr,
  entityName: string,
  moduleName = activeModule,
  statements?: Statement[]
): Workflow {
  const hdr: ThinWfHeader = {
    tag: tag,
    prefix: opr,
    name: entityName,
  };
  return addWorkflow('', moduleName, statements, hdr);
}

export function addAfterCreateWorkflow(
  entityName: string,
  moduleName = activeModule,
  statements?: Statement[]
): Workflow {
  return addPrePostWorkflow('@after', 'create', entityName, moduleName, statements);
}

export function addAfterUpdateWorkflow(
  entityName: string,
  moduleName = activeModule,
  statements?: Statement[]
): Workflow {
  return addPrePostWorkflow('@after', 'update', entityName, moduleName, statements);
}

export function addAfterDeleteWorkflow(
  entityName: string,
  moduleName = activeModule,
  statements?: Statement[]
): Workflow {
  return addPrePostWorkflow('@after', 'delete', entityName, moduleName, statements);
}

export function addBeforeCreateWorkflow(
  entityName: string,
  moduleName = activeModule,
  statements?: Statement[]
): Workflow {
  return addPrePostWorkflow('@before', 'create', entityName, moduleName, statements);
}

export function addBeforeUpdateWorkflow(
  entityName: string,
  moduleName = activeModule,
  statements?: Statement[]
): Workflow {
  return addPrePostWorkflow('@before', 'update', entityName, moduleName, statements);
}

export function addBeforeDeleteWorkflow(
  entityName: string,
  moduleName = activeModule,
  statements?: Statement[]
): Workflow {
  return addPrePostWorkflow('@before', 'delete', entityName, moduleName, statements);
}

export function prePostWorkflowName(
  tag: PrePostTag,
  opr: PrePostOpr,
  entityName: string,
  moduleName?: string
): string {
  const parts = splitFqName(entityName);
  const mname = parts.hasModule() ? parts.getModuleName() : moduleName;
  if (!mname) {
    throw new Error(`Cannot infer module name for ${entityName}`);
  }
  return `${tag.substring(1)}_${opr}_${mname}_${parts.getEntryName()}`;
}

export function untangleWorkflowName(name: string): string {
  const parts = name.split('_');
  return `@${parts[0]} ${parts[1]}:${parts[2]}/${parts[3]}`;
}

export function parsePrePostWorkflowName(name: string): ThinWfHeader {
  const s = untangleWorkflowName(name);
  const p1 = s.split('');
  const p2 = p1[1].split(':');
  return {
    tag: `@${p1[0]}` as PrePostTag,
    prefix: p2[0] as PrePostOpr,
    name: p2[1],
  };
}

function getEntityDef(entityName: string, moduleName: string): Entity | undefined {
  const parts = splitFqName(entityName);
  const mname = parts.hasModule() ? parts.getModuleName() : moduleName;
  return getEntity(parts.getEntryName(), mname);
}

export function getWorkflow(eventInstance: Instance): Workflow {
  const eventName: string = eventInstance.name;
  const moduleName: string = eventInstance.moduleName;
  const wfName: string = asWorkflowName(eventName);
  const module: Module = fetchModule(moduleName);
  if (module.hasEntry(wfName)) {
    return module.getEntry(wfName) as Workflow;
  }
  return EmptyWorkflow;
}

export function getEntity(name: string, moduleName: string): Entity | undefined {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(name, moduleName);
  if (fr.module.isEntity(fr.entryName)) {
    return fr.module.getEntry(fr.entryName) as Entity;
  }
  logger.error(`Entity ${fr.entryName} not found in module ${fr.moduleName}`);
  return undefined;
}

function isEntryOfType(t: RecordType, fqName: string): boolean {
  const path = splitFqName(fqName);
  const mod = fetchModule(path.getModuleName());
  return mod.isEntryOfType(t, path.getEntryName());
}

export function isEntity(fqName: string): boolean {
  return isEntryOfType(RecordType.ENTITY, fqName);
}

export function isEvent(fqName: string): boolean {
  return isEntryOfType(RecordType.EVENT, fqName);
}

export function isRecord(fqName: string): boolean {
  return isEntryOfType(RecordType.RECORD, fqName);
}

export function isRelationship(fqName: string): boolean {
  return isEntryOfType(RecordType.RELATIONSHIP, fqName);
}

export function getEvent(name: string, moduleName: string): Event {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(name, moduleName);
  if (fr.module.isEvent(fr.entryName)) {
    return fr.module.getEntry(fr.entryName) as Event;
  }
  throw new Error(`Event ${fr.entryName} not found in module ${fr.moduleName}`);
}

export function getRecord(name: string, moduleName: string): Record {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(name, moduleName);
  if (fr.module.isRecord(fr.entryName)) {
    return fr.module.getEntry(fr.entryName) as Record;
  }
  throw new Error(`Record ${fr.entryName} not found in module ${fr.moduleName}`);
}

export function getRelationship(name: string, moduleName: string): Relationship {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(name, moduleName);
  if (fr.module.isRelationship(fr.entryName)) {
    return fr.module.getEntry(fr.entryName) as Relationship;
  }
  throw new Error(`Relationship ${fr.entryName} not found in module ${fr.moduleName}`);
}

export function getAllBetweenRelationships(): Relationship[] {
  let result: Relationship[] = [];
  allModuleNames().forEach((moduleName: string) => {
    const mod = fetchModule(moduleName);
    result = result.concat(mod.getBetweenRelationshipEntries());
  });
  return result;
}

export function getAllChildRelationships(parentFqName: string): Relationship[] {
  let result = new Array<Relationship>();
  allModuleNames().forEach((moduleName: string) => {
    const mod = fetchModule(moduleName);
    result = result.concat(
      mod.getContainsRelationshipEntries().filter((rel: Relationship) => {
        return rel.getParentFqName() == parentFqName;
      })
    );
  });
  return result;
}

function filterBetweenRelationshipsForEntity(
  moduleName: string,
  entityName: string,
  predic: Function,
  allBetweenRels?: Relationship[]
): Relationship[] {
  if (allBetweenRels == undefined) {
    allBetweenRels = getAllBetweenRelationships();
  }
  const p = new Path(moduleName, entityName);
  return allBetweenRels.filter((re: Relationship) => {
    return predic(re, p);
  });
}

export function getAllBetweenRelationshipsForEntity(
  moduleName: string,
  entityName: string,
  allBetweenRels?: Relationship[]
): Relationship[] {
  return filterBetweenRelationshipsForEntity(
    moduleName,
    entityName,
    (re: Relationship, p: Path) => {
      return re.node1.path.equals(p) || re.node2.path.equals(p);
    },
    allBetweenRels
  );
}

export function getAllOneToOneRelationshipsForEntity(
  moduleName: string,
  entityName: string,
  allBetweenRels?: Relationship[]
): Relationship[] {
  return filterBetweenRelationshipsForEntity(
    moduleName,
    entityName,
    (re: Relationship, p: Path) => {
      return re.isOneToOne() && (re.node1.path.equals(p) || re.node2.path.equals(p));
    },
    allBetweenRels
  );
}

export function getAllOneToManyRelationshipsForEntity(
  moduleName: string,
  entityName: string,
  allBetweenRels?: Relationship[]
): Relationship[] {
  return filterBetweenRelationshipsForEntity(
    moduleName,
    entityName,
    (re: Relationship, p: Path) => {
      return re.isOneToMany() && re.node1.path.equals(p);
    },
    allBetweenRels
  );
}

export function getAllManyToOneRelationshipsForEntity(
  moduleName: string,
  entityName: string,
  allBetweenRels?: Relationship[]
): Relationship[] {
  return filterBetweenRelationshipsForEntity(
    moduleName,
    entityName,
    (re: Relationship, p: Path) => {
      return re.isOneToMany() && re.node2.path.equals(p);
    },
    allBetweenRels
  );
}

export function getAllManyToManyRelationshipsForEntity(
  moduleName: string,
  entityName: string,
  allBetweenRels?: Relationship[]
): Relationship[] {
  return filterBetweenRelationshipsForEntity(
    moduleName,
    entityName,
    (re: Relationship, p: Path) => {
      return re.isManyToMany() && re.node1.path.equals(p);
    },
    allBetweenRels
  );
}

export function getEntrySchema(name: string, moduleName: string): RecordSchema {
  const m: Module = fetchModule(moduleName);
  const r: Record = m.getEntry(name) as Record;
  return r.schema;
}

export function removeEntity(name: string, moduleName = activeModule): boolean {
  const module: Module = fetchModule(moduleName);
  if (module.isEntity(name)) {
    return module.removeEntry(name);
  }
  return false;
}

export function removeRecord(name: string, moduleName = activeModule): boolean {
  const module: Module = fetchModule(moduleName);
  if (module.isRecord(name)) {
    return module.removeEntry(name);
  }
  return false;
}

export function removeRelationship(name: string, moduleName = activeModule): boolean {
  const module: Module = fetchModule(moduleName);
  if (module.isRelationship(name)) {
    return module.removeEntry(name);
  }
  return false;
}

export function removeWorkflow(name: string, moduleName = activeModule): boolean {
  const module: Module = fetchModule(moduleName);
  return module.removeEntry(asWorkflowName(name));
}

export function removeEvent(name: string, moduleName = activeModule): boolean {
  const module: Module = fetchModule(moduleName);
  if (module.isEvent(name)) {
    const r: boolean = module.removeEntry(name);
    if (r) {
      module.removeEntry(asWorkflowName(name));
      return r;
    }
  }
  return false;
}

function getAttributeSpec(attrsSpec: RecordSchema, attrName: string): AttributeSpec {
  const spec: AttributeSpec | undefined = attrsSpec.get(attrName);
  if (spec == undefined) {
    throw new Error(`Failed to find spec for attribute ${attrName}`);
  }
  return spec;
}

function checkOneOfValue(attrSpec: AttributeSpec, attrName: string, attrValue: any): boolean {
  if (getOneOfRef(attrSpec)) {
    return true;
  }
  const vals: Set<string> | undefined = getEnumValues(attrSpec);
  if (vals) {
    if (!vals.has(attrValue as string)) {
      throw new Error(`Value of ${attrName} must be one of ${vals}`);
    }
    return true;
  }
  return false;
}

function getCheckPredicate(attrSpec: AttributeSpec): any {
  const p = getAnyProperty('check', attrSpec);
  if (isString(p)) {
    return FetchModuleFn(p);
  }
  return undefined;
}

function validateType(attrName: string, attrValue: any, attrSpec: AttributeSpec) {
  if (attrSpec.type == 'Path') {
    if (!isPath(attrValue, getRefSpec(attrSpec))) {
      throw new Error(`Failed to validate Path ${attrValue} passed to ${attrName}`);
    }
  }
  let predic = getCheckPredicate(attrSpec);
  predic = predic ? predic : builtInChecks.get(attrSpec.type);
  if (predic != undefined) {
    if (isArrayAttribute(attrSpec)) {
      if (!(attrValue instanceof Array)) {
        throw new Error(`${attrName} expects an array of values`);
      } else {
        if (!attrValue.every(predic)) {
          throw new Error(`Invalid value in the array passed to ${attrName}`);
        }
      }
    } else {
      if (!checkOneOfValue(attrSpec, attrName, attrValue)) {
        if (!predic(attrValue)) {
          throw new Error(`Invalid value ${attrValue} specified for ${attrName}`);
        }
      }
    }
  } else {
    checkOneOfValue(attrSpec, attrName, attrValue);
  }
}

export type InstanceAttributes = Map<string, any>;

export function newInstanceAttributes(): InstanceAttributes {
  return new Map<string, any>();
}

const EmptyInstanceAttributes: InstanceAttributes = newInstanceAttributes();

export class Instance {
  record: Record;
  name: string;
  moduleName: string;
  attributes: InstanceAttributes;
  queryAttributes: InstanceAttributes | undefined;
  queryAttributeValues: InstanceAttributes | undefined;
  relatedInstances: Map<string, Instance[]> | undefined;
  private contextData: Map<string, any> | undefined;

  constructor(
    record: Record,
    moduleName: string,
    name: string,
    attributes: InstanceAttributes,
    queryAttributes?: InstanceAttributes,
    queryAttributeValues?: InstanceAttributes
  ) {
    this.record = record;
    this.name = name;
    this.moduleName = moduleName;
    this.attributes = attributes;
    this.queryAttributes = queryAttributes;
    this.queryAttributeValues = queryAttributeValues;
  }

  static EmptyInstance(name: string, moduleName: string): Instance {
    const module: Module = fetchModule(moduleName);
    return new Instance(module.getEntry(name) as Record, moduleName, name, EmptyInstanceAttributes);
  }

  static newWithAttributes(inst: Instance, newAttrs: InstanceAttributes): Instance {
    return new Instance(
      inst.record,
      inst.moduleName,
      inst.name,
      inst.normalizeAttributes(newAttrs)
    );
  }

  static clone(inst: Instance): Instance {
    const attrs = newInstanceAttributes();
    inst.attributes.forEach((v: any, k: string) => {
      attrs.set(k, v);
    });
    return Instance.newWithAttributes(inst, attrs);
  }

  normalizeAttributes(attrs: InstanceAttributes): InstanceAttributes {
    attrs.forEach((v: any, k: string) => {
      const attrSpec = this.record.schema.get(k);
      if (attrSpec) {
        if ((isArrayAttribute(attrSpec) || isObjectAttribute(attrSpec)) && isString(v)) {
          const obj: any = JSON.parse(v);
          attrs.set(k, obj);
        }
      }
    });
    return attrs;
  }

  requireAudit(): boolean {
    return this.record.getMeta('audit');
  }

  lookup(k: string): any {
    return this.attributes.get(k);
  }

  lookupQueryVal(k: string): any {
    return this.queryAttributeValues?.get(k);
  }

  getPath(): string {
    return this.lookup(PathAttributeName);
  }

  asSerializableObject(): object {
    const obj: any = {
      AL_INSTANCE: true,
      name: this.name,
      moduleName: this.moduleName,
      attributes: this.attributesAsObject(true),
    };
    if (this.queryAttributes) {
      obj.queryAttributes = this.queryAttributesAsObject();
      obj.queryAttributeValues = this.queryAttributeValuesAsObject();
    }
    if (this.relatedInstances) {
      const relsObj: any = {};
      this.relatedInstances.forEach((insts: Instance[], relName: string) => {
        relsObj[relName] = insts.map((inst: Instance) => {
          return inst.asSerializableObject();
        });
      });
      obj.relatedInstances = relsObj;
    }
    return obj;
  }

  static isSerializableObject(obj: any): boolean {
    return obj instanceof Object && obj.AL_INSTANCE == true;
  }

  static DeserializeAttributes(attrs: InstanceAttributes): InstanceAttributes {
    attrs.forEach((v: any, k: string) => {
      if (Instance.isSerializableObject(v)) {
        attrs.set(k, Instance.FromSerializableObject(v));
      }
    });
    return attrs;
  }

  static FromSerializableObject(obj: any, record?: Record): Instance {
    if (Instance.isSerializableObject(obj)) {
      const m = fetchModule(obj.moduleName);
      return new Instance(
        record || (m.getEntry(obj.name) as Record),
        obj.moduleName,
        obj.name,
        Instance.DeserializeAttributes(new Map(Object.entries(obj.attributes))),
        obj.queryAttributes ? new Map(Object.entries(obj.queryAttributes)) : undefined,
        obj.queryAttributeValues ? new Map(Object.entries(obj.queryAttributeValues)) : undefined
      );
    } else {
      throw new Error(`Cannot deserialize ${JSON.stringify(obj)} to an Instance`);
    }
  }

  asObject(): object {
    const result: Map<string, object> = new Map<string, object>();
    result.set(this.name, this.attributesAsObject());
    return Object.fromEntries(result);
  }

  static fromObject(name: string, moduleName: string, obj: object): Instance {
    const inst = Instance.EmptyInstance(name, moduleName);
    const attrs = new Map(Object.entries(obj));
    return Instance.newWithAttributes(inst, attrs);
  }

  static asSerializableValue(v: any, forSerialization: boolean): any {
    if (v instanceof Instance) {
      const inst = v as Instance;
      return forSerialization ? inst.asSerializableObject() : inst.asObject();
    } else if (v instanceof Object) {
      return v instanceof Map ? Object.fromEntries(v) : v;
    } else if (v instanceof Array) {
      return v.map((x: any) => {
        return Instance.asSerializableValue(x, forSerialization);
      });
    } else {
      return v;
    }
  }

  attributesAsObject(forSerialization: boolean = false): object {
    const attrs = newInstanceAttributes();
    this.attributes.forEach((v: any, k: string) => {
      attrs.set(k, Instance.asSerializableValue(v, forSerialization));
    });
    return Object.fromEntries(attrs);
  }

  static stringifyObjects(attributes: InstanceAttributes): object {
    const attrs = newInstanceAttributes();
    attributes.forEach((v: any, k: string) => {
      if (v instanceof Object) {
        attrs.set(k, JSON.stringify(v instanceof Map ? Object.fromEntries(v) : v));
      } else {
        attrs.set(k, v);
      }
    });
    return Object.fromEntries(attrs);
  }

  attributesWithStringifiedObjects(): object {
    return Instance.stringifyObjects(this.attributes);
  }

  queryAttributesAsObject(): object {
    if (this.queryAttributes != undefined) {
      return Object.fromEntries(this.queryAttributes);
    }
    return {};
  }

  queryAttributeValuesAsObject(): object {
    if (this.queryAttributeValues != undefined) {
      return Object.fromEntries(this.queryAttributeValues);
    }
    return {};
  }

  addQuery(attrName: string, op: string = '=', attrVal: any = undefined) {
    if (this.queryAttributes == undefined) this.queryAttributes = newInstanceAttributes();
    this.queryAttributes.set(attrName, op);
    if (attrVal != undefined) {
      if (this.queryAttributeValues == undefined)
        this.queryAttributeValues = newInstanceAttributes();
      this.queryAttributeValues.set(attrName, attrVal);
    }
  }

  mergeAttributes(newAttrs: InstanceAttributes): Instance {
    newAttrs.forEach((v: any, k: string) => {
      this.attributes.set(k, v);
    });
    return this;
  }

  attachRelatedInstances(relName: string, insts: Instance | Instance[]) {
    if (this.relatedInstances == undefined) {
      this.relatedInstances = new Map<string, Array<Instance>>();
    }
    let relInsts: Array<Instance> | undefined = this.relatedInstances.get(relName);
    if (relInsts == undefined) {
      relInsts = new Array<Instance>();
    }
    if (insts instanceof Instance) {
      relInsts.push(insts);
    } else {
      insts.forEach((inst: Instance) => {
        relInsts.push(inst);
      });
    }
    this.relatedInstances.set(relName, relInsts);
    this.attributes.set('->', this.relatedInstances);
  }

  detachAllRelatedInstance() {
    if (this.relatedInstances != undefined) {
      this.relatedInstances?.clear();
      this.relatedInstances = undefined;
      this.attributes.delete('->');
    }
  }

  mergeRelatedInstances() {
    if (this.relatedInstances != undefined) {
      this.relatedInstances.forEach((v: Instance[], k: string) => {
        this.attributes.set(k, v);
      });
      this.detachAllRelatedInstance();
    }
  }

  getRelatedInstances(relName: string): Instance[] | undefined {
    if (this.relatedInstances) {
      const insts: Instance[] | undefined = this.relatedInstances.get(relName);
      return insts ? insts : undefined;
    }
    return undefined;
  }

  getAllUserAttributeNames(): string[] {
    return this.record.getUserAttributeNames();
  }

  getFqName(): string {
    return makeFqName(this.moduleName, this.name);
  }

  addContextData(k: string, v: any): Instance {
    if (this.contextData == undefined) {
      this.contextData = new Map();
    }
    this.contextData.set(k, v);
    return this;
  }

  getContextData(k: string, notFoundValue?: any): any {
    if (this.contextData) {
      const v: any = this.contextData.get(k);
      if (v == undefined) return notFoundValue;
      return v;
    }
    return notFoundValue;
  }

  setAuthContext(sesssionInfo: ActiveSessionInfo): Instance {
    return this.addContextData('sessionInfo', sesssionInfo);
  }

  getAuthContext(): ActiveSessionInfo | undefined {
    return this.getContextData('sessionInfo', undefined);
  }

  getAuthContextUserId(): string {
    const sessInfo: ActiveSessionInfo = this.getContextData(
      'sessionInfo',
      AdminSession
    ) as ActiveSessionInfo;
    return sessInfo.userId;
  }

  getExprAttributes(): Map<string, Expr> | undefined {
    let result: Map<string, Expr> | undefined;
    this.record.schema.forEach((attrSpec: AttributeSpec, n: string) => {
      const expr = getAttributeExpr(attrSpec);
      if (expr) {
        if (result == undefined) {
          result = new Map<string, Expr>();
        }
        result.set(n, expr);
      }
    });
    return result;
  }

  cast<T>(): T {
    return Object.fromEntries(this.attributes) as T;
  }

  get(k: string): any {
    return this.attributes.get(k);
  }
}

export function objectAsInstanceAttributes(obj: object | undefined): InstanceAttributes {
  const attrs: InstanceAttributes = newInstanceAttributes();
  if (obj) {
    Object.entries(obj).forEach((v: [string, any]) => {
      const obj = v[1];
      attrs.set(v[0], obj);
    });
  }
  return attrs;
}

export type AttributeEntry = {
  name: string;
  spec: AttributeSpec;
};

export function findIdAttribute(inst: Instance): AttributeEntry | undefined {
  const schema: RecordSchema = inst.record.schema;
  for (const [key, value] of schema) {
    const attrSpec: AttributeSpec = value as AttributeSpec;
    if (isIdAttribute(attrSpec)) {
      return {
        name: key as string,
        spec: attrSpec,
      };
    }
  }
  return undefined;
}

function maybeSetDefaultAttributeValues(
  schema: RecordSchema,
  attributes: InstanceAttributes
): InstanceAttributes {
  const defAttrs = defaultAttributes(schema);
  defAttrs.forEach((v: any, k: string) => {
    const cv = attributes.get(k);
    if (cv == undefined || cv == null) {
      if (isString(v)) {
        if (v == 'uuid()') {
          v = crypto.randomUUID();
        } else if (v == 'now()') {
          v = now();
        }
      }
      attributes.set(k, v);
    }
  });
  return attributes;
}

function postProcessAttributes(
  schema: RecordSchema,
  attributes: InstanceAttributes
): InstanceAttributes {
  const pswdAttrs = passwordAttributes(schema);
  if (pswdAttrs) {
    pswdAttrs.forEach((n: string) => {
      const v: string | undefined = attributes.get(n);
      if (v) {
        attributes.set(n, encryptPassword(v));
      }
    });
  }
  return attributes;
}

export function makeInstance(
  moduleName: string,
  entryName: string,
  attributes: InstanceAttributes,
  queryAttributes?: InstanceAttributes,
  queryAttributeValues?: InstanceAttributes,
  queryAll: boolean = false
): Instance {
  const module: Module = fetchModule(moduleName);
  const record: Record = module.getRecord(entryName);

  const schema: RecordSchema = record.schema;
  if (schema.size > 0) {
    attributes.forEach((value: any, key: string) => {
      if (!schema.has(key)) {
        throw new Error(`Invalid attribute ${key} specified for ${moduleName}/${entryName}`);
      }
      const spec: AttributeSpec = getAttributeSpec(schema, key);
      if (value != null && value != undefined) validateType(key, value, spec);
    });
  }
  if (!queryAttributes && !queryAll) {
    attributes = postProcessAttributes(schema, maybeSetDefaultAttributeValues(schema, attributes));
  }
  return new Instance(
    record,
    moduleName,
    entryName,
    attributes,
    queryAttributes,
    queryAttributeValues
  );
}

export function isEventInstance(inst: Instance): boolean {
  return inst.record.type == RecordType.EVENT;
}

export function isEntityInstance(inst: Instance): boolean {
  return inst.record.type == RecordType.ENTITY;
}

export function isRecordInstance(inst: Instance): boolean {
  return inst.record.type == RecordType.RECORD;
}

export function getAllModuleEntries(f: Function): Map<string, string[]> {
  const result: Map<string, string[]> = new Map<string, string[]>();
  moduleDb.forEach((module: Module, k: string) => {
    result.set(
      k,
      f(module).map((me: ModuleEntry) => {
        return me.name;
      })
    );
  });
  return result;
}

export function getAllEventNames() {
  return getAllModuleEntries((module: Module) => {
    return module.getEventEntries();
  });
}

export function getAllEntityNames() {
  return getAllModuleEntries((module: Module) => {
    return module.getEntityEntries();
  });
}

export function isBetweenRelationship(relName: string, moduleName: string): boolean {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(relName, moduleName);
  const mod: Module = fr.module;
  return mod.isBetweenRelationship(fr.entryName);
}

export function isContainsRelationship(relName: string, moduleName: string): boolean {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(relName, moduleName);
  const mod: Module = fr.module;
  return mod.isContainsRelationship(fr.entryName);
}

export type BetweenInstanceNodeValuesResult = {
  node1: any;
  node2: any;
  entry: Relationship;
};

export function getBetweenInstanceNodeValues(inst: Instance): BetweenInstanceNodeValuesResult {
  const re: Relationship = fetchModuleEntry(inst.name, inst.moduleName) as Relationship;
  return {
    node1: inst.attributes.get(re.node1.alias),
    node2: inst.attributes.get(re.node2.alias),
    entry: re,
  };
}

export function isInstance(obj: any): boolean {
  if (obj) {
    return obj instanceof Instance;
  }
  return false;
}

export function isInstanceOfType(obj: any, fqName: string): boolean {
  if (obj) {
    return isInstance(obj) && fqName == (obj as Instance).getFqName();
  }
  return false;
}

export function assertInstance(obj: any) {
  if (obj instanceof Array) {
    if (obj.length == 0) {
      throw new Error(`Empty instances`);
    }
    obj.forEach(assertInstance);
  } else if (!(obj instanceof Instance)) {
    throw new Error(`${obj} is not an Instance`);
  }
}

const IsAgentEventMeta = 'is-agent-event';
const EventAgentName = 'event-agent-name';
const DocumentationMetaTag = 'documentation';

export function defineAgentEvent(moduleName: string, agentName: string, instruction?: string) {
  const module = fetchModule(moduleName);
  const event: Record = new Event(agentName, moduleName);
  event.addAttribute('message', { type: 'Any' });
  event.addAttribute('chatId', { type: 'String' });
  event.addMeta(IsAgentEventMeta, 'y');
  event.addMeta(EventAgentName, agentName);
  if (instruction) {
    event.addMeta(
      DocumentationMetaTag,
      `This event will trigger an agent which has the instruction - "${instruction}".
    So make sure to pass all relevant information in the 'message' attribute of this event.`
    );
  }
  module.addEntry(event);
}

export function isTimer(eventInst: Instance): boolean {
  return eventInst.getFqName() == 'agentlang/timer';
}

export function isAgentEvent(record: Record): boolean {
  const flag = record.getMeta(IsAgentEventMeta);
  return flag != undefined && flag == 'y';
}

export function isAgentEventInstance(eventInst: Instance): boolean {
  return isAgentEvent(eventInst.record);
}

export function eventAgentName(eventInst: Instance): string | undefined {
  return eventInst.record.getMeta(EventAgentName);
}

export function instanceToObject<Type>(inst: Instance, obj: any): Type {
  inst.attributes.forEach((v: any, k: string) => {
    obj[k] = v;
  });
  return obj as Type;
}

export function getEntityRbacRules(entityFqName: string): RbacSpecification[] | undefined {
  const p = splitFqName(entityFqName);
  const mn = p.getModuleName();
  const en = p.getEntryName();
  const m = isModule(mn) && fetchModule(mn);
  if (m && m.isEntity(en)) {
    const entity = getEntity(en, mn);
    return entity?.getRbacSpecifications()?.filter((spec: RbacSpecification) => {
      return spec.expression != undefined;
    });
  }
  return undefined;
}
