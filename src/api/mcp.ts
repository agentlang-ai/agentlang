import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Express, Request, Response } from 'express';
import { setMcpEndpointsUpdater } from '../runtime/defs.js';
import { isNoSession } from '../runtime/auth/defs.js';
import { logger } from '../runtime/logger.js';
import type { Config } from '../runtime/state.js';
import type { ApplicationSpec } from '../runtime/loader.js';
import {
  evaluateEvent,
  queryEntity,
  getExposedEvents,
  getExposedEntities,
  recordSchemaToJsonSchema,
  verifyAuth,
} from './handlers.js';

type ToolEntry = {
  name: string;
  description: string;
  inputSchema: any;
  moduleName: string;
  eventName: string;
};

type ResourceEntry = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  moduleName: string;
  entityName: string;
};

type ResourceTemplateEntry = {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
  moduleName: string;
  entityName: string;
};

function buildTools(): ToolEntry[] {
  const tools: ToolEntry[] = [];
  for (const ep of getExposedEvents()) {
    const inputSchema = recordSchemaToJsonSchema(ep.schema);
    tools.push({
      name: `${ep.moduleName}/${ep.name}`,
      description: ep.description || `Invoke event ${ep.moduleName}/${ep.name}`,
      inputSchema,
      moduleName: ep.moduleName,
      eventName: ep.name,
    });
  }
  return tools;
}

function buildResources(uriScheme: string): ResourceEntry[] {
  const resources: ResourceEntry[] = [];
  for (const ep of getExposedEntities()) {
    resources.push({
      uri: `${uriScheme}://${ep.moduleName}/${ep.name}`,
      name: `${ep.moduleName}/${ep.name}`,
      description: ep.description || `Query all ${ep.moduleName}/${ep.name} entities`,
      mimeType: 'application/json',
      moduleName: ep.moduleName,
      entityName: ep.name,
    });
  }
  return resources;
}

function buildResourceTemplates(uriScheme: string): ResourceTemplateEntry[] {
  const templates: ResourceTemplateEntry[] = [];
  for (const ep of getExposedEntities()) {
    templates.push({
      uriTemplate: `${uriScheme}://${ep.moduleName}/${ep.name}/{id}`,
      name: `${ep.moduleName}/${ep.name} by ID`,
      description: ep.description || `Query a single ${ep.moduleName}/${ep.name} entity by ID`,
      mimeType: 'application/json',
      moduleName: ep.moduleName,
      entityName: ep.name,
    });
  }
  return templates;
}

/**
 * Extracts the bearer token string from the MCP SDK's extra.authInfo,
 * and reconstructs it as a Bearer header value for verifyAuth.
 */
function authHeaderFromExtra(extra: { authInfo?: { token: string } }): string | undefined {
  if (extra.authInfo?.token) {
    return `Bearer ${extra.authInfo.token}`;
  }
  return undefined;
}

export async function mountMcpServer(
  app: Express,
  config: Config,
  appSpec: ApplicationSpec
): Promise<void> {
  const mcpConfig = config.mcp!;
  const serverName = mcpConfig.name || appSpec.name;
  const serverVersion = mcpConfig.version || appSpec.version;
  const mcpPath = mcpConfig.path || '/mcp';
  const uriScheme = mcpConfig.uriScheme || appSpec.name;

  let tools = buildTools();
  let resources = buildResources(uriScheme);
  let resourceTemplates = buildResourceTemplates(uriScheme);

  const server = new Server(
    { name: serverName, version: serverVersion },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
      },
      ...(mcpConfig.instructions ? { instructions: mcpConfig.instructions } : {}),
    }
  );

  // --- Tool handlers ---

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    // Global auth check (like the /meta endpoint)
    const sessionInfo = await verifyAuth('', '', authHeaderFromExtra(extra));
    if (isNoSession(sessionInfo)) {
      throw new Error('Authorization required');
    }
    return {
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }
    // Per-tool auth: use the tool's module/event for auth check
    const sessionInfo = await verifyAuth(
      tool.moduleName,
      tool.eventName,
      authHeaderFromExtra(extra)
    );
    if (isNoSession(sessionInfo)) {
      return {
        content: [{ type: 'text' as const, text: 'Authorization required' }],
        isError: true,
      };
    }
    try {
      const result = await evaluateEvent(
        tool.moduleName,
        tool.eventName,
        request.params.arguments || {},
        sessionInfo
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: err.message || String(err) }],
        isError: true,
      };
    }
  });

  // --- Resource handlers ---

  server.setRequestHandler(ListResourcesRequestSchema, async (_request, extra) => {
    // Global auth check
    const sessionInfo = await verifyAuth('', '', authHeaderFromExtra(extra));
    if (isNoSession(sessionInfo)) {
      throw new Error('Authorization required');
    }
    return {
      resources: resources.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_request, extra) => {
    // Global auth check
    const sessionInfo = await verifyAuth('', '', authHeaderFromExtra(extra));
    if (isNoSession(sessionInfo)) {
      throw new Error('Authorization required');
    }
    return {
      resourceTemplates: resourceTemplates.map(t => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
    const uri = request.params.uri;

    // First try static resources (existing behavior)
    const resource = resources.find(r => r.uri === uri);
    if (resource) {
      // Per-resource auth: use the resource's module/entity for auth check
      const sessionInfo = await verifyAuth(
        resource.moduleName,
        resource.entityName,
        authHeaderFromExtra(extra)
      );
      if (isNoSession(sessionInfo)) {
        throw new Error('Authorization required');
      }
      try {
        const result = await queryEntity(
          resource.moduleName,
          resource.entityName,
          undefined,
          sessionInfo
        );
        return {
          contents: [
            {
              uri: resource.uri,
              mimeType: 'application/json',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        throw new Error(`Failed to read resource ${uri}: ${err.message}`);
      }
    }

    // Try matching resource template URIs: {scheme}://{module}/{entity}/{id}
    const parsed = new URL(uri);
    const moduleName = parsed.hostname;
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    if (pathSegments.length === 2) {
      const [entityName, id] = pathSegments;
      const template = resourceTemplates.find(
        t => t.moduleName === moduleName && t.entityName === entityName
      );
      if (template) {
        const sessionInfo = await verifyAuth(
          moduleName,
          entityName,
          authHeaderFromExtra(extra)
        );
        if (isNoSession(sessionInfo)) {
          throw new Error('Authorization required');
        }
        try {
          const path = `${moduleName}/${entityName}/${id}`;
          const result = await queryEntity(
            moduleName,
            entityName,
            undefined,
            sessionInfo,
            path
          );
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err: any) {
          throw new Error(`Failed to read resource ${uri}: ${err.message}`);
        }
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // --- Dynamic endpoint updates ---

  setMcpEndpointsUpdater((_moduleName: string) => {
    tools = buildTools();
    resources = buildResources(uriScheme);
    resourceTemplates = buildResourceTemplates(uriScheme);
    server.sendToolListChanged().catch(() => {});
    server.sendResourceListChanged().catch(() => {});
  });

  // --- Transport: per-session management ---

  const transports = new Map<string, StreamableHTTPServerTransport>();

  /**
   * Sets req.auth on the Express request so the StreamableHTTPServerTransport
   * picks it up and passes it as extra.authInfo to MCP request handlers.
   */
  function attachAuthToRequest(req: Request): void {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : authHeader.trim();
      (req as any).auth = { token, clientId: '', scopes: [] };
    }
  }

  const isStateless = mcpConfig.stateless === true;
  const enableJsonResponse = mcpConfig.enableJsonResponse === true;

  // --- Stale session cleanup ---

  const sessionActivity = new Map<string, number>();
  const sessionTtl = mcpConfig.sessionTtl!;
  let cleanupTimer: ReturnType<typeof setInterval> | undefined;

  function touchSession(sessionId: string): void {
    sessionActivity.set(sessionId, Date.now());
  }

  function removeSession(sessionId: string): void {
    sessionActivity.delete(sessionId);
    transports.delete(sessionId);
  }

  if (!isStateless) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [sessionId, lastActivity] of sessionActivity) {
        if (now - lastActivity > sessionTtl) {
          const transport = transports.get(sessionId);
          if (transport) {
            transport.close().catch(() => {});
          }
          removeSession(sessionId);
          logger.debug(`MCP: cleaned up stale session ${sessionId}`);
        }
      }
    }, sessionTtl / 2);
    // Allow the process to exit even if the timer is running
    cleanupTimer.unref();
  }

  server.onclose = () => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = undefined;
    }
  };

  app.post(mcpPath, async (req: Request, res: Response) => {
    try {
      attachAuthToRequest(req);
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!isStateless && sessionId && transports.has(sessionId)) {
        touchSession(sessionId);
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
      } else if (isStateless || !sessionId) {
        // New session (or stateless mode) — create transport
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: isStateless ? undefined : () => crypto.randomUUID(),
          enableJsonResponse,
        });
        if (!isStateless) {
          transport.onclose = () => {
            if (transport.sessionId) {
              removeSession(transport.sessionId);
            }
          };
        }
        await server.connect(transport);
        if (!isStateless && transport.sessionId) {
          transports.set(transport.sessionId, transport);
          touchSession(transport.sessionId);
        }
        await transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No transport found for the given session ID' },
          id: null,
        });
      }
    } catch (err: any) {
      logger.error(`MCP POST error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get(mcpPath, async (req: Request, res: Response) => {
    attachAuthToRequest(req);
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      touchSession(sessionId);
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No transport found for the given session ID' },
        id: null,
      });
    }
  });

  app.delete(mcpPath, async (req: Request, res: Response) => {
    attachAuthToRequest(req);
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      removeSession(sessionId);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No transport found for the given session ID' },
        id: null,
      });
    }
  });

  logger.info(`MCP server mounted at ${mcpPath} (name: ${serverName}, version: ${serverVersion})`);
}
