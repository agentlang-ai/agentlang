import { parseAndEvaluateStatement } from './runtime/interpreter.js';
import {
  fetchModule,
  Instance,
  Module,
  Record,
} from './runtime/module.js';

type AttributeMap = { [key: string]: any };

// A related entity within a relationship pattern
export interface RelEntity {
  entity: string;         // entity name, e.g. "Post"
  attrs: AttributeMap;    // entity attributes
  query?: boolean;        // true = query mode ({Entity? {}} or {Entity {k? v}})
  rels?: RelSpec;         // nested relationships
}

// Maps relationship names to related entity specs
export type RelSpec = {
  [relName: string]: RelEntity | RelEntity[];
};

function formatValue(value: any): string {
  if (typeof value === 'string') return `"${value}"`;
  if (Array.isArray(value))
    return '[' + value.map(formatValue).join(', ') + ']';
  return String(value);
}

function buildEntityPattern(
  fqName: string,
  attrs: AttributeMap,
  queryMode: boolean | string = false
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (queryMode === true) {
      parts.push(`${key}? ${formatValue(value)}`);
    } else if (typeof queryMode === 'string' && key === queryMode) {
      parts.push(`${key}? ${formatValue(value)}`);
    } else {
      parts.push(`${key} ${formatValue(value)}`);
    }
  }
  return `{${fqName} {${parts.join(', ')}}}`;
}

function buildRelEntityPattern(moduleName: string, spec: RelEntity): string {
  const fqName = `${moduleName}/${spec.entity}`;
  let pattern: string;
  if (spec.query && Object.keys(spec.attrs).length === 0) {
    pattern = `{${fqName}? {}}`;
  } else {
    pattern = buildEntityPattern(fqName, spec.attrs, spec.query === true);
  }
  if (spec.rels) {
    // Strip trailing } and append nested rels
    const inner = pattern.slice(0, -1);
    const relParts = buildRelParts(moduleName, spec.rels);
    pattern = `${inner},\n${relParts}}`;
  }
  return pattern;
}

function buildRelParts(moduleName: string, rels: RelSpec): string {
  const parts: string[] = [];
  for (const [relName, relEntities] of Object.entries(rels)) {
    if (Array.isArray(relEntities)) {
      const entityPatterns = relEntities.map(e => buildRelEntityPattern(moduleName, e));
      parts.push(`${relName} [${entityPatterns.join(', ')}]`);
    } else {
      parts.push(`${relName} ${buildRelEntityPattern(moduleName, relEntities)}`);
    }
  }
  return parts.join(',\n');
}

function buildPattern(
  fqName: string,
  attrs: AttributeMap,
  queryMode: boolean | string = false,
  moduleName?: string,
  rels?: RelSpec
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (queryMode === true) {
      parts.push(`${key}? ${formatValue(value)}`);
    } else if (typeof queryMode === 'string' && key === queryMode) {
      parts.push(`${key}? ${formatValue(value)}`);
    } else {
      parts.push(`${key} ${formatValue(value)}`);
    }
  }
  let pattern = `{${fqName} {${parts.join(', ')}}}`;
  if (rels && moduleName) {
    // Strip outer closing } and append relationship parts
    pattern = pattern.slice(0, -1);
    const relParts = buildRelParts(moduleName, rels);
    pattern = `${pattern},\n${relParts}}`;
  }
  return pattern;
}

function toObject(result: any): any {
  if (result instanceof Instance) {
    const obj: any = result.userAttributesAsObject();
    if (result.relatedInstances) {
      result.relatedInstances.forEach((insts: Instance[], relName: string) => {
        obj[relName] = insts.map(toObject);
      });
    }
    return obj;
  }
  if (Array.isArray(result)) {
    return result.map(toObject);
  }
  return result;
}

async function evalPattern(pattern: string): Promise<any> {
  try {
    const result = await parseAndEvaluateStatement(pattern);
    return toObject(result);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    throw new Error(`Error evaluating pattern: ${pattern}\n  ${message}`);
  }
}

export function is(condition: boolean, message?: string): void {
  if (!condition) {
    const err = new Error(message ?? 'Assertion failed');
    if (err.stack) {
      const lines = err.stack.split('\n');
      const callerLine = lines.find(
        (l) => !l.includes('test-harness') && l.includes('.test.')
      );
      if (callerLine) {
        err.message += `\n  at ${callerLine.trim()}`;
      }
    }
    throw err;
  }
}

export interface AssertionResult {
  passed: boolean;
  message: string;
}

export interface TestResult {
  passed: boolean;
  total: number;
  failures: number;
  results: AssertionResult[];
  error?: { message: string; pattern?: string };
  duration: number;
}

class TestAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestAssertionError';
  }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export async function runTests(
  moduleDefinition: string,
  testScript: string,
  initModule: (moduleName: string, code: string) => Promise<void>
): Promise<TestResult> {
  const start = Date.now();
  const assertions: AssertionResult[] = [];
  let testError: { message: string; pattern?: string } | undefined;

  const match = moduleDefinition.match(/^\s*module\s+([\w.]+)/);
  if (!match) {
    return {
      passed: false,
      total: 0,
      failures: 1,
      results: [],
      error: { message: 'Invalid module definition: missing "module <name>" declaration' },
      duration: Date.now() - start,
    };
  }
  const moduleName = match[1];
  const moduleBody = moduleDefinition.substring(match[0].length);

  try {
    const proxy = await testModule(moduleName, moduleBody, initModule);

    const trackingIs = (condition: boolean, message?: string) => {
      if (condition) {
        assertions.push({ passed: true, message: message ?? 'OK' });
      } else {
        const failMsg = message ?? 'Assertion failed';
        assertions.push({ passed: false, message: failMsg });
        throw new TestAssertionError(failMsg);
      }
    };

    const paramNames = Object.keys(proxy);
    const paramValues = Object.values(proxy);
    const testFn = new AsyncFunction(...paramNames, 'is', testScript);
    await testFn(...paramValues, trackingIs);
  } catch (err: any) {
    if (!(err instanceof TestAssertionError)) {
      const message = err?.message ?? String(err);
      const patternMatch = message.match(/Error evaluating pattern: (.+)\n/);
      testError = {
        message,
        pattern: patternMatch ? patternMatch[1] : undefined,
      };
    }
  }

  const failures = assertions.filter(a => !a.passed).length;
  return {
    passed: !testError && failures === 0,
    total: assertions.length,
    failures,
    results: assertions,
    error: testError,
    duration: Date.now() - start,
  };
}

// --- Pattern parsing for runPatternTests ---

interface ParsedAttr {
  name: string;
  query: boolean;
  value: string;
}

interface ParsedPattern {
  isDelete: boolean;
  fqName: string;
  entityQuery: boolean; // {Entity? {}}
  attrs: ParsedAttr[];
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && (i === 0 || s[i - 1] !== '\\')) {
      inString = !inString;
    }
    if (!inString) {
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseAttr(s: string): ParsedAttr {
  const m = s.match(/^(\w+)(\?)?\s+([\s\S]+)$/);
  if (!m) throw new Error(`Cannot parse attribute: ${s}`);
  return { name: m[1], query: !!m[2], value: m[3].trim() };
}

function parseCrudPattern(s: string): ParsedPattern | null {
  let input = s.trim();

  const isDelete = input.startsWith('delete');
  if (isDelete) input = input.replace(/^delete\s+/, '');

  if (input[0] !== '{') return null;

  // Skip outer opening {
  let i = 1;
  while (i < input.length && input[i] === ' ') i++;

  // Read fqName
  let fqName = '';
  while (i < input.length && !/[\s{?]/.test(input[i])) {
    fqName += input[i];
    i++;
  }
  if (!fqName.includes('/')) return null;

  // Check for entity-level query ?
  while (i < input.length && input[i] === ' ') i++;
  let entityQuery = false;
  if (input[i] === '?') {
    entityQuery = true;
    i++;
  }

  // Find inner {attrs} - match braces
  while (i < input.length && input[i] !== '{') i++;
  if (i >= input.length) return null;

  let depth = 0;
  const start = i;
  while (i < input.length) {
    if (input[i] === '"') {
      i++;
      while (i < input.length && input[i] !== '"') i++;
    } else if (input[i] === '{') {
      depth++;
    } else if (input[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }

  const attrsStr = input.substring(start + 1, i).trim();
  const attrs = attrsStr ? splitTopLevel(attrsStr).map(parseAttr) : [];

  return { isDelete, fqName, entityQuery, attrs };
}

function patternToScript(
  pattern: string,
  eventNames: Set<string>
): string {
  const trimmed = pattern.trim();
  if (trimmed.startsWith('is(')) return trimmed;

  const parsed = parseCrudPattern(trimmed);
  if (!parsed) throw new Error(`Cannot parse pattern: ${trimmed}`);

  const entryName = parsed.fqName.split('/')[1];
  const jsObj = parsed.attrs.map(a => `${a.name}: ${a.value}`).join(', ');

  if (parsed.isDelete) {
    return `result = await delete_${entryName}({${jsObj}});`;
  }
  if (eventNames.has(entryName)) {
    return `result = await ${entryName}({${jsObj}});`;
  }
  if (parsed.entityQuery || parsed.attrs.every(a => a.query)) {
    return `result = (await get_${entryName}({${jsObj}}))[0];`;
  }
  if (parsed.attrs.some(a => a.query)) {
    return `result = await update_${entryName}({${jsObj}});`;
  }
  return `result = await create_${entryName}({${jsObj}});`;
}

export async function runPatternTests(
  moduleDefinition: string,
  patterns: string[],
  initModule: (moduleName: string, code: string) => Promise<void>
): Promise<TestResult> {
  const eventNames = new Set<string>();
  for (const m of moduleDefinition.matchAll(/\bevent\s+(\w+)\s*\{/g)) {
    eventNames.add(m[1]);
  }

  const lines: string[] = ['let result;'];
  for (const pat of patterns) {
    lines.push(patternToScript(pat, eventNames));
  }

  return runTests(moduleDefinition, lines.join('\n'), initModule);
}

export interface TestModuleProxy {
  [key: string]: (attrs: AttributeMap, rels?: RelSpec) => Promise<any>;
}

export async function testModule(
  moduleName: string,
  code: string,
  initModule: (moduleName: string, code: string) => Promise<void>
): Promise<TestModuleProxy> {
  await initModule(moduleName, code);
  const mod: Module = fetchModule(moduleName);
  const proxy: TestModuleProxy = {};

  for (const entityName of mod.getEntityNames()) {
    const fqName = `${moduleName}/${entityName}`;
    const record = mod.getEntry(entityName) as Record;
    const idAttrName = record.getIdAttributeName();

    proxy[`create_${entityName}`] = async (attrs: AttributeMap, rels?: RelSpec) => {
      const pattern = buildPattern(fqName, attrs, false, moduleName, rels);
      return await evalPattern(pattern);
    };

    proxy[`get_${entityName}`] = async (attrs: AttributeMap, rels?: RelSpec) => {
      const pattern = buildPattern(fqName, attrs, true, moduleName, rels);
      return await evalPattern(pattern);
    };

    proxy[`update_${entityName}`] = async (attrs: AttributeMap, rels?: RelSpec) => {
      if (!idAttrName) {
        throw new Error(
          `Cannot update ${fqName}: no @id attribute defined`
        );
      }
      if (!(idAttrName in attrs)) {
        throw new Error(
          `Cannot update ${fqName}: @id attribute '${idAttrName}' not provided`
        );
      }
      const pattern = buildPattern(fqName, attrs, idAttrName, moduleName, rels);
      return await evalPattern(pattern);
    };

    proxy[`delete_${entityName}`] = async (attrs: AttributeMap) => {
      const pattern = `delete ${buildPattern(fqName, attrs, true)}`;
      return await evalPattern(pattern);
    };
  }

  for (const eventName of mod.getEventNames()) {
    if (mod.isPrePostEvent(eventName)) continue;
    const fqName = `${moduleName}/${eventName}`;

    proxy[eventName] = async (attrs: AttributeMap) => {
      const pattern = buildPattern(fqName, attrs);
      return await evalPattern(pattern);
    };
  }

  return proxy;
}
