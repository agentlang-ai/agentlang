import { exec } from "node:child_process";

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
    let path: Path = splitFqName(fqFnName);
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

    constructor(moduleName: MaybeString, entryName: MaybeString) {
        this.moduleName = moduleName
        this.entryName = entryName
    }

    hasModule(): boolean {
        return isString(this.moduleName)
    }

    hasEntry(): boolean {
        return isString(this.entryName)
    }

    getModuleName(): string {
        return asString(this.moduleName)
    }

    getEntryName(): string {
        return asString(this.entryName)
    }
}

export function makeFqName(moduleName: string, entryName: string): string {
    return moduleName + "/" + entryName
}

export function isFqName(s: string): boolean {
    return s.indexOf("/") > 0
}

export function splitFqName(s: string): Path {
    if (s.indexOf("/") > 0) {
        let parts: string[] = s.split("/")
        return new Path(parts[0], parts[1])
    }
    return new Path(undefined, s);
}

export function splitRefs(s: string): string[] {
    if (s.indexOf(".") > 0) {
        return s.split(".")
    } else {
        return [s]
    }
}

export function runShellCommand(cmd: string, continuation: Function) {
    exec(cmd, (err, stdout: string, stderr: string) => {
        if (err) {
            throw new Error(`Failed to execute ${cmd} - ${err.message}`)
        }
        if (stdout.length > 0) {
            console.log(stdout)
            continuation()
        }
        if (stderr.length > 0) console.log(stderr)
    });
}