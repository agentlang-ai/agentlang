import chalk from 'chalk';
import { Attribute, Property, isProperty, Statement } from '../language/generated/ast.js';
import { Path, splitPath, isString, isNumber, isBoolean } from "./util.js";

class ModuleEntry {
    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

type AttributeSpec = {
    type: string;
    properties?: Property[]
}

type RecordSchema = Map<string, AttributeSpec>;

export function newRecordSchema(): RecordSchema {
    return new Map<string, AttributeSpec>()
}

type Meta = Map<string, string>;

export function newMeta(): Meta {
    return new Map<string, string>()
}

export enum RecordType {
    RECORD, ENTITY, EVENT
}

export class RecordEntry extends ModuleEntry {
    schema: RecordSchema;
    meta: Meta;
    type: RecordType = RecordType.RECORD;

    constructor(name: string, attributes: Attribute[]) {
        super(name);
        this.schema = newRecordSchema();
        attributes.forEach((a: Attribute) => {
            this.schema.set(a.name, { type: a.type, properties: a.properties })
        })
        this.meta = newMeta();
    }

    addMeta(k: string, v: string): void {
        this.meta.set(k, v);
    }
}

export const PlaceholderRecordEntry = new RecordEntry("--", new Array<Attribute>())

export class EntityEntry extends RecordEntry {
    override type: RecordType = RecordType.ENTITY
}

export class EventEntry extends RecordEntry {
    override type: RecordType = RecordType.EVENT
}

export class WorkflowEntry extends ModuleEntry {
    statements: Statement[];

    constructor(name: string, patterns: Statement[]) {
        super(name)
        this.statements = patterns
    }
}

const EmptyWorkflow: WorkflowEntry = new WorkflowEntry("", []);

export function isEmptyWorkflow(wf: WorkflowEntry): boolean {
    return wf == EmptyWorkflow;
}

class Module {
    name: string;
    entries: ModuleEntry[];
    index: Map<string, number>;

    constructor(name: string) {
        this.name = name;
        this.entries = new Array<ModuleEntry>();
        this.index = new Map<string, number>()
    }

    addEntry(entry: ModuleEntry): void {
        this.entries.push(entry);
        this.index.set(entry.name, this.entries.length - 1);
    }

    hasEntry(entryName: string): boolean {
        return this.index.has(entryName)
    }

    getEntry(entryName: string): ModuleEntry {
        let idx: number | undefined = this.index.get(entryName)
        if (idx == undefined)
            throw new Error("Entry " + entryName + " not found in module " + this.name)
        return this.entries[idx];
    }

    getRecord(recordName: string): RecordEntry {
        let e: ModuleEntry = this.getEntry(recordName);
        if (e instanceof RecordEntry) {
            return (e as RecordEntry);
        }
        throw new Error(recordName + " is not a record in module " + this.name);
    }
}

const moduleDb = new Map<string, Module>;

let activeModule: string = "";

export function addModule(name: string): string {
    moduleDb.set(name, new Module(name));
    activeModule = name;
    return name;
}

addModule("agentlang");
addRecord("env", new Array<Attribute>());

export function isModule(name: string): boolean {
    return moduleDb.has(name);
}

function fetchModule(moduleName: string): Module {
    let module: Module | undefined = moduleDb.get(moduleName);
    if (module == undefined) {
        throw new Error("Module not found - " + moduleName);
    }
    return module;
}

const builtInChecks = new Map([["String", isString],
["Int", Number.isSafeInteger],
["Number", isNumber],
["Email", isString],
["Date", isString],
["Time", isString],
["DateTime", isString],
["Boolean", isBoolean],
["UUID", isString],
["URL", isString]]);
const builtInTypes = new Set(Array.from(builtInChecks.keys()));
const propertyNames = new Set(["@id", "@indexed", "@default", "@optional", "@unique", "@auto"]);

export function isValidType(type: string): boolean {
    if (builtInTypes.has(type)) return true;
    let path: Path = splitPath(type);
    let modName: string = "";
    if (path.hasModule()) modName = path.getModuleName()
    else modName = activeModule
    return (isModule(modName) && fetchModule(modName).hasEntry(path.getEntryName()))
}

function checkType(type: string): void {
    if (!isValidType(type)) {
        console.log(chalk.red("WARN: type not found - " + type));
    }
}

function validateProperties(props: Property[] | undefined): void {
    if (props != undefined) {
        props.forEach((p: Property) => {
            if (!propertyNames.has(p.name))
                throw new Error("Invalid property " + p.name);
        })
    }
}

function verifyAttribute(attr: Attribute): void {
    checkType(attr.type);
    validateProperties(attr.properties);
}

export function defaultAttributes(schema: RecordSchema): Map<string, any> {
    let result: Map<string, any> = new Map<string, any>();
    schema.forEach((v: AttributeSpec, k: string) => {
        let props: Property[] | undefined = v.properties;
        if (props != undefined) {
            let d: Property | undefined = props.find((v: Property) => v.name == '@default');
            if (isProperty(d)) {
                result.set(k, d.value)
            }
        }
    });
    return result;
}

export function addEntity(name: string, attrs: Attribute[], moduleName = activeModule): string {
    let module: Module = fetchModule(moduleName);
    attrs.forEach((a) => verifyAttribute(a));
    module.addEntry(new EntityEntry(name, attrs));
    return name;
}

export function addEvent(name: string, attrs: Attribute[], moduleName = activeModule) {
    let module: Module = fetchModule(moduleName);
    attrs.forEach((a) => verifyAttribute(a));
    module.addEntry(new EventEntry(name, attrs));
    return name;
}

export function addRecord(name: string, attrs: Attribute[], moduleName = activeModule) {
    let module: Module = fetchModule(moduleName);
    attrs.forEach((a) => verifyAttribute(a));
    module.addEntry(new RecordEntry(name, attrs));
    return name;
}

function asWorkflowName(n: string): string {
    return n + "--workflow"
}

export function addWorkflow(name: string, statements: Statement[], moduleName = activeModule) {
    let module: Module = fetchModule(moduleName);
    if (module.hasEntry(name)) {
        let entry: ModuleEntry = module.getEntry(name);
        if (!(entry instanceof EventEntry))
            throw new Error("Not an event, cannot attach workflow to " + entry.name)
    } else {
        addEvent(name, new Array<Attribute>, moduleName);
    }
    module.addEntry(new WorkflowEntry(asWorkflowName(name), statements));
    return name;
}

export function getWorkflow(eventInstance: Instance): WorkflowEntry {
    let name: string = eventInstance.name;
    let path: Path = splitPath(name);
    let moduleName: string = activeModule;
    if (path.hasModule()) moduleName = path.getModuleName();
    let eventName: string = path.getEntryName();
    let wfName: string = asWorkflowName(eventName);
    let module: Module = fetchModule(moduleName);
    if (module.hasEntry(wfName)) {
        return module.getEntry(wfName) as WorkflowEntry
    }
    return EmptyWorkflow;
}

function getAttributeSpec(attrsSpec: RecordSchema, attrName: string): AttributeSpec {
    let spec: AttributeSpec | undefined = attrsSpec.get(attrName);
    if (spec == undefined) {
        throw new Error("Failed to find spec for attribute " + attrName);
    }
    return spec;
}

function validateType(attrName: string, attrValue: any, attrSpec: AttributeSpec) {
    let predic = builtInChecks.get(attrSpec.type);
    if (predic != undefined) {
        if (!predic(attrValue)) {
            throw new Error("Invalid value " + attrValue + " specified for " + attrName);
        }
    }
}

export type InstanceAttributes = Map<string, any>;

export function newInstanceAttributes(): InstanceAttributes {
    return new Map<string, any>();
}

export class Instance {
    record: RecordEntry;
    name: string
    protected attributes: InstanceAttributes;

    constructor(record: RecordEntry, name: string, attributes: InstanceAttributes) {
        this.record = record;
        this.name = name;
        this.attributes = attributes;
    }

    lookup(k: string): any | undefined {
        return this.attributes.get(k)
    }
}

export function makeInstance(fullEntryName: string, attributes: InstanceAttributes): Instance {
    let path: Path = splitPath(fullEntryName);
    let moduleName: string = "";
    if (path.hasModule()) moduleName = path.getModuleName();
    else moduleName = activeModule;
    let module: Module = fetchModule(moduleName);
    let entryName: string = path.getEntryName();
    let record: RecordEntry = module.getRecord(entryName);
    let schema: RecordSchema = record.schema;
    attributes.forEach((value: any, key: string) => {
        if (!schema.has(key)) {
            throw new Error("Invalid attribute " + key + " specified for " + fullEntryName);
        }
        let spec: AttributeSpec = getAttributeSpec(schema, key);
        validateType(key, value, spec);
    });
    return new Instance(record, fullEntryName, attributes);
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