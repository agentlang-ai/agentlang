// MCP server: exposes an agentlang application as Model Context Protocol tools and resources.
// Ref: https://modelcontextprotocol.io / @modelcontextprotocol/sdk
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  AttributeSpec,
  fetchModule,
  getAllEntityNames,
  getAllEventNames,
  Instance,
  makeInstance,
  Module,
  objectAsInstanceAttributes,
  Record as AlRecord,
} from './module.js';
import { makeFqName } from './util.js';
import { evaluate, parseAndEvaluateStatement, Result } from './interpreter.js';
import { ApplicationSpec } from './loader.js';
import { Config } from './state.js';
import { logger } from './logger.js';
import { ActiveSessionInfo, BypassSession } from './auth/defs.js';

// Tool / resource names cannot contain '/'. We use '__' to join module + entry.
const SEP = '__';

// Session info for the in-flight tool/resource request, populated by the
// HTTP layer before delegating to transport.handleRequest().
const sessionStore = new AsyncLocalStorage<ActiveSessionInfo>();

export function runWithSession<T>(session: ActiveSessionInfo, fn: () => Promise<T>): Promise<T> {
  return sessionStore.run(session, fn);
}

function currentSession(): ActiveSessionInfo {
  return sessionStore.getStore() ?? BypassSession;
}

function fqToolName(moduleName: string, entryName: string, suffix?: string): string {
  const base = `${moduleName}${SEP}${entryName}`;
  return suffix ? `${base}${SEP}${suffix}` : base;
}

function parseToolName(name: string): { moduleName: string; entryName: string; suffix?: string } {
  const parts = name.split(SEP);
  if (parts.length < 2) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid tool name: ${name}`);
  }
  if (parts.length === 2) {
    return { moduleName: parts[0], entryName: parts[1] };
  }
  return { moduleName: parts[0], entryName: parts[1], suffix: parts.slice(2).join(SEP) };
}

function metaDescription(meta: Map<string, any> | undefined, fallback: string): string {
  if (!meta) return fallback;
  const docKeys = ['doc', 'description', 'comment'];
  for (const k of docKeys) {
    const v = meta.get(k);
    if (typeof v === 'string' && v.trim().length > 0) {
      return v;
    }
  }
  return fallback;
}

// Map an agentlang AttributeSpec to a JSON Schema fragment.
function attributeToJsonSchema(spec: AttributeSpec): any {
  const props = spec.properties;
  const isArray = props?.get('array') === true;
  const isObject = props?.get('object') === true;
  const enumValues: Set<string> | undefined = props?.get('enum');

  const inner = jsonSchemaForType(spec.type, isObject);
  if (enumValues && enumValues.size > 0) {
    inner.enum = Array.from(enumValues);
  }
  if (isArray) {
    return { type: 'array', items: inner };
  }
  return inner;
}

function jsonSchemaForType(type: string, isObject: boolean): any {
  switch (type) {
    case 'String':
    case 'Email':
    case 'UUID':
    case 'URL':
    case 'Path':
    case 'Password':
      return { type: 'string' };
    case 'Date':
      return { type: 'string', format: 'date' };
    case 'Time':
      return { type: 'string', format: 'time' };
    case 'DateTime':
      return { type: 'string', format: 'date-time' };
    case 'Int':
      return { type: 'integer' };
    case 'Number':
    case 'Float':
    case 'Decimal':
      return { type: 'number' };
    case 'Boolean':
      return { type: 'boolean' };
    case 'Map':
      return { type: 'object', additionalProperties: true };
    case 'Any':
      return {};
    default:
      // Custom or referenced type — treat as object if marked, else string.
      return isObject ? { type: 'object', additionalProperties: true } : { type: 'string' };
  }
}

function recordToInputSchema(
  rec: AlRecord,
  opts?: { includeAttr?: (name: string) => boolean; allOptional?: boolean }
): any {
  const properties: any = {};
  const required: string[] = [];
  rec.schema.forEach((spec: AttributeSpec, attrName: string) => {
    if (opts?.includeAttr && !opts.includeAttr(attrName)) return;
    properties[attrName] = attributeToJsonSchema(spec);
    if (opts?.allOptional) return;
    const optional = spec.properties?.get('optional') === true;
    const hasDefault =
      spec.properties?.has('default') ||
      spec.properties?.has('@default') ||
      spec.properties?.has('expr');
    if (!optional && !hasDefault) {
      required.push(attrName);
    }
  });
  const schema: any = { type: 'object', properties };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

type ListedTool = {
  name: string;
  description: string;
  inputSchema: any;
};

function listEventTools(): ListedTool[] {
  const tools: ListedTool[] = [];
  getAllEventNames().forEach((eventNames: string[], moduleName: string) => {
    const m: Module = fetchModule(moduleName);
    eventNames.forEach((eventName: string) => {
      if (!m.eventIsPublic(eventName)) return;
      let entry: AlRecord | undefined;
      try {
        entry = m.getEntry(eventName) as AlRecord;
      } catch {
        return;
      }
      const description = metaDescription(
        entry.meta,
        `Invoke agentlang event ${makeFqName(moduleName, eventName)}.`
      );
      tools.push({
        name: fqToolName(moduleName, eventName),
        description,
        inputSchema: recordToInputSchema(entry),
      });
    });
  });
  return tools;
}

function listEntityTools(): ListedTool[] {
  const tools: ListedTool[] = [];
  getAllEntityNames().forEach((entityNames: string[], moduleName: string) => {
    const m: Module = fetchModule(moduleName);
    entityNames.forEach((entityName: string) => {
      let entry: AlRecord | undefined;
      try {
        entry = m.getEntry(entityName) as AlRecord;
      } catch {
        return;
      }
      const fq = makeFqName(moduleName, entityName);
      tools.push({
        name: fqToolName(moduleName, entityName, 'create'),
        description: `Create a ${fq} record. Pass attributes as JSON.`,
        inputSchema: recordToInputSchema(entry),
      });
      tools.push({
        name: fqToolName(moduleName, entityName, 'list'),
        description: `List ${fq} records. Optional filter attributes are matched as exact equality.`,
        inputSchema: recordToInputSchema(entry, { allOptional: true }),
      });
      tools.push({
        name: fqToolName(moduleName, entityName, 'get'),
        description: `Fetch a single ${fq} record by primary key.`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      });
      tools.push({
        name: fqToolName(moduleName, entityName, 'delete'),
        description: `Delete a ${fq} record by primary key.`,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      });
    });
  });
  return tools;
}

// Tool name reserved for the built-in tool-search tool. Uses a single-segment
// name so it never collides with `module__entry[__suffix]` shapes.
const SEARCH_TOOL_NAME = 'agentlang_search_tools';

function searchToolDef(): ListedTool {
  return {
    name: SEARCH_TOOL_NAME,
    description:
      'Search the available agentlang MCP tools by free-text query. Returns the best matches ' +
      'ranked by relevance over tool name, module, and description. Use this when there are ' +
      'too many tools to enumerate or when you only know what you want to do, not the tool name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free-text query. Whitespace-split into terms; each term is matched (case-insensitive) ' +
            'against tool name, module, and description.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of matches to return. Default 20, max 100.',
        },
        kind: {
          type: 'string',
          enum: ['any', 'event', 'entity'],
          description:
            'Filter by tool kind. "event" → only @public events; "entity" → only entity CRUD tools; "any" (default) → both.',
        },
      },
      required: ['query'],
    },
  };
}

type ScoredTool = { tool: ListedTool; score: number; kind: 'event' | 'entity' };

function scoreTool(tool: ListedTool, kind: 'event' | 'entity', terms: string[]): number {
  if (terms.length === 0) return 0;
  const name = tool.name.toLowerCase();
  const desc = (tool.description || '').toLowerCase();
  const parsed = (() => {
    try {
      return parseToolName(tool.name);
    } catch {
      return undefined;
    }
  })();
  const moduleName = parsed?.moduleName?.toLowerCase() ?? '';
  const entryName = parsed?.entryName?.toLowerCase() ?? '';
  const suffix = parsed?.suffix?.toLowerCase() ?? '';

  let score = 0;
  for (const term of terms) {
    const t = term.toLowerCase();
    if (!t) continue;
    if (name === t) score += 100;
    if (entryName === t) score += 60;
    if (entryName.startsWith(t)) score += 25;
    if (entryName.includes(t)) score += 10;
    if (moduleName === t) score += 30;
    if (moduleName.includes(t)) score += 8;
    if (suffix === t) score += 20;
    if (desc.includes(t)) score += 5;
    if (name.includes(t)) score += 3;
  }
  return score;
}

function searchAvailableTools(
  query: string,
  limit: number,
  kind: 'any' | 'event' | 'entity',
  config?: Config
): { matches: { name: string; description: string; kind: 'event' | 'entity'; score: number }[] } {
  const terms = String(query ?? '')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const pool: ScoredTool[] = [];
  if (kind !== 'entity' && isExposeOn(config, 'events')) {
    listEventTools().forEach(t => pool.push({ tool: t, score: 0, kind: 'event' }));
  }
  if (kind !== 'event' && isExposeOn(config, 'entities')) {
    listEntityTools().forEach(t => pool.push({ tool: t, score: 0, kind: 'entity' }));
  }

  for (const p of pool) p.score = scoreTool(p.tool, p.kind, terms);
  const matches = pool
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, Math.min(Math.max(1, limit), 100))
    .map(p => ({
      name: p.tool.name,
      description: p.tool.description,
      kind: p.kind,
      score: p.score,
    }));
  return { matches };
}

function listEntityResources(): { uri: string; name: string; description: string }[] {
  const out: { uri: string; name: string; description: string }[] = [];
  getAllEntityNames().forEach((entityNames: string[], moduleName: string) => {
    entityNames.forEach((entityName: string) => {
      const fq = makeFqName(moduleName, entityName);
      out.push({
        uri: `agentlang://${moduleName}/${entityName}`,
        name: fq,
        description: `All records of ${fq}.`,
      });
    });
  });
  return out;
}

// Format a value for use in an agentlang query/mutation pattern.
function formatLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return `"${v.replace(/"/g, '\\"')}"`;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function buildAttrPattern(args: Record<string, unknown>, queryStyle: boolean): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const op = queryStyle ? '?' : '';
    return `${k}${op} ${formatLiteral(v)}`;
  });
  return `{${parts.join(', ')}}`;
}

async function callEventTool(
  moduleName: string,
  eventName: string,
  args: Record<string, unknown>
): Promise<Result> {
  const session = currentSession();
  const inst: Instance = makeInstance(
    moduleName,
    eventName,
    objectAsInstanceAttributes(args)
  ).setAuthContext(session);
  return evaluate(inst);
}

async function callEntityTool(
  moduleName: string,
  entityName: string,
  suffix: string,
  args: Record<string, unknown>
): Promise<Result> {
  const fq = makeFqName(moduleName, entityName);
  const session = currentSession();
  const userId = session.userId;
  let pattern: string;
  switch (suffix) {
    case 'create': {
      pattern = `{${fq} ${buildAttrPattern(args, false)}}`;
      break;
    }
    case 'list': {
      const hasFilter = Object.keys(args).length > 0;
      pattern = hasFilter ? `{${fq} ${buildAttrPattern(args, true)}}` : `{${fq}? {}}`;
      break;
    }
    case 'get': {
      const id = args.id;
      if (id === undefined) {
        throw new McpError(ErrorCode.InvalidParams, `Missing 'id' for ${fq}.get`);
      }
      pattern = `{${fq} {id? ${formatLiteral(id)}}}`;
      break;
    }
    case 'delete': {
      const id = args.id;
      if (id === undefined) {
        throw new McpError(ErrorCode.InvalidParams, `Missing 'id' for ${fq}.delete`);
      }
      pattern = `delete {${fq} {id? ${formatLiteral(id)}}}`;
      break;
    }
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown entity action: ${suffix}`);
  }
  return parseAndEvaluateStatement(pattern, userId);
}

function normalizeForJson(r: Result): any {
  if (r === null || r === undefined) return r;
  if (Array.isArray(r)) return r.map(normalizeForJson);
  if (Instance.IsInstance(r)) {
    r.mergeRelatedInstances();
    Array.from(r.attributes.keys()).forEach(k => {
      const v: Result = r.attributes.get(k);
      if (Array.isArray(v) || Instance.IsInstance(v)) {
        r.attributes.set(k, normalizeForJson(v));
      }
    });
    return r.asObject();
  }
  if (r instanceof Map) return Object.fromEntries(r.entries());
  return r;
}

function asTextContent(value: unknown): { type: 'text'; text: string } {
  return { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) };
}

function isExposeOn(config: Config | undefined, key: 'events' | 'entities' | 'resources'): boolean {
  const exp = config?.mcpServer?.expose;
  if (!exp) return true;
  return exp[key] !== false;
}

export type AgentlangMcp = {
  /**
   * Build a fresh MCP server bound to the agentlang runtime. Caller is
   * responsible for connecting it to a transport and closing it when done.
   * Used in stateless mode where each HTTP request gets its own server.
   */
  build: () => Server;
  /**
   * Long-lived shared MCP server. Used in stateful mode together with one
   * transport per session.
   */
  shared: Server;
  name: string;
  version: string;
};

function buildServer(name: string, version: string, config?: Config): Server {
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: ListedTool[] = [];
    tools.push(searchToolDef());
    if (isExposeOn(config, 'events')) tools.push(...listEventTools());
    if (isExposeOn(config, 'entities')) tools.push(...listEntityTools());
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name: toolName, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    try {
      if (toolName === SEARCH_TOOL_NAME) {
        const query = typeof args.query === 'string' ? args.query : '';
        const limit = typeof args.limit === 'number' ? args.limit : 20;
        const kind =
          args.kind === 'event' || args.kind === 'entity' || args.kind === 'any'
            ? args.kind
            : 'any';
        const result = searchAvailableTools(query, limit, kind, config);
        return { content: [asTextContent(result)] };
      }
      const { moduleName, entryName, suffix } = parseToolName(toolName);
      let result: Result;
      if (suffix) {
        if (!isExposeOn(config, 'entities')) {
          throw new McpError(ErrorCode.MethodNotFound, `Entity tools are disabled: ${toolName}`);
        }
        result = await callEntityTool(moduleName, entryName, suffix, args);
      } else {
        if (!isExposeOn(config, 'events')) {
          throw new McpError(ErrorCode.MethodNotFound, `Event tools are disabled: ${toolName}`);
        }
        result = await callEventTool(moduleName, entryName, args);
      }
      return { content: [asTextContent(normalizeForJson(result))] };
    } catch (err: any) {
      if (err instanceof McpError) throw err;
      logger.error(`MCP tool ${toolName} failed: ${err?.stack || err}`);
      return {
        isError: true,
        content: [asTextContent(err?.message || String(err))],
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (!isExposeOn(config, 'resources')) return { resources: [] };
    return { resources: listEntityResources() };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (!isExposeOn(config, 'resources')) {
      throw new McpError(ErrorCode.InvalidRequest, 'Resources are disabled');
    }
    const uri = request.params.uri;
    const m = /^agentlang:\/\/([^/]+)\/(.+)$/.exec(uri);
    if (!m) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI: ${uri}`);
    }
    const moduleName = m[1];
    const entityName = m[2];
    const fq = `${moduleName}/${entityName}`;
    const session = currentSession();
    const result = await parseAndEvaluateStatement(`{${fq}? {}}`, session.userId);
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(normalizeForJson(result), null, 2),
        },
      ],
    };
  });

  return server;
}

export function createMcpServer(appSpec: ApplicationSpec, config?: Config): AgentlangMcp {
  const cfg = config?.mcpServer;
  const name = cfg?.name ?? appSpec.name;
  const version = cfg?.version ?? appSpec.version ?? '0.0.0';
  const shared = buildServer(name, version, config);
  logger.info(
    `MCP server '${name}' v${version} ready (path=${cfg?.path ?? '/mcp'}, stateless=${cfg?.stateless !== false})`
  );
  return {
    build: () => buildServer(name, version, config),
    shared,
    name,
    version,
  };
}

export function newStatelessTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
}

export function newStatefulTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: () => globalThis.crypto.randomUUID(),
  });
}

// Internals exposed for unit testing only. Not part of the public API.
export const __test__ = {
  fqToolName,
  parseToolName,
  metaDescription,
  attributeToJsonSchema,
  jsonSchemaForType,
  recordToInputSchema,
  formatLiteral,
  buildAttrPattern,
  listEventTools,
  listEntityTools,
  listEntityResources,
  isExposeOn,
  searchToolDef,
  searchAvailableTools,
  scoreTool,
  SEARCH_TOOL_NAME,
};
