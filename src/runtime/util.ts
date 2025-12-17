import { isNodeEnv } from '../utils/runtime.js';
import {
  AliasSpec,
  CatchSpec,
  ExtendsClause,
  isLiteral,
  MapEntry,
  MapLiteral,
  MetaDefinition,
  PrePostTriggerDefinition,
  RbacSpecDefinition,
  RecordExtraDefinition,
  RecordSchemaDefinition,
  Statement,
} from '../language/generated/ast.js';
import { readFile } from '../utils/fs-utils.js';
import bcrypt from 'bcryptjs';
import path from 'node:path';

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

export function isNumber(x: any): boolean {
  return typeof x === 'number';
}

export function isMinusZero(value: number): boolean {
  return 1 / value === -Infinity;
}

export function isBoolean(x: any): boolean {
  return typeof x === 'boolean';
}

export function isStringNumeric(str: string): boolean {
  return !isNaN(Number(str)) && !isNaN(parseFloat(str));
}

type MaybeString = string | undefined;

export function isString(s: MaybeString): boolean {
  return s !== undefined && typeof s === 'string';
}

function asString(s: MaybeString): string {
  if (s === undefined) return '';
  else return s;
}

const QuoteCharacter = '&quot;';

export function restoreSpecialChars(s: string) {
  return s.replaceAll(QuoteCharacter, '"');
}

export function escapeSpecialChars(s: string) {
  return s.replaceAll('"', QuoteCharacter);
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

export function forceAsFqName(entryName: string, moduleName: string): string {
  if (entryName.indexOf('$') > 0) {
    return restoreFqName(entryName);
  }
  if (isFqName(entryName)) {
    return entryName;
  }
  return makeFqName(moduleName, entryName);
}

export function forceAsEscapedName(entryName: string, moduleName: string): string {
  if (entryName.indexOf('$') > 0) {
    return entryName;
  }
  if (isFqName(entryName)) {
    return escapeFqName(entryName);
  }
  return `${moduleName}$${entryName}`;
}

export function isFqName(s: string): boolean {
  return s.indexOf('/') > 0;
}

export function nameToPath(s: string): Path {
  if (s.indexOf('/') > 0) {
    const parts: string[] = s.split('/');
    return new Path(parts[0], parts[1]);
  }
  return new Path(undefined, s);
}

export function splitFqName(s: string): string[] {
  return s.split('/');
}

export function splitRefs(s: string): string[] {
  if (s.indexOf('.') > 0) {
    return s.split('.');
  } else {
    return [s];
  }
}

export function rootRef(s: string): string {
  return splitRefs(s)[0];
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

export function escapeFqName(n: string, moduleName?: string): string {
  if (moduleName) {
    if (n.indexOf('/') < 0) {
      return `${moduleName}$${n}`;
    }
  }
  return n.replace('/', '$');
}

export function restoreFqName(n: string): string {
  return n.replace('$', '/');
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
export const DefaultModules = new Set();
export const DefaultFileHandlingDirectory = 'fs';

export function makeCoreModuleName(n: string): string {
  return DefaultModuleName + '.' + n;
}

export function isCoreModule(n: string): boolean {
  return n === DefaultModuleName || n.startsWith(`${DefaultModuleName}.`);
}

export function isCoreDefinition(n: string): boolean {
  if (isFqName(n)) {
    const parts = splitFqName(n);
    return isCoreModule(parts[0]);
  }
  return false;
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
  PRE_POST_TRIGGER,
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
        case ExtraType.PRE_POST_TRIGGER:
          return ex.prePost ? true : false;
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

export function findUqCompositeAttributes(
  scm: RecordSchemaDefinition | undefined
): Array<string> | undefined {
  if (scm && scm.extras) {
    const uqs = scm.extras.filter((ex: RecordExtraDefinition) => {
      return ex.uq ? true : false;
    });
    if (uqs && uqs.length > 0) {
      if (uqs.length == 1 && uqs[0].uq) {
        return uqs[0].uq.attrs;
      } else {
        let attrs = new Array<string>();
        uqs.forEach((uq: RecordExtraDefinition) => {
          if (uq.uq) {
            attrs = attrs.concat(uq.uq.attrs);
          }
        });
        return attrs;
      }
    }
  }
  return undefined;
}

export function findAllPrePostTriggerSchema(
  scm: RecordSchemaDefinition | undefined
): PrePostTriggerDefinition[] | undefined {
  if (scm && scm.extras) {
    let result: PrePostTriggerDefinition[] | undefined;
    for (let i = 0; i < scm.extras.length; ++i) {
      const rex: RecordExtraDefinition = scm.extras[i];
      if (rex.prePost) {
        if (result === undefined) {
          result = new Array<PrePostTriggerDefinition>();
        }
        result.push(rex.prePost);
      }
    }
    return result;
  }
  return undefined;
}

export enum CrudType {
  CREATE,
  UPDATE,
  DELETE,
  READ,
  UPSERT,
}

export function asCrudType(s: string): CrudType {
  const r: CrudType | undefined = CrudType[s.toUpperCase() as keyof typeof CrudType];
  if (r === undefined) {
    throw new Error(`${s} does not represent a valid CrudType`);
  }
  return r;
}

export function isPath(obj: any, ref?: string): boolean {
  if (isString(obj)) {
    const s = obj as string;
    const r = s.indexOf('/') > 0;
    if (r && ref) {
      return s.indexOf(ref) >= 0;
    }
    return r;
  } else {
    return false;
  }
}

export function fqNameFromPath(path: string): string | undefined {
  const parts = path.split('/');
  const len = parts.length;
  if (len > 1) {
    const n = restoreFqName(parts[len - 2]);
    if (n.indexOf('/') > 0) {
      return n;
    }
  }
  return undefined;
}

export function firstAliasSpec(stmt: Statement): AliasSpec | undefined {
  if (stmt.hints) {
    for (let i = 0; i < stmt.hints.length; ++i) {
      const rh = stmt.hints[i];
      if (rh.aliasSpec) {
        return rh.aliasSpec;
      }
    }
  }
  return undefined;
}

export function firstCatchSpec(stmt: Statement): CatchSpec | undefined {
  if (stmt.hints) {
    for (let i = 0; i < stmt.hints.length; ++i) {
      const rh = stmt.hints[i];
      if (rh.catchSpec) {
        return rh.catchSpec;
      }
    }
  }
  return undefined;
}

function maybeExtractEntryName(n: string): string {
  const i = n.indexOf('$');
  if (i > 0) {
    return n.substring(i + 1);
  }
  return n;
}

function maybeExtractModuleName(n: string, moduleName?: string | undefined): string {
  const i = n.indexOf('$');
  if (i > 0) {
    return n.substring(0, i);
  }
  if (moduleName === undefined) {
    throw new Error(`Failed to extract module-name from ${n}`);
  }
  return moduleName;
}

export function walkDownInstancePath(path: string): [string, string, string | undefined, string[]] {
  const parts = path.split('/').filter((n: string) => {
    return n.length > 0;
  });
  const nameParts = parts[0].split('$');
  const hasParts = nameParts.length == 2;
  let moduleName = hasParts ? nameParts[0] : parts[0];
  let entryName = hasParts ? nameParts[1] : parts[1];
  if (!hasParts && parts.length == 2) {
    return [moduleName, entryName, undefined, parts];
  }
  if (parts.length > 1) {
    let id: string | undefined = parts[1];
    if (parts.length > 2) {
      for (let i = 2; i < parts.length; ++i) {
        const relName = parts[i];
        moduleName = maybeExtractModuleName(relName, moduleName);
        entryName = parts[++i];
        moduleName = maybeExtractModuleName(entryName, moduleName);
        entryName = maybeExtractEntryName(entryName);
        if (i < parts.length) {
          id = parts[++i];
        } else {
          id = undefined;
        }
      }
    }
    return [moduleName, entryName, id, parts];
  }
  return [moduleName, entryName, undefined, parts];
}

export function areSetsEqual<T>(set1: Set<T>, set2: Set<T>): boolean {
  if (set1.size !== set2.size) {
    return false;
  }
  for (const item of set1) {
    if (!set2.has(item)) {
      return false;
    }
  }
  return true;
}

const ReservedNames = new Set([
  'if',
  'else',
  'for',
  'or',
  'and',
  'entity',
  'record',
  'event',
  'workflow',
  'create',
  'delete',
  'update',
  'upsert',
  'agent',
  'resolver',
]);

export function isReservedName(s: string): boolean {
  return ReservedNames.has(s);
}

export function encryptPassword(s: string): string {
  return bcrypt.hashSync(s, 10);
}

export function comparePassword(s: string, hash: string): boolean {
  return bcrypt.compareSync(s, hash);
}

export function fileExtension(fileName: string): string {
  if (isNodeEnv) {
    return path.extname(fileName);
  } else {
    const idx = fileName.lastIndexOf('.');
    if (idx >= 0) {
      return fileName.substring(idx);
    }
  }
  return '';
}

export function trimQuotes(s: string): string {
  let ss = s.trim();
  if (ss[0] == '"') {
    ss = ss.substring(1);
  }
  if (ss[ss.length - 1] == '"') {
    return ss.substring(0, ss.length - 1);
  }
  return ss;
}

export function asStringLiteralsMap(mapLit: MapLiteral): Map<string, string> {
  const result = new Map<string, string>();
  mapLit.entries.forEach((me: MapEntry) => {
    const k = me.key.str;
    if (k && isLiteral(me.value)) {
      const v = me.value.str || me.value.id || me.value.ref;
      if (v) result.set(k, v);
    }
  });
  return result;
}

const IdSepEscape = '__';

export function escapeSepInPath(path: string): string {
  return path.replace(IdSepEscape, '/');
}

export function validateIdFormat(idAttrName: string, idAttrValue: any) {
  if (isString(idAttrValue)) {
    if (idAttrValue.indexOf(IdSepEscape) >= 0) {
      throw new Error(`${IdSepEscape} not allowed in @id ${idAttrName} - '${idAttrValue}'`);
    }
  }
}

export function nameContainsSepEscape(n: string): boolean {
  return n.indexOf(IdSepEscape) >= 0;
}

export function generateUrlSafePassword(length: number = 8): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '-_.~';

  const chars = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
  ];

  const all = upper + lower + digits + special;
  for (let i = chars.length; i < length; ++i) {
    chars.push(all[Math.floor(Math.random() * all.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

const JS_PREFIX = '#js';

export function preprocessRawConfig(rawConfig: any): any {
  const keys = Object.keys(rawConfig);
  keys.forEach((k: any) => {
    const v = rawConfig[k];
    if (isString(v) && v.startsWith(JS_PREFIX)) {
      const s = v.substring(3).trim();
      rawConfig[k] = eval(s);
    } else if (typeof v == 'object') {
      preprocessRawConfig(v);
    }
  });
  return rawConfig;
}

// interface for reading secrets from a secret-store
type ReadSecret = (k: string, configuration?: any) => any;
declare global {
  function readSecret(k: string, configuration?: any): any;
}

export function setScecretReader(f: ReadSecret) {
  globalThis.readSecret = f;
}

export function objectAsString(obj: any) {
  const entries = new Array<string>();
  Object.entries(obj).forEach(([k, v]) => {
    const vv = typeof v === 'string' ? `"${v}"` : v;
    entries.push(`${k}: ${vv}`);
  });
  return `{${entries.join(', ')}}`;
}
