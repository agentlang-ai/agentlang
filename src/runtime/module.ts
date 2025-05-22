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
import { Path, splitFqName, isString, isNumber, isBoolean, isFqName, makeFqName } from './util.js';
import { DeletedFlagAttributeName } from './resolvers/sqldb/database.js';
import { isNodeEnv } from '../utils/runtime.js';
import { getResolverNameForPath } from './resolvers/registry.js';

let React: any;
if (!isNodeEnv) {
  import('react').then(module => {
    React = module.default;
  });
}

export class ModuleEntry {
  name: string;
  moduleName: string;

  constructor(name: string, moduleName: string) {
    this.name = name;
    this.moduleName = moduleName;
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
  RELATIONSHIP,
}

export class RecordEntry extends ModuleEntry {
  schema: RecordSchema;
  meta: Meta;
  type: RecordType = RecordType.RECORD;
  parentEntryName: string | undefined;

  constructor(name: string, attributes: Attribute[], moduleName: string, parentEntryName?: string) {
    super(name, moduleName);
    this.parentEntryName = parentEntryName;
    this.schema = parentEntryName
      ? cloneParentSchema(parentEntryName, moduleName)
      : newRecordSchema();
    attributes.forEach((a: Attribute) => {
      const isArrayType: boolean = a.arrayType ? true : false;
      const t: string | undefined = isArrayType ? a.arrayType : a.type;
      if (t == undefined) throw new Error(`Attribute ${a.name} requires a type`);
      let props: Map<string, any> | undefined = asPropertiesMap(a.properties);
      const isObjectType: boolean = !isBuiltInType(t);
      if (isArrayType || isObjectType) {
        if (props == undefined) {
          props = new Map<string, any>();
        }
        if (isArrayType) props.set('array', true);
        if (isObjectType) props.set('object', true);
      }
      this.schema.set(a.name, { type: t, properties: props });
    });
    this.meta = newMeta();
  }

  addMeta(k: string, v: string): void {
    this.meta.set(k, v);
  }

  addAttribute(n: string, attrSpec: AttributeSpec) {
    if (this.schema.has(n)) {
      throw new Error(`Attribute named ${n} already exists in ${this.moduleName}.${this.name}`);
    }
    this.schema.set(n, attrSpec);
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
}

type FetchModuleByEntryNameResult = {
  module: RuntimeModule;
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
  const mod: RuntimeModule = fr.module;
  const entry: RecordEntry = mod.getEntry(parentName) as RecordEntry;
  const result: RecordSchema = newRecordSchema();
  entry.schema.forEach((attrSpec: AttributeSpec, attrName: string) => {
    result.set(attrName, attrSpec);
  });
  return result;
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

export const PlaceholderRecordEntry = new RecordEntry('--', new Array<Attribute>(), 'agentlang');

export class EntityEntry extends RecordEntry {
  override type: RecordType = RecordType.ENTITY;
}

export class EventEntry extends RecordEntry {
  override type: RecordType = RecordType.EVENT;
}

enum RelType {
  CONTAINS,
  BETWEEN,
}

export type RelNodeEntry = {
  moduleName: string;
  entryName: string;
  alias: string;
};

function asRelNodeEntry(n: Node): RelNodeEntry {
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
    moduleName: modName,
    entryName: entryName,
    alias: alias,
  };
}

export class RelationshipEntry extends RecordEntry {
  override type: RecordType = RecordType.RELATIONSHIP;
  relType: RelType = RelType.CONTAINS;
  node1: RelNodeEntry;
  node2: RelNodeEntry;
  properties: Map<string, any> | undefined;

  constructor(
    name: string,
    typ: string,
    node1: RelNodeEntry,
    node2: RelNodeEntry,
    attributes: Attribute[],
    moduleName: string,
    props?: Map<string, any>
  ) {
    super(name, attributes, moduleName);
    if (typ == 'between') this.relType = RelType.BETWEEN;
    this.node1 = node1;
    this.node2 = node2;
    this.properties = props;
    this.updateSchemaWithNodeAttributes();
    if (this.relType == RelType.BETWEEN && !this.isManyToMany()) {
      this.updateBetweenTargetRefs();
    }
  }

  private updateSchemaWithNodeAttributes() {
    const attrSpec1: AttributeSpec = {
      type: 'string',
    };
    this.schema.set(this.node1.alias, attrSpec1);
    const attrSpec2: AttributeSpec = {
      type: 'string',
    };
    this.schema.set(this.node2.alias, attrSpec2);
  }

  private updateBetweenTargetRefs() {
    const res1: string | undefined = getResolverNameForPath(
      makeFqName(this.node1.moduleName, this.node1.entryName)
    );
    const res2: string | undefined = getResolverNameForPath(
      makeFqName(this.node2.moduleName, this.node2.entryName)
    );
    if (res1 == undefined && res2 == undefined) {
      const mod: RuntimeModule = fetchModule(this.node2.moduleName);
      const entry: RecordEntry = mod.getEntry(this.node2.entryName) as RecordEntry;
      if (entry.hasRefTo(this.node1.moduleName, this.node1.entryName)) {
        throw new Error(
          `Cannot create between relationship, ${this.node2.entryName} already has a ref to ${this.node1.entryName}`
        );
      }
      const refn: string = `__${this.node1.alias.toLowerCase()}`;
      const props: Map<string, any> | undefined = this.isOneToOne()
        ? new Map<string, any>()
        : undefined;
      if (props != undefined) {
        props.set('unique', true);
      }
      const attrspec: AttributeSpec = {
        type: 'String',
        properties: props,
      };
      entry.addAttribute(refn, attrspec);
    }
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

  hasBooleanFlagSet(flag: string): boolean {
    if (this.properties != undefined) {
      return this.properties.get(flag) == true;
    }
    return false;
  }

  isOneToOne(): boolean {
    return this.isBetween() && this.hasBooleanFlagSet('one_one');
  }

  isOneToMany(): boolean {
    return this.isBetween() && this.hasBooleanFlagSet('one_many');
  }

  isManyToMany(): boolean {
    return !(this.isOneToOne() || this.isOneToMany());
  }
}

export class WorkflowEntry extends ModuleEntry {
  statements: Statement[];

  constructor(name: string, patterns: Statement[], moduleName: string) {
    super(name, moduleName);
    this.statements = patterns;
  }
}

const EmptyWorkflow: WorkflowEntry = new WorkflowEntry('', [], 'agentlang');

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
    const rels: RelationshipEntry[] = this.getRelationshipEntries();
    return rels.filter((e: RelationshipEntry) => {
      return e.isBetween();
    });
  }

  isEntryOfType(t: RecordType, name: string): boolean {
    const entry: ModuleEntry | undefined = this.getEntriesOfType(t).find((v: ModuleEntry) => {
      const r: RecordEntry = v as RecordEntry;
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
      const entry: RelationshipEntry = this.getEntry(entryName) as RelationshipEntry;
      return entry.isContains();
    }
    return false;
  }

  isBetweenRelationship(entryName: string): boolean {
    if (this.hasEntry(entryName)) {
      const entry: RelationshipEntry = this.getEntry(entryName) as RelationshipEntry;
      return entry.isBetween();
    }
    return false;
  }
}

const moduleDb = new Map<string, RuntimeModule>();
let activeModule: string = '';

let db_changeCount: any;
let db_setModuleDbChangeCount: any;

if (!isNodeEnv) {
  const r: Array<Function> = React.useState(0);
  db_changeCount = r[0];
  db_setModuleDbChangeCount = r[1];
}

export function useModuleDb() {
  function triggerModuleDbChange() {
    let c: number = db_changeCount;
    if (c > 1000) {
      c = 0;
    } else {
      ++c;
    }
    db_setModuleDbChangeCount(c);
  }

  function db_addModule(name: string) {
    addModule(name);
    console.log(`before db_addModule: ${db_changeCount}`);
    triggerModuleDbChange();
    console.log(`after db_addModule: ${db_changeCount}`);
  }

  function db_removeModule(name: string) {
    removeModule(name);
    triggerModuleDbChange();
  }

  function db_addEntity(
    name: string,
    attrs: Attribute[],
    ext?: string,
    moduleName = activeModule
  ): string {
    console.log(`after db_addEntity: ${db_changeCount}`);
    addEntity(name, attrs, ext, moduleName);
    triggerModuleDbChange();
    console.log(`after db_addEntity: ${db_changeCount}`);
    return name;
  }

  function db_addEvent(
    name: string,
    attrs: Attribute[],
    ext?: string,
    moduleName = activeModule
  ): string {
    addEvent(name, attrs, ext, moduleName);
    triggerModuleDbChange();
    return name;
  }

  function db_addRecord(name: string, attrs: Attribute[], ext?: string, moduleName = activeModule) {
    addRecord(name, attrs, ext, moduleName);
    triggerModuleDbChange();
    return name;
  }

  function db_addRelationship(
    name: string,
    type: 'contains' | 'between',
    nodes: RelNodes,
    attrs: Attribute[] | undefined,
    props: Property[] | undefined,
    moduleName = activeModule
  ) {
    addRelationship(name, type, nodes, attrs, props, moduleName);
    triggerModuleDbChange();
    return name;
  }

  function db_addWorkflow(name: string, statements: Statement[], moduleName = activeModule) {
    addWorkflow(name, statements, moduleName);
    triggerModuleDbChange();
    return name;
  }

  function db_removeEntity(name: string, moduleName = activeModule): boolean {
    const r: boolean = removeEntity(name, moduleName);
    if (r) triggerModuleDbChange();
    return r;
  }

  function db_removeRecord(name: string, moduleName = activeModule): boolean {
    const r: boolean = removeRecord(name, moduleName);
    if (r) triggerModuleDbChange();
    return r;
  }

  function db_removeRelationship(name: string, moduleName = activeModule): boolean {
    const r: boolean = removeRelationship(name, moduleName);
    if (r) triggerModuleDbChange();
    return r;
  }

  function db_removeWorkflow(name: string, moduleName = activeModule): boolean {
    const r: boolean = removeWorkflow(name, moduleName);
    if (r) triggerModuleDbChange();
    return r;
  }

  function db_removeEvent(name: string, moduleName = activeModule): boolean {
    const r: boolean = removeEvent(name, moduleName);
    if (r) triggerModuleDbChange();
    return r;
  }
  return {
    db_addModule,
    db_removeModule,
    db_addEntity,
    db_addEvent,
    db_addRecord,
    db_addRelationship,
    db_addWorkflow,
    db_removeEntity,
    db_removeEvent,
    db_removeRecord,
    db_removeRelationship,
    db_removeWorkflow,
  };
}

export function addModule(name: string): string {
  moduleDb.set(name, new RuntimeModule(name));
  activeModule = name;
  return name;
}

export function removeModule(name: string): boolean {
  if (moduleDb.has(name)) {
    moduleDb.delete(name);
    return true;
  }
  return false;
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
const propertyNames = new Set([
  '@id',
  '@indexed',
  '@default',
  '@optional',
  '@unique',
  '@autoincrement',
  '@array',
  '@object',
  '@ref',
]);

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

function validateProperties(props: Property[] | undefined): void {
  if (props != undefined) {
    props.forEach((p: Property) => {
      if (!propertyNames.has(p.name)) throw new Error(`Invalid property ${p.name}`);
    });
  }
}

function verifyAttribute(attr: Attribute): void {
  checkType(attr.type || attr.arrayType);
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

export function isArrayAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('array', attrSpec);
}

export function isObjectAttribute(attrSpec: AttributeSpec): boolean {
  return getBooleanProperty('object', attrSpec);
}

export function getAttributeDefaultValue(attrSpec: AttributeSpec): any | undefined {
  return getAnyProperty('default', attrSpec);
}

export function getAttributeLength(attrSpec: AttributeSpec): number | undefined {
  return getAnyProperty('length', attrSpec);
}

export function getFkSpec(attrSpec: AttributeSpec): string | undefined {
  return getAnyProperty('ref', attrSpec);
}

export function addEntity(
  name: string,
  attrs: Attribute[],
  ext?: string,
  moduleName = activeModule
): string {
  const module: RuntimeModule = fetchModule(moduleName);
  attrs.forEach(a => verifyAttribute(a));
  module.addEntry(new EntityEntry(name, attrs, moduleName, ext));
  return name;
}

export function addEvent(
  name: string,
  attrs: Attribute[],
  ext?: string,
  moduleName = activeModule
) {
  const module: RuntimeModule = fetchModule(moduleName);
  attrs.forEach(a => verifyAttribute(a));
  module.addEntry(new EventEntry(name, attrs, moduleName, ext));
  return name;
}

export function addRecord(
  name: string,
  attrs: Attribute[],
  ext?: string,
  moduleName = activeModule
) {
  const module: RuntimeModule = fetchModule(moduleName);
  attrs.forEach(a => verifyAttribute(a));
  module.addEntry(new RecordEntry(name, attrs, moduleName, ext));
  return name;
}

const DefaultRelAttrbutes: Array<Attribute> = new Array<Attribute>();

export function addRelationship(
  name: string,
  type: 'contains' | 'between',
  nodes: RelNodes,
  attrs: Attribute[] | undefined,
  props: Property[] | undefined,
  moduleName = activeModule
) {
  const module: RuntimeModule = fetchModule(moduleName);
  if (attrs != undefined) attrs.forEach(a => verifyAttribute(a));
  else attrs = DefaultRelAttrbutes;
  const n1: RelNodeEntry = asRelNodeEntry(nodes.node1);
  const n2: RelNodeEntry = asRelNodeEntry(nodes.node2);
  let propsMap: Map<string, any> | undefined;
  if (props != undefined) propsMap = asPropertiesMap(props);
  module.addEntry(new RelationshipEntry(name, type, n1, n2, attrs, moduleName, propsMap));
  return name;
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
    addEvent(name, new Array<Attribute>(), undefined, moduleName);
  }
  module.addEntry(new WorkflowEntry(asWorkflowName(name), statements, moduleName));
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

export function getEntity(name: string, moduleName: string): EntityEntry {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(name, moduleName);
  if (fr.module.isEntity(fr.entryName)) {
    return fr.module.getEntry(fr.entryName) as EntityEntry;
  }
  throw new Error(`Entity ${fr.entryName} not found in module ${fr.moduleName}`);
}

export function getEvent(name: string, moduleName: string): EventEntry {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(name, moduleName);
  if (fr.module.isEvent(fr.entryName)) {
    return fr.module.getEntry(fr.entryName) as EventEntry;
  }
  throw new Error(`Event ${fr.entryName} not found in module ${fr.moduleName}`);
}

export function getRecord(name: string, moduleName: string): RecordEntry {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(name, moduleName);
  if (fr.module.isRecord(fr.entryName)) {
    return fr.module.getEntry(fr.entryName) as RecordEntry;
  }
  throw new Error(`Record ${fr.entryName} not found in module ${fr.moduleName}`);
}

export function getRelationship(name: string, moduleName: string): RelationshipEntry {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(name, moduleName);
  if (fr.module.isRelationship(fr.entryName)) {
    return fr.module.getEntry(fr.entryName) as RelationshipEntry;
  }
  throw new Error(`Relationship ${fr.entryName} not found in module ${fr.moduleName}`);
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

const EmptyInstanceAttributes: InstanceAttributes = newInstanceAttributes();

export const MarkDeletedAttributes: InstanceAttributes = newInstanceAttributes().set(
  DeletedFlagAttributeName,
  true
);

export class Instance {
  record: RecordEntry;
  name: string;
  moduleName: string;
  attributes: InstanceAttributes;
  queryAttributes: InstanceAttributes | undefined;
  queryAttributeValues: InstanceAttributes | undefined;
  relatedInstances: Map<string, Instance[]> | undefined;

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

  static EmptyInstance(name: string, moduleName: string): Instance {
    const module: RuntimeModule = fetchModule(moduleName);
    return new Instance(
      module.getEntry(name) as RecordEntry,
      moduleName,
      name,
      EmptyInstanceAttributes
    );
  }

  static newWithAttributes(inst: Instance, newAttrs: InstanceAttributes): Instance {
    return new Instance(inst.record, inst.moduleName, inst.name, newAttrs);
  }

  lookup(k: string): any | undefined {
    return this.attributes.get(k);
  }

  asObject(): object {
    const result: Map<string, object> = new Map<string, object>();
    result.set(this.name, Object.fromEntries(this.attributes));
    return Object.fromEntries(result);
  }

  attributesAsObject(stringifyObjects: boolean = true): object {
    if (stringifyObjects) {
      return attributesAsColumns(this.attributes, this.record.schema);
    }
    return Object.fromEntries(this.attributes);
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
}

export function attributesAsColumns(attrs: InstanceAttributes, schema?: RecordSchema): object {
  if (schema != undefined) {
    const objAttrNames: Array<string> | undefined = objectAttributes(schema);
    if (objAttrNames != undefined) {
      objAttrNames.forEach((n: string) => {
        const v: any | undefined = attrs.get(n);
        if (v != undefined) {
          attrs.set(n, JSON.stringify(v));
        }
      });
    }
  }
  return Object.fromEntries(attrs);
}

export function objectAsInstanceAttributes(obj: object): InstanceAttributes {
  const attrs: InstanceAttributes = newInstanceAttributes();
  Object.entries(obj).forEach((v: [string, any]) => {
    attrs.set(v[0], v[1]);
  });
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

export function isBetweenRelationship(relName: string, moduleName: string): boolean {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(relName, moduleName);
  const mod: RuntimeModule = fr.module;
  return mod.isBetweenRelationship(fr.entryName);
}

export function isContainsRelationship(relName: string, moduleName: string): boolean {
  const fr: FetchModuleByEntryNameResult = fetchModuleByEntryName(relName, moduleName);
  const mod: RuntimeModule = fr.module;
  return mod.isContainsRelationship(fr.entryName);
}
