import chalk from 'chalk';
import { Attribute, Properties, Property, isProperties, Pattern } from '../language/generated/ast.js';
import { Path, splitPath } from "./util.js";

class ModuleEntry {
    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

class Record extends ModuleEntry {
    attributes: Attribute[];
    meta: Map<string, string>;

    constructor(name: string, attributes: Attribute[]) {
        super(name);
        this.attributes = attributes;
        this.meta = new Map<string, string>;
    }

    addMeta(k: string, v: string): void {
        this.meta.set(k, v);
    }
}

class Entity extends Record {}
class Event extends Record {}

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

const builtInTypes = new Set(["String", "Int", "Number", "Email", "Date", "Time", "DateTime", "Boolean", "UUID", "URL"]);
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