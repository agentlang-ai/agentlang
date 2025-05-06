import chalk from 'chalk';
import { Attribute, Properties, Property, isProperties } from '../language/generated/ast.js';
import { Path, splitPath } from "./util.js";

class ModuleEntry {
    name: string;

    constructor(name: string) {
        this.name = name;
    }
}

class Entity extends ModuleEntry {
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

class Module {
    entries: ModuleEntry[];
    index: Map<string, number>;

    constructor() {
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
}

const moduleDb = new Map<string, Module>;

let activeModule: string = "";

export function addModule(name: string): string {
    moduleDb.set(name, new Module());
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

const builtInTypes = new Set(["String", "Int", "Number", "Email", "Date", "Time", "DateTime", "Boolean"]);
const propertyNames = new Set(["@id", "@indexed", "@default", "@optional"]);

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

export function addEvent(name: string, attrs: Attribute[], module = activeModule) {
}

export function addRecord(name: string, attrs: Attribute[], module = activeModule) {
}

export function addRelationship(name: string, attrs: Attribute[], module = activeModule) {
}

export function addWorkflow(name: string, attrs: Attribute[], module = activeModule) {
}