import { Attribute } from '../language/generated/ast.js';

type Properties = Map<string, object> | undefined;

type AttributeEntry = {
    type: String;
    properties: Properties;
}

type ModuleEntry = {
    attributes: Map<string, AttributeEntry>;
    properties: Properties;
}

type ModuleEntries = Map<string, Map<string, ModuleEntry>>;

const moduleDb = new Map<string, ModuleEntries>;

let activeModule: string = "";

export function addModule(name: string): string {
    moduleDb.set(name, new Map());
    activeModule = name;
    return name;
}

export function isModule(name: string): boolean {
    return moduleDb.has(name);
}

function getEntries(module: string): ModuleEntries {
    let entries = moduleDb.get(module);
    if (entries == undefined) return new Map();
    return entries;
}

export function addEntity(name: string, attrs: Attribute[], module = activeModule) {
    let entries: ModuleEntries = getEntries(module);
    let entities = entries.get("entities");
    if (entities == undefined) entities = new Map();
    let attrsSpec = new Map();
    attrs.flatMap((a) => attrsSpec.set(a.name, {type: a.type}));
    let entityDef: ModuleEntry = {
        attributes: attrsSpec,
        properties: undefined
    };
    entities.set(name, entityDef);
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