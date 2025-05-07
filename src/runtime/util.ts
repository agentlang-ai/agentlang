const importedModules = new Map<string, any>();

// Usage: importModule("./mymodels/acme.js")
export async function importModule(path: string, name: string) {
    let m = await import(path);
    importedModules.set(name, m);
    // e.g of dynamic fn-call:
    //// let f = eval("(a, b) => m.add(a, b)");
    //// console.log(f(10, 20))
    return m;
}

export function moduleImported(moduleName: string): boolean {
    return importedModules.has(moduleName);
}

export function invokeModuleFn(fqFnName: string, args: Array<any> | null): any {
    let path: Path = splitPath(fqFnName);
    if (path.hasModule()) {
        let m = importedModules.get(path.getModuleName());
        if (m != undefined) {
            let f = m[path.getEntryName()];
            if (f != undefined) {
                if (args == null) return f.apply(null)
                else return f.apply(null, args)
            } else throw new Error("Function not found - " + fqFnName)
        } else throw new Error("JavaScript module " + path.getModuleName() + " not found")
    } else {
        let f = eval(fqFnName);
        if (f instanceof Function) {
            if (args == null) return f.apply(null)
            else return f.apply(null, args)
        } else {
            throw new Error("Not a function: " + fqFnName)
        }
    }
}

export function isNumber(x: any): boolean {
    return (typeof x === "number");
}

export function isBoolean(x: any): boolean {
    return (typeof x === "boolean");
}

type MaybeString = string | undefined;

export function isString(s: MaybeString): boolean {
    return s != undefined && (typeof s === "string");
}

function asString(s: MaybeString): string {
    if (s == undefined) return ""
    else return s
}

export class Path {
    private moduleName: MaybeString;
    private entryName: MaybeString;
    private refs: string[] | null;

    private static EmptyRefs = new Array<string>();

    constructor(moduleName: MaybeString, entryName: MaybeString, refs: string[] | null) {
        this.moduleName = moduleName;
        this.entryName = entryName;
        this.refs = refs;
    }

    hasModule(): boolean {
        return isString(this.moduleName)
    }

    hasEntry(): boolean {
        return isString(this.entryName)
    }

    hasRefs(): boolean {
        if (this.refs == null) return false
        if (this.refs.length == 0) return false
        return true
    }

    getModuleName(): string {
        return asString(this.moduleName)
    }

    getEntryName(): string {
        return asString(this.entryName)
    }

    getRefs(): string[] {
        if (this.refs == null) return Path.EmptyRefs
        return this.refs
    }
}

export function splitPath(s: string): Path {
    if (s.indexOf(".") > 0) {
        let parts: string[] = s.split(".");
        return new Path(parts[0], parts[1], parts.slice(2));
    }
    return new Path(undefined, s, null);
}

export function splitRefs(s: string): string[] {
    if (s.indexOf(".") > 0) {
        return s.split(".")
    } else {
        return [s]
    }
}