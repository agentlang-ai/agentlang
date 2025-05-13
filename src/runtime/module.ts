import chalk from 'chalk';
import { Attribute, Property, isProperty, Statement } from '../language/generated/ast.js';
import { Path, splitFqName, isString, isNumber, isBoolean } from './util.js';

class ModuleEntry {
  name: string;

  constructor(name: string) {
    this.name = name;
  }
}

type AttributeSpec = {
  type: string;
  properties?: Property[];
};

type RecordSchema = Map<string, AttributeSpec>;

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
}

export class RecordEntry extends ModuleEntry {
  schema: RecordSchema;
  meta: Meta;
  type: RecordType = RecordType.RECORD;

  constructor(name: string, attributes: Attribute[]) {
    super(name);
    this.schema = newRecordSchema();
    attributes.forEach((a: Attribute) => {
      this.schema.set(a.name, { type: a.type, properties: a.properties });
    });
    this.meta = newMeta();
  }

  addMeta(k: string, v: string): void {
    this.meta.set(k, v);
  }
}

export const PlaceholderRecordEntry = new RecordEntry('--', new Array<Attribute>());

export class EntityEntry extends RecordEntry {
  override type: RecordType = RecordType.ENTITY;
}

export class EventEntry extends RecordEntry {
  override type: RecordType = RecordType.EVENT;
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

  getEntityEntries(): ModuleEntry[] {
    return this.getEntriesOfType(RecordType.ENTITY);
  }

  getEventEntries(): ModuleEntry[] {
    return this.getEntriesOfType(RecordType.EVENT);
  }

  getRecordEntries(): ModuleEntry[] {
    return this.getEntriesOfType(RecordType.RECORD);
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
}

const moduleDb = new Map<string, RuntimeModule>();

let activeModule: string = '';

export function addModule(name: string): string {
  moduleDb.set(name, new RuntimeModule(name));
  activeModule = name;
  return name;
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
    const props: Property[] | undefined = v.properties;
    if (props != undefined) {
      const d: Property | undefined = props.find((v: Property) => v.name == '@default');
      if (isProperty(d)) {
        result.set(k, d.value);
      }
    }
  });
  return result;
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
  protected attributes: InstanceAttributes;
  queryAttributes: InstanceAttributes | undefined;

  constructor(
    record: RecordEntry,
    name: string,
    attributes: InstanceAttributes,
    queryAttributes?: InstanceAttributes
  ) {
    this.record = record;
    this.name = name;
    this.attributes = attributes;
    this.queryAttributes = queryAttributes;
  }

  lookup(k: string): any | undefined {
    return this.attributes.get(k);
  }

  asObject(): Object {
    const result: Map<string, Object> = new Map<string, Object>();
    result.set(this.name, Object.fromEntries(this.attributes));
    return Object.fromEntries(result);
  }

  addQuery(n: string, op: string) {
    if (this.queryAttributes == undefined) this.queryAttributes = newInstanceAttributes();
    this.queryAttributes.set(n, op);
  }
}

export function objectAsInstanceAttributes(obj: Object): InstanceAttributes {
  const attrs: InstanceAttributes = newInstanceAttributes();
  Object.entries(obj).forEach((v: [string, any]) => {
    attrs.set(v[0], v[1]);
  });
  return attrs;
}

export function makeInstance(
  fullEntryName: string,
  attributes: InstanceAttributes,
  queryAttributes?: InstanceAttributes
): Instance {
  const path: Path = splitFqName(fullEntryName);
  let moduleName: string = '';
  if (path.hasModule()) moduleName = path.getModuleName();
  else moduleName = activeModule;
  const module: RuntimeModule = fetchModule(moduleName);
  const entryName: string = path.getEntryName();
  const record: RecordEntry = module.getRecord(entryName);
  const schema: RecordSchema = record.schema;
  if (schema.size > 0) {
    attributes.forEach((value: any, key: string) => {
      if (!schema.has(key)) {
        throw new Error(`Invalid attribute ${key} specified for ${fullEntryName}`);
      }
      const spec: AttributeSpec = getAttributeSpec(schema, key);
      validateType(key, value, spec);
    });
  }
  return new Instance(record, fullEntryName, attributes, queryAttributes);
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
