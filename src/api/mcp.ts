// Exposes agentlang events as tools of a Model Context Protocol (MCP) server.
// Ref: https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { Express, Request, Response } from 'express';
import {
  AttributeSpec,
  Event,
  fetchModule,
  getAllEventNames,
  getAttributeDefaultValue,
  getEnumValues,
  getUserModuleNames,
  isArrayAttribute,
  isOptionalAttribute,
  makeInstance,
  objectAsInstanceAttributes,
} from '../runtime/module.js';
import { evaluate } from '../runtime/interpreter.js';
import { isNoSession } from '../runtime/auth/defs.js';
import { getErrorCode, resolveEntityErrorMessage } from '../runtime/errors/http-error.js';
import { logger } from '../runtime/logger.js';
import { Config } from '../runtime/state.js';
import { makeFqName } from '../runtime/util.js';
import { normalizedResult, verifyAuth } from './common.js';

export type McpServerConfig = NonNullable<Config['mcpServer']>;

// `@meta {"mcp": true}` exposes an event as a tool, `@meta {"mcp": false}` hides it.
const McpMetaKey = 'mcp';
const DocumentationMetaKey = 'documentation';

export type McpToolEntry = {
  tool: Tool;
  moduleName: string;
  eventName: string;
};

type JsonSchema = { [key: string]: any };

const StringFormats: { [type: string]: string } = {
  Email: 'email',
  Date: 'date',
  Time: 'time',
  DateTime: 'date-time',
  UUID: 'uuid',
  URL: 'uri',
};

function baseTypeSchema(type: string): JsonSchema {
  switch (type) {
    case 'String':
    case 'Path':
    case 'Password':
      return { type: 'string' };
    case 'Email':
    case 'Date':
    case 'Time':
    case 'DateTime':
    case 'UUID':
    case 'URL':
      return { type: 'string', format: StringFormats[type] };
    case 'Int':
      return { type: 'integer' };
    case 'Number':
    case 'Float':
    case 'Decimal':
      return { type: 'number' };
    case 'Boolean':
      return { type: 'boolean' };
    case 'Map':
      return { type: 'object' };
    case 'Any':
      return {};
    default:
      // A user-defined record or entity type.
      return { type: 'object', description: `An instance of ${type}` };
  }
}

function isLiteralDefault(v: any): boolean {
  if (typeof v === 'string') return !v.endsWith('()');
  return typeof v === 'number' || typeof v === 'boolean';
}

export function attributeToJsonSchema(attrSpec: AttributeSpec): JsonSchema {
  const enumValues = getEnumValues(attrSpec);
  let schema: JsonSchema = enumValues
    ? { type: 'string', enum: Array.from(enumValues) }
    : baseTypeSchema(attrSpec.type);
  if (isArrayAttribute(attrSpec)) {
    schema = { type: 'array', items: schema };
  }
  const deflt = getAttributeDefaultValue(attrSpec);
  if (deflt !== undefined && isLiteralDefault(deflt)) {
    schema.default = deflt;
  }
  return schema;
}

function isRequiredAttribute(attrSpec: AttributeSpec): boolean {
  return (
    !isOptionalAttribute(attrSpec) &&
    getAttributeDefaultValue(attrSpec) === undefined &&
    attrSpec.properties?.get('expr') === undefined
  );
}

function isSystemAttribute(attrSpec: AttributeSpec): boolean {
  return attrSpec.properties?.get('system-attribute') == true;
}

export function eventInputSchema(event: Event): Tool['inputSchema'] {
  const properties: JsonSchema = {};
  const required: string[] = [];
  event.schema.forEach((attrSpec: AttributeSpec, n: string) => {
    if (isSystemAttribute(attrSpec)) return;
    properties[n] = attributeToJsonSchema(attrSpec);
    if (isRequiredAttribute(attrSpec)) required.push(n);
  });
  const schema: Tool['inputSchema'] = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

// MCP tool names are restricted to [A-Za-z0-9_-], so `acme.core/CreateUser`
// becomes `acme_core_CreateUser`.
export function toolNameFor(moduleName: string, eventName: string): string {
  return `${moduleName}_${eventName}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

function isExposed(event: Event, fqName: string, isUserModule: boolean, cfg: McpServerConfig) {
  if (cfg.exclude?.includes(fqName)) return false;
  if (cfg.include?.includes(fqName)) return true;
  if (!isUserModule) return false;
  const flag = event.getMeta(McpMetaKey);
  if (flag === true || flag === 'true') return true;
  if (flag === false || flag === 'false') return false;
  return cfg.expose === 'public';
}

export function collectMcpTools(cfg: McpServerConfig): Map<string, McpToolEntry> {
  const tools = new Map<string, McpToolEntry>();
  const userModules = new Set(getUserModuleNames());
  getAllEventNames().forEach((eventNames: string[], moduleName: string) => {
    const module = fetchModule(moduleName);
    eventNames.forEach((eventName: string) => {
      const entry = module.getEntry(eventName);
      if (!(entry instanceof Event)) return;
      // System events (agents, imported MCP client tools) are never re-exported.
      if (!entry.isPublic() || entry.isSystemDefined() || entry.isMcpTool()) return;
      const fqName = makeFqName(moduleName, eventName);
      if (!isExposed(entry, fqName, userModules.has(moduleName), cfg)) return;
      const name = toolNameFor(moduleName, eventName);
      if (tools.has(name)) {
        logger.warn(`MCP tool name ${name} for ${fqName} is already in use, skipping`);
        return;
      }
      const doc = entry.getMeta(DocumentationMetaKey);
      tools.set(name, {
        moduleName,
        eventName,
        tool: {
          name,
          title: fqName,
          description: typeof doc === 'string' && doc.trim() ? doc.trim() : `Invokes ${fqName}`,
          inputSchema: eventInputSchema(entry),
        },
      });
    });
  });
  return tools;
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

async function callTool(
  entry: McpToolEntry,
  args: { [key: string]: unknown } | undefined,
  authorization: string | undefined
): Promise<CallToolResult> {
  const { moduleName, eventName } = entry;
  try {
    const sessionInfo = await verifyAuth(moduleName, eventName, authorization);
    if (isNoSession(sessionInfo)) {
      return errorResult('Authorization required');
    }
    const inst = makeInstance(
      moduleName,
      eventName,
      objectAsInstanceAttributes(args)
    ).setAuthContext(sessionInfo);
    const result = normalizedResult(await evaluate(inst));
    return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
  } catch (err: any) {
    const code = getErrorCode(err);
    const defaultMsg = err instanceof Error ? err.message : String(err);
    const message = await resolveEntityErrorMessage(moduleName, eventName, code, defaultMsg);
    logger.warn(`MCP tool ${entry.tool.name} failed: ${code} - ${message}`);
    return errorResult(message);
  }
}

export function createMcpServer(
  name: string,
  version: string,
  cfg: McpServerConfig,
  authorization: string | undefined
): Server {
  const server = new Server({ name, version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: Array.from(collectMcpTools(cfg).values()).map(e => e.tool) };
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const entry = collectMcpTools(cfg).get(request.params.name);
    if (entry === undefined) {
      return errorResult(`Unknown tool: ${request.params.name}`);
    }
    return await callTool(entry, request.params.arguments, authorization);
  });
  return server;
}

function methodNotAllowed(_req: Request, res: Response) {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  });
}

// Mounts a stateless Streamable HTTP MCP endpoint. The caller's Authorization header
// is checked per tool call, exactly like the event's REST endpoint.
export function mountMcpServer(app: Express, name: string, version: string, cfg: McpServerConfig) {
  app.post(cfg.path, async (req: Request, res: Response) => {
    const server = createMcpServer(name, version, cfg, req.headers.authorization);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      logger.error(`MCP request failed: ${err}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });
  app.get(cfg.path, methodNotAllowed);
  app.delete(cfg.path, methodNotAllowed);
  logger.info(`MCP server enabled at ${cfg.path}`);
}

// Serves MCP over stdin/stdout. Tool calls authenticate with AGENTLANG_MCP_TOKEN.
export async function startMcpStdioServer(name: string, version: string, cfg: McpServerConfig) {
  const token = process.env.AGENTLANG_MCP_TOKEN;
  const server = createMcpServer(name, version, cfg, token ? `Bearer ${token}` : undefined);
  await server.connect(new StdioServerTransport());
  logger.info('MCP server listening on stdio');
}
