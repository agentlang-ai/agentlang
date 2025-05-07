import chalk from 'chalk';
import { Attribute, Properties, Property, isProperties, Pattern, isProperty } from '../language/generated/ast.js';
import { Path, splitPath, isString, isNumber, isBoolean } from "./util.js";

class ModuleEntry {
    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

type AttributeSpec = {
    type: string;
    properties?: Properties
}

type RecordSchema = Map<string, AttributeSpec>;

export function newRecordSchema(): RecordSchema {
    return new Map<string, AttributeSpec>()
}

type Meta = Map<string, string>;

export function newMeta(): Meta {
    return new Map<string, string>()
}

class Record extends ModuleEntry {
    schema: RecordSchema;
    meta: Meta;

    constructor(name: string, attributes: Attribute[]) {
        super(name);
        this.schema = newRecordSchema();
        attributes.forEach((a: Attribute) => {
            this.schema.set(a.name, { type: a.type, properties: a.props })
        })
        this.meta = newMeta();
    }

    addMeta(k: string, v: string): void {
        this.meta.set(k, v);
    }
}

class Entity extends Record { }
class Event extends Record { }

class Workflow extends ModuleEntry {
    patterns: Pattern[];

    constructor(name: string, patterns: Pattern[]) {
        super(name)
        this.patterns = patterns
    }
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
        this.index.set(entry.name, this.entries.length);
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

    getRecord(recordName: string): Record {
        let e: ModuleEntry = this.getEntry(recordName);
        if (e instanceof Record) {
            return (e as Record);
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

function validateProperties(props: Properties | undefined): void {
    if (isProperties(props)) {
        props.properties.forEach((p: Property) => {
            if (!propertyNames.has(p.name))
                throw new Error("Invalid property " + p.name);
        })
    }
}

function verifyAttribute(attr: Attribute): void {
    checkType(attr.type);
    validateProperties(attr.props);
}

export function defaultAttributes(schema: RecordSchema): Map<string, any> {
    let result: Map<string, any> = new Map<string, any>();
    schema.forEach((v: AttributeSpec, k: string) => {
        let props: Properties | undefined = v.properties;
        if (isProperties(props)) {
            let d: Property | undefined = props.properties.find((v: Property) => v.name == '@default');
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
    module.addEntry(new Entity(name, attrs));
    return name;
}

export function addEvent(name: string, attrs: Attribute[], moduleName = activeModule) {
    let module: Module = fetchModule(moduleName);
    attrs.forEach((a) => verifyAttribute(a));
    module.addEntry(new Event(name, attrs));
    return name;
}

export function addRecord(name: string, attrs: Attribute[], moduleName = activeModule) {
    let module: Module = fetchModule(moduleName);
    attrs.forEach((a) => verifyAttribute(a));
    module.addEntry(new Record(name, attrs));
    return name;
}

export function addWorkflow(name: string, patterns: Pattern[], moduleName = activeModule) {
    let module: Module = fetchModule(moduleName);
    if (module.hasEntry(name)) {
        let entry: ModuleEntry = module.getEntry(name);
        if (!(entry instanceof Event))
            throw new Error("Not an event, cannot attach workflow to " + entry.name)
    } else {
        addEvent(name, new Array<Attribute>, moduleName);
    }
    module.addEntry(new Workflow(name + "_workflow", patterns));
    return name;
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
    attributes: InstanceAttributes;

    constructor(attributes: InstanceAttributes) {
        this.attributes = attributes;
    }
}

export function makeInstance(fullEntryName: string, attributes: InstanceAttributes): Instance {
    let path: Path = splitPath(fullEntryName);
    let moduleName: string = "";
    if (path.hasModule()) moduleName = path.getModuleName();
    else moduleName = activeModule;
    let module: Module = fetchModule(moduleName);
    let entryName: string = path.getEntryName();
    let record: Record = module.getRecord(entryName);
    let schema: RecordSchema = record.schema;
    attributes.forEach((value: any, key: string) => {
        if (!schema.has(key)) {
            throw new Error("Invalid attribute " + key + " specified for " + fullEntryName);
        }
        let spec: AttributeSpec = getAttributeSpec(schema, key);
        validateType(key, value, spec);
    });
    return new Instance(attributes);
}