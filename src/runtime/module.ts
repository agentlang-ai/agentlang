import chalk from 'chalk';
import {
  Attribute,
  Property,
  Statement,
  KvPair,
  Literal,
  FnCall,
  RelNodes,
  Node,
} from '../language/generated/ast.js';
import { Path, splitFqName, isString, isNumber, isBoolean } from './util.js';

export class ModuleEntry {
  name: string;

  constructor(name: string) {
    this.name = name;
  }
}

export type AttributeSpec = {
  type: string;
  properties?: Map<string, any> | undefined;
};

export type RecordSchema = Map<string, AttributeSpec>;

export function newRecordSchema(): RecordSchema {
  return new Map<string, AttributeSpec>();
}

type Meta = Map<string, string>;

export function newMeta(): Meta {
  return new Map<string, string>();
}

export enum RecordType {
  RECORD,
  ENTITY,
  EVENT,
  RELATIONSHIP
}

export class RecordEntry extends ModuleEntry {
  schema: RecordSchema;
  meta: Meta;
  type: RecordType = RecordType.RECORD;

  constructor(name: string, attributes: Attribute[]) {
    super(name);
    this.schema = newRecordSchema();
    attributes.forEach((a: Attribute) => {
      this.schema.set(a.name, { type: a.type, properties: asPropertiesMap(a.properties) });
    });
    this.meta = newMeta();
  }

  addMeta(k: string, v: string): void {
    this.meta.set(k, v);
  }
}

function asPropertiesMap(props: Property[]): Map<string, any> | undefined {
  if (props != undefined && props.length > 0) {
    const result: Map<string, any> = new Map<string, any>();
    props.forEach((p: Property) => {
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
    return result;
  }
  return undefined;
}

function normalizeKvPairValue(kvp: KvPair): any | null {
  const v: Literal | undefined = kvp.value;
  if (v == undefined) return true;
  if (v.str != undefined) {
    return v.str;
  } else if (v.num != undefined) {
    return v.num;
  } else if (v.bool != undefined) {
    return v.bool;
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

export const PlaceholderRecordEntry = new RecordEntry('--', new Array<Attribute>());

export class EntityEntry extends RecordEntry {
  override type: RecordType = RecordType.ENTITY;
}

export class EventEntry extends RecordEntry {
  override type: RecordType = RecordType.EVENT;
}

enum RelType {
  CONTAINS,
  BETWEEN
}

export type RelNodeEntry = {
  moduleName: string,
  entryName: string,
  alias: string
}

function asRelNodeEntry(n: Node): RelNodeEntry {
  const path: Path = splitFqName(n.name)
  let modName = activeModule
  const entryName = path.getEntryName()
  if (path.hasModule()) {
    modName = path.getModuleName()
  }
  let alias = entryName
  if (n.alias != undefined) {
    alias = n.alias
  }
  return {
    moduleName: modName,
    entryName: entryName,
    alias: alias
  }
}

export class RelationshipEntry extends RecordEntry {
  override type: RecordType = RecordType.RELATIONSHIP
  relType: RelType = RelType.CONTAINS
  node1: RelNodeEntry
  node2: RelNodeEntry
  properties: Map<string, any> | undefined

  constructor(name: string, typ: string, node1: RelNodeEntry, node2: RelNodeEntry, attributes: Attribute[], props?: Map<string, any>) {
    super(name, attributes)
    if (typ == "between") this.relType = RelType.BETWEEN
    this.node1 = node1
    this.node2 = node2
    this.properties = props
    this.updateSchemaWithNodeAttributes()
  }

  private makeUniqueProp(flag: boolean): Map<string, any> | undefined {
    if (flag) {
      let props: Map<string, any> = new Map<string, any>()
      props.set("unique", true)
      return props
    }
    return undefined
  }

  private updateSchemaWithNodeAttributes() {
    const attrSpec1: AttributeSpec = {
      type: "string",
      properties: this.makeUniqueProp(this.properties != undefined && (this.properties.get("one_one") == true || this.properties.get("one_many") == true))
    }
    this.schema.set(this.node1.alias, attrSpec1)
    const attrSpec2: AttributeSpec = {
      type: "string",
      properties: this.makeUniqueProp(this.properties != undefined && (this.properties.get("one_one") == true))
    }
    this.schema.set(this.node2.alias, attrSpec2)
  }

  isContains(): boolean {
    return this.relType == RelType.CONTAINS
  }

  isBetween(): boolean {
    return this.relType == RelType.BETWEEN
  }
}

export class WorkflowEntry extends ModuleEntry {
  statements: Statement[];

  constructor(name: string, patterns: Statement[]) {
    super(name);
    this.statements = patterns;
  }
}

const EmptyWorkflow: WorkflowEntry = new WorkflowEntry('', []);

export function isEmptyWorkflow(wf: WorkflowEntry): boolean {
  return wf == EmptyWorkflow;
}

export class RuntimeModule {
  name: string;
  entries: ModuleEntry[];
  index: Map<string, number>;
  entriesByTypeCache: Map<RecordType, ModuleEntry[]> | null;

  constructor(name: string) {
    this.name = name;
    this.entries = new Array<ModuleEntry>();
    this.index = new Map<string, number>();
    this.entriesByTypeCache = null;
  }

  addEntry(entry: ModuleEntry): void {
    this.entries.push(entry);
    this.index.set(entry.name, this.entries.length - 1);
    if (this.entriesByTypeCache != null) this.entriesByTypeCache = null;
  }

  hasEntry(entryName: string): boolean {
    return this.index.has(entryName);
  }

  getEntry(entryName: string): ModuleEntry {
    const idx: number | undefined = this.index.get(entryName);
    if (idx == undefined) throw new Error(`Entry ${entryName} not found in module ${this.name}`);
    return this.entries[idx];
  }

  getRecord(recordName: string): RecordEntry {
    const e: ModuleEntry = this.getEntry(recordName);
    if (e instanceof RecordEntry) {
      return e as RecordEntry;
    }
    throw new Error(`${recordName} is not a record in module ${this.name}`);
  }

  removeEntry(entryName: string): boolean {
    const idx: number | undefined = this.index.get(entryName);
    if (idx != undefined) {
      this.index.delete(entryName);
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
        const r: RecordEntry = v as RecordEntry;
        return r.type == t;
      });
      if (this.entriesByTypeCache != null)
        this.entriesByTypeCache = new Map<RecordType, ModuleEntry[]>();
      this.entriesByTypeCache?.set(t, result);
      return result;
    }
  }

  getEntityEntries(): EntityEntry[] {
    return this.getEntriesOfType(RecordType.ENTITY) as EntityEntry[];
  }

  getEventEntries(): EventEntry[] {
    return this.getEntriesOfType(RecordType.EVENT) as EventEntry[];
  }

  getRecordEntries(): RecordEntry[] {
    return this.getEntriesOfType(RecordType.RECORD) as RecordEntry[];
  }

  getRelationshipEntries(): RelationshipEntry[] {
    return this.getEntriesOfType(RecordType.RELATIONSHIP) as RelationshipEntry[];
  }

  getBetweenRelationshipEntries(): RelationshipEntry[] {
    const rels: RelationshipEntry[] = this.getRelationshipEntries()
    return rels.filter((e: RelationshipEntry) => {
      return e.isBetween()
    })
  }

  isEntryOfType(t: RecordType, name: string): boolean {
    const entry: ModuleEntry | undefined = this.getEntityEntries().find((v: ModuleEntry) => {
      const r: RecordEntry = v as RecordEntry;
      return r.name == name && r.type == t;
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
}

const moduleDb = new Map<string, RuntimeModule>();

let activeModule: string = '';

export function addModule(name: string): string {
  moduleDb.set(name, new RuntimeModule(name));
  activeModule = name;
  return name;
}

export function removeModule(name: string): boolean {
  if (moduleDb.has(name)) {
    moduleDb.delete(name)
    return true
  }
  return false
}

addModule('agentlang');
addRecord('env', new Array<Attribute>());

export function getModuleNames(): string[] {
  const ks: Iterable<string> = moduleDb.keys();
  return Array.from(ks);
}

export function isModule(name: string): boolean {
  return moduleDb.has(name);
}

export function fetchModule(moduleName: string): RuntimeModule {
  const module: RuntimeModule | undefined = moduleDb.get(moduleName);
  if (module == undefined) {
    throw new Error(`Module not found - ${moduleName}`);
  }
  return module;
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
]);
const builtInTypes = new Set(Array.from(builtInChecks.keys()));
const propertyNames = new Set(['@id', '@indexed', '@default', '@optional', '@unique', '@auto']);

export function isValidType(type: string): boolean {
  if (builtInTypes.has(type)) return true;
  const path: Path = splitFqName(type);
  let modName: string = '';
  if (path.hasModule()) modName = path.getModuleName();
  else modName = activeModule;
  return isModule(modName) && fetchModule(modName).hasEntry(path.getEntryName());
}

function checkType(type: string): void {
  if (!isValidType(type)) {
    console.log(chalk.red(`WARN: type not found - ${type}`));
  }
}

function validateProperties(props: Property[] | undefined): void {
  if (props != undefined) {
    props.forEach((p: Property) => {
      if (!propertyNames.has(p.name)) throw new Error(`Invalid property ${p.name}`);
    });
  }
}

function verifyAttribute(attr: Attribute): void {
  checkType(attr.type);
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

export function isIdAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('id', attrSpec);
}

export function isUniqueAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('unique', attrSpec);
}

export function isIndexedAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('indexed', attrSpec);
}

export function isOptionalAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('optional', attrSpec);
}

export function getAttributeDefaultValue(attrSpec: AttributeSpec): any | undefined {
  return getAnyProperty('default', attrSpec);
}

export function getAttributeLength(attrSpec: AttributeSpec): number | undefined {
  return getAnyProperty('length', attrSpec);
}

export function addEntity(name: string, attrs: Attribute[], moduleName = activeModule): string {
  const module: RuntimeModule = fetchModule(moduleName);
  attrs.forEach(a => verifyAttribute(a));
  module.addEntry(new EntityEntry(name, attrs));
  return name;
}

export function addEvent(name: string, attrs: Attribute[], moduleName = activeModule) {
  const module: RuntimeModule = fetchModule(moduleName);
  attrs.forEach(a => verifyAttribute(a));
  module.addEntry(new EventEntry(name, attrs));
  return name;
}

export function addRecord(name: string, attrs: Attribute[], moduleName = activeModule) {
  const module: RuntimeModule = fetchModule(moduleName);
  attrs.forEach(a => verifyAttribute(a));
  module.addEntry(new RecordEntry(name, attrs));
  return name;
}

const DefaultRelAttrbutes: Array<Attribute> = new Array<Attribute>()

export function addRelationship(name: string, type: 'contains' | 'between', nodes: RelNodes, attrs: Attribute[] | undefined,
  props: Property[] | undefined, moduleName = activeModule) {
  const module: RuntimeModule = fetchModule(moduleName)
  if (attrs != undefined) attrs.forEach(a => verifyAttribute(a))
  else attrs = DefaultRelAttrbutes
  const n1: RelNodeEntry = asRelNodeEntry(nodes.node1)
  const n2: RelNodeEntry = asRelNodeEntry(nodes.node2)
  let propsMap: Map<string, any> | undefined
  if (props != undefined) propsMap = asPropertiesMap(props)
  module.addEntry(new RelationshipEntry(name, type, n1, n2, attrs, propsMap))
  return name
}

function asWorkflowName(n: string): string {
  return n + '--workflow';
}

export function addWorkflow(name: string, statements: Statement[], moduleName = activeModule) {
  const module: RuntimeModule = fetchModule(moduleName);
  if (module.hasEntry(name)) {
    const entry: ModuleEntry = module.getEntry(name);
    if (!(entry instanceof EventEntry))
      throw new Error(`Not an event, cannot attach workflow to ${entry.name}`);
  } else {
    addEvent(name, new Array<Attribute>(), moduleName);
  }
  module.addEntry(new WorkflowEntry(asWorkflowName(name), statements));
  return name;
}

export function getWorkflow(eventInstance: Instance): WorkflowEntry {
  const name: string = eventInstance.name;
  const path: Path = splitFqName(name);
  let moduleName: string = activeModule;
  if (path.hasModule()) moduleName = path.getModuleName();
  const eventName: string = path.getEntryName();
  const wfName: string = asWorkflowName(eventName);
  const module: RuntimeModule = fetchModule(moduleName);
  if (module.hasEntry(wfName)) {
    return module.getEntry(wfName) as WorkflowEntry;
  }
  return EmptyWorkflow;
}

export function removeEntity(name: string, moduleName = activeModule): boolean {
  const module: RuntimeModule = fetchModule(moduleName);
  if (module.isEntity(name)) {
    return module.removeEntry(name);
  }
  return false;
}

export function removeRecord(name: string, moduleName = activeModule): boolean {
  const module: RuntimeModule = fetchModule(moduleName);
  if (module.isRecord(name)) {
    return module.removeEntry(name);
  }
  return false;
}

export function removeRelationship(name: string, moduleName = activeModule): boolean {
  const module: RuntimeModule = fetchModule(moduleName);
  if (module.isRelationship(name)) {
    return module.removeEntry(name);
  }
  return false;
}

export function removeWorkflow(name: string, moduleName = activeModule): boolean {
  const module: RuntimeModule = fetchModule(moduleName);
  return module.removeEntry(asWorkflowName(name));
}

export function removeEvent(name: string, moduleName = activeModule): boolean {
  const module: RuntimeModule = fetchModule(moduleName);
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

function validateType(attrName: string, attrValue: any, attrSpec: AttributeSpec) {
  const predic = builtInChecks.get(attrSpec.type);
  if (predic != undefined) {
    if (!predic(attrValue)) {
      throw new Error(`Invalid value ${attrValue} specified for ${attrName}`);
    }
  }
}

export type InstanceAttributes = Map<string, any>;

export function newInstanceAttributes(): InstanceAttributes {
  return new Map<string, any>();
}

export class Instance {
  record: RecordEntry;
  name: string;
  moduleName: string;
  protected attributes: InstanceAttributes;
  queryAttributes: InstanceAttributes | undefined;
  queryAttributeValues: InstanceAttributes | undefined;

  constructor(
    record: RecordEntry,
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

  lookup(k: string): any | undefined {
    return this.attributes.get(k);
  }

  asObject(): Object {
    const result: Map<string, Object> = new Map<string, Object>();
    result.set(this.name, Object.fromEntries(this.attributes));
    return Object.fromEntries(result);
  }

  attributesAsObject(): Object {
    return Object.fromEntries(this.attributes);
  }

  queryAttributesAsObject(): Object {
    if (this.queryAttributes != undefined) {
      return Object.fromEntries(this.queryAttributes);
    }
    return {};
  }

  queryAttributeValuesAsObject(): Object {
    if (this.queryAttributeValues != undefined) {
      return Object.fromEntries(this.queryAttributeValues);
    }
    return {};
  }

  addQuery(n: string, op: string) {
    if (this.queryAttributes == undefined) this.queryAttributes = newInstanceAttributes();
    this.queryAttributes.set(n, op);
  }

  getAttributes(): InstanceAttributes {
    return this.attributes;
  }
}

export function objectAsInstanceAttributes(obj: Object): InstanceAttributes {
  const attrs: InstanceAttributes = newInstanceAttributes();
  Object.entries(obj).forEach((v: [string, any]) => {
    attrs.set(v[0], v[1]);
  });
  return attrs;
}

export type AttributeEntry = {
  name: string;
  props: Map<string, any> | undefined;
};

export function findIdAttribute(inst: Instance): AttributeEntry | undefined {
  const schema: RecordSchema = inst.record.schema;
  for (const [key, value] of schema) {
    const attrSpec: AttributeSpec = value as AttributeSpec;
    if (isIdAttribute(attrSpec)) {
      return {
        name: key as string,
        props: attrSpec.properties,
      };
    }
  }
  return undefined;
}

export function makeInstance(
  moduleName: string,
  entryName: string,
  attributes: InstanceAttributes,
  queryAttributes?: InstanceAttributes,
  queryAttributeValues?: InstanceAttributes
): Instance {
  const module: RuntimeModule = fetchModule(moduleName);
  const record: RecordEntry = module.getRecord(entryName);
  const schema: RecordSchema = record.schema;
  if (schema.size > 0) {
    attributes.forEach((value: any, key: string) => {
      if (!schema.has(key)) {
        throw new Error(`Invalid attribute ${key} specified for ${moduleName}/${entryName}`);
      }
      const spec: AttributeSpec = getAttributeSpec(schema, key);
      validateType(key, value, spec);
    });
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

export function getAllEventNames() {
  const result: Map<string, string[]> = new Map<string, string[]>();
  moduleDb.forEach((v: RuntimeModule, k: string) => {
    result.set(
      k,
      v.getEventEntries().map((me: ModuleEntry) => {
        return me.name;
      })
    );
  });
  return result;
}
