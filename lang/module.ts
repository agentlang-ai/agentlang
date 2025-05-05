import { Attribute, Property } from './language/generated/ast.js';

const moduleDb = new Map<string, object>();

let activeModule: string = "";

export function addModule(name: string): string {
    moduleDb.set(name, {});
    activeModule = name;
    return name;
}

export function isModule(name: string): boolean {
    return moduleDb.has(name);
}

export function addEntity(name: string, attrs: Attribute[]) {
}