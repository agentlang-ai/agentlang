import { isNodeEnv } from '../utils/runtime.js';
import {
  ExtendsClause,
  MetaDefinition,
  RbacSpecDefinition,
  RecordExtraDefinition,
  RecordSchemaDefinition,
} from '../language/generated/ast.js';
import { readFile } from '../utils/fs-utils.js';

export const QuerySuffix = '?';

// Conditionally import Node.js specific modules
let exec: any = undefined;
let promisify: any = undefined;
if (isNodeEnv) {
  // Dynamic import for node:child_process to avoid browser compatibility issues
  const childProcess = await import('node:child_process');
  exec = childProcess.exec;

  const nu = await import('node:util');
  promisify = nu.promisify;
}

const importedModules = new Map<string, any>();

// Usage: importModule("./mymodels/acme.js")
export async function importModule(path: string, name: string) {
  const m = await import(/* @vite-ignore */ path);
  importedModules.set(name, m);
  // e.g of dynamic fn-call:
  //// let f = eval("(a, b) => m.add(a, b)");
  //// console.log(f(10, 20))
  return m;
}

export function moduleImported(moduleName: string): boolean {
  return importedModules.has(moduleName);
}

export async function invokeModuleFn(
  fqFnName: string,
  args: Array<any> | null,
  isAsync: boolean = false
): Promise<any> {
  const refs: string[] = splitRefs(fqFnName);
  if (refs.length == 2) {
    const m = importedModules.get(refs[0]);
    if (m != undefined) {
      const f = m[refs[1]];
      if (f != undefined) {
        if (args == null)
          if (isAsync) {
            return await f();
          } else return f();
        else if (isAsync) {
          return await f(...args);
        } else return f(...args);
      } else throw new Error(`Function not found - ${fqFnName}`);
    } else throw new Error(`JavaScript module ${refs[0]} not found`);
  } else if (refs.length == 1) {
    const f = eval(fqFnName);
    if (f instanceof Function) {
      if (args == null)
        if (isAsync) {
          return await f();
        } else return f();
      else if (isAsync) {
        return await f(...args);
      } else return f(...args);
    } else {
      throw new Error('Not a function: ' + fqFnName);
    }
  } else {
    throw new Error(`Cannot call function in nested references - ${fqFnName}`);
  }
}

export function isNumber(x: any): boolean {
  return typeof x === 'number';
}

export function isMinusZero(value: number): boolean {
  return 1 / value === -Infinity;
}

export function isBoolean(x: any): boolean {
  return typeof x === 'boolean';
}

type MaybeString = string | undefined;

export function isString(s: MaybeString): boolean {
  return s != undefined && typeof s === 'string';
}

function asString(s: MaybeString): string {
  if (s == undefined) return '';
  else return s;
}

export class Path {
  private moduleName: MaybeString;
  private entryName: MaybeString;

  constructor(moduleName: MaybeString, entryName: MaybeString) {
    this.moduleName = moduleName;
    this.entryName = entryName;
  }

  hasModule(): boolean {
    return isString(this.moduleName);
  }

  hasEntry(): boolean {
    return isString(this.entryName);
  }

  setModuleName(n: string): Path {
    this.moduleName = n;
    return this;
  }

  getModuleName(): string {
    return asString(this.moduleName);
  }

  setEntryname(n: string): Path {
    this.entryName = n;
    return this;
  }

  getEntryName(): string {
    return asString(this.entryName);
  }

  asFqName(): string {
    return makeFqName(this.moduleName || '?', this.entryName || '?');
  }

  equals(p: Path): boolean {
    return this.moduleName == p.moduleName && this.entryName == p.entryName;
  }
}

export function newPath(): Path {
  return new Path(undefined, undefined);
}

export function makeFqName(moduleName: string, entryName: string): string {
  return moduleName + '/' + entryName;
}

export function isFqName(s: string): boolean {
  return s.indexOf('/') > 0;
}

export function splitFqName(s: string): Path {
  if (s.indexOf('/') > 0) {
    const parts: string[] = s.split('/');
    return new Path(parts[0], parts[1]);
  }
  return new Path(undefined, s);
}

export function splitRefs(s: string): string[] {
  if (s.indexOf('.') > 0) {
    return s.split('.');
  } else {
    return [s];
  }
}

export function runShellCommand(cmd: string, options?: any, continuation?: Function) {
  if (!isNodeEnv) {
    console.warn('Shell commands cannot be executed in non-Node.js environments');
    // Call continuation to allow the program flow to continue
    if (continuation) continuation();
    return;
  }

  if (!exec) {
    console.error('Node.js child_process not available');
    if (continuation) continuation();
    return;
  }

  exec(cmd, options, (err: any, stdout: string, stderr: string) => {
    if (err) {
      throw new Error(`Failed to execute ${cmd} - ${err.message}`);
    }
    if (stdout.length > 0) {
      console.log(stdout);
      if (continuation) continuation();
    }
    if (stderr.length > 0) console.log(stderr);
  });
}

export function escapeFqName(n: string): string {
  return n.replace('/', '$');
}

export function arrayEquals(a: Array<any>, b: Array<any>) {
  if (a.length !== b.length) return false;
  else {
    // Comparing each element of your array
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }
}

export const DefaultModuleName = 'agentlang';

export function makeCoreModuleName(n: string): string {
  return DefaultModuleName + '_' + n;
}

const InitFunctions: Function[] = [];

export function registerInitFunction(f: Function) {
  InitFunctions.push(f);
}

export async function runInitFunctions() {
  for (let i = 0; i < InitFunctions.length; ++i) {
    await InitFunctions[i]();
  }
  InitFunctions.splice(0, InitFunctions.length);
}

export function maybeExtends(ext: ExtendsClause | undefined): string | undefined {
  return ext ? ext.parentName : undefined;
}

export function escapeQueryName(s: string): string {
  if (s.endsWith('?')) {
    return s.substring(0, s.length - 1);
  } else {
    return s;
  }
}

export function joinStatements(stmts: string[]): string {
  return stmts
    .filter((s: string) => {
      return s.trim().length > 0;
    })
    .join(';\n');
}

export const sleepMilliseconds = isNodeEnv
  ? promisify(setTimeout)
  : (m: any) => new Promise(r => setTimeout(r, m));

export function now(): string {
  return new Date().toISOString();
}

export async function slurpJsonFile(fileName: string): Promise<any> {
  const s = await readFile(fileName);
  return JSON.parse(s);
}

const enum ExtraType {
  META,
  RBAC,
}

function findExtraSchema(
  type: ExtraType,
  scm: RecordSchemaDefinition | undefined
): RecordExtraDefinition | undefined {
  if (scm && scm.extras) {
    return scm.extras.find((ex: RecordExtraDefinition) => {
      switch (type) {
        case ExtraType.META:
          return ex.meta ? true : false;
        case ExtraType.RBAC:
          return ex.rbacSpec ? true : false;
      }
    });
  } else {
    return undefined;
  }
}

export function findMetaSchema(
  scm: RecordSchemaDefinition | undefined
): MetaDefinition | undefined {
  const ex = findExtraSchema(ExtraType.META, scm);
  if (ex) {
    return ex.meta;
  }
  return undefined;
}

export function findRbacSchema(
  scm: RecordSchemaDefinition | undefined
): RbacSpecDefinition | undefined {
  const ex = findExtraSchema(ExtraType.RBAC, scm);
  if (ex) {
    return ex.rbacSpec;
  }
  return undefined;
}
