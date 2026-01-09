// Ref: https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x
import { Client } from '@modelcontextprotocol/sdk/client';
import {
  ClientCredentialsProvider,
  PrivateKeyJwtProvider,
} from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsRequest,
  ListToolsResultSchema,
  CallToolRequest,
  CallToolResultSchema,
  ListPromptsRequest,
  ListPromptsResultSchema,
  GetPromptRequest,
  GetPromptResultSchema,
  ListResourcesRequest,
  ListResourcesResultSchema,
  LoggingMessageNotificationSchema,
  ResourceListChangedNotificationSchema,
  ElicitRequestSchema,
  ReadResourceRequest,
  ReadResourceResultSchema,
  RELATED_TASK_META_KEY,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { getDisplayName } from '@modelcontextprotocol/sdk/shared/metadataUtils.js';
import { logger } from './logger.js';
import { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Instance } from './module.js';

export function createProvider(
  clientId: string,
  clientSecret?: string,
  privateKeyPem?: string
): OAuthClientProvider {
  if (privateKeyPem) {
    const algorithm = process.env.MCP_CLIENT_ALGORITHM || 'RS256';
    return new PrivateKeyJwtProvider({
      clientId,
      privateKey: privateKeyPem,
      algorithm,
    });
  }
  if (clientSecret) {
    return new ClientCredentialsProvider({
      clientId,
      clientSecret,
    });
  }
  throw Error(`Either clientSecret or privateKeyPem is required for client: ${clientId}`);
}

export type McpAuthInfo = {
  provider?: OAuthClientProvider;
  bearerToken?: string;
};

export type McpTool = {
  id: string;
  name: string;
  description: string;
  inputSchema: any;
};

export class McpClient {
  // Track received notifications for debugging resumability
  private notificationCount = 0;

  private name: string;
  private version: string = '1.0.0';
  private client: Client | undefined;
  private transport: StreamableHTTPClientTransport | undefined;
  private serverUrl: string; // e.g 'https://mcp.deepwiki.com/mcp'
  private notificationsToolLastEventId: string | undefined;
  private sessionId: string | undefined = undefined;

  constructor(name: string, serverUrl: string) {
    this.name = name;
    this.serverUrl = serverUrl;
  }

  public setVersion(v: string): McpClient {
    this.version = v;
    return this;
  }

  public async connect(authInfo?: McpAuthInfo): Promise<void> {
    if (this.client) {
      return;
    }
    logger.info(`Connecting to ${this.serverUrl}...`);

    try {
      // Create a new client with form elicitation capability
      this.client = new Client(
        {
          name: this.name,
          version: this.version,
        },
        {
          capabilities: {
            elicitation: {
              form: {},
            },
          },
        }
      );
      this.client.onerror = error => {
        throw new Error(`MCP Client ${this.name} error: ${error}`);
      };

      // Set up elicitation request handler with proper validation
      this.client.setRequestHandler(ElicitRequestSchema, async request => {
        if (request.params.mode !== 'form') {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Unsupported elicitation mode: ${request.params.mode}`
          );
        }
        const log = `MCP Client ${this.name} - Elicitation (form) Request Received:
                      Message: ${request.params.message}
                      Related Task: ${request.params._meta?.[RELATED_TASK_META_KEY]?.taskId}
                      Requested Schema:
                      ${JSON.stringify(request.params.requestedSchema, null, 2)}
                    Cancelling the request in non-interactive mode`;
        logger.debug(log);
        return { action: 'cancel' };
      });

      const transArgs: StreamableHTTPClientTransportOptions = {
        sessionId: this.sessionId,
      };
      if (authInfo?.provider) {
        transArgs.authProvider = authInfo.provider;
      } else if (authInfo?.bearerToken) {
        const customHeaders = {
          Authorization: `Bearer ${authInfo.bearerToken}`,
        };
        transArgs.requestInit = {
          headers: customHeaders,
        };
      }

      this.transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), transArgs);

      // Set up notification handlers
      this.client.setNotificationHandler(LoggingMessageNotificationSchema, notification => {
        this.notificationCount++;
        logger.debug(
          `MCP Client ${this.name} - Notification ${this.notificationCount}: ${notification.params.level} - ${notification.params.data}`
        );
      });

      this.client.setNotificationHandler(ResourceListChangedNotificationSchema, async _ => {
        logger.debug(`MCP Client ${this.name} - Resource list changed notification received!`);
        try {
          if (!this.client) {
            logger.warn(`MCP Client ${this.name} disconnected, cannot fetch resources`);
            return;
          }
          const resourcesResult = await this.client.request(
            {
              method: 'resources/list',
              params: {},
            },
            ListResourcesResultSchema
          );
          logger.debug(
            `MCP Client ${this.name} - Available resources count: ${resourcesResult.resources.length}`
          );
        } catch {
          logger.warn(
            `MCP Client ${this.name} - Failed to list resources after change notification`
          );
        }
      });

      // Connect the client
      await this.client.connect(this.transport);
      this.sessionId = this.transport.sessionId;
      logger.debug(
        `MCP Client ${this.name} - Transport created with session ID: ${this.sessionId}`
      );
      logger.debug(`MCP Client ${this.name} - Connected to MCP server ${this.serverUrl}`);
    } catch (error) {
      this.client = undefined;
      this.transport = undefined;
      throw new Error(`MCP Client ${this.name} - Failed to connect: ${error}`);
    }
  }

  public async disconnect(): Promise<boolean> {
    if (this.client === undefined || this.transport === undefined) {
      return false;
    }

    try {
      await this.transport.close();
      logger.debug(`MCP Client ${this.name} - Disconnected from MCP server`);
      this.client = undefined;
      this.transport = undefined;
      return true;
    } catch (error) {
      logger.warn(`MCP Client ${this.name} - Error disconnecting: ${error}`);
    }
    return false;
  }

  public async terminateSession(): Promise<boolean> {
    if (this.client === undefined || this.transport === undefined) {
      return false;
    }

    try {
      console.debug(
        `MCP Client ${this.name} - Terminating session with ID: ${this.transport.sessionId}`
      );
      await this.transport.terminateSession();
      // Check if sessionId was cleared after termination
      if (!this.transport.sessionId) {
        this.sessionId = undefined;

        // Also close the transport and clear client objects
        await this.disconnect();
        return true;
      } else {
        logger.warn(
          `MCP Client ${this.name} - Server responded with 405 Method Not Allowed (session termination not supported`
        );
      }
    } catch (error) {
      console.warn(`MCP Client ${this.name} - Error terminating session: ${error}`);
    }
    return false;
  }

  public async reconnect(): Promise<void> {
    if (this.client) {
      await this.disconnect();
    }
    await this.connect();
  }

  public async listTools(): Promise<McpTool[]> {
    if (!this.client) {
      return [];
    }

    try {
      const toolsRequest: ListToolsRequest = {
        method: 'tools/list',
        params: {},
      };
      const toolsResult = await this.client.request(toolsRequest, ListToolsResultSchema);

      if (toolsResult.tools.length === 0) {
        return [];
      } else {
        const result = new Array<McpTool>();
        for (const tool of toolsResult.tools) {
          result.push({
            id: tool.name,
            name: getDisplayName(tool),
            description: tool.description || '',
            inputSchema: tool.inputSchema,
          });
        }
        return result;
      }
    } catch (error) {
      throw new Error(`Tools not supported by this server ${this.serverUrl} - ${error}`);
    }
    return [];
  }

  public async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.client) {
      return undefined;
    }

    try {
      const request: CallToolRequest = {
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
      };
      return await this.client.request(request, CallToolResultSchema);
    } catch (error) {
      throw new Error(`MCP Client ${name} - Error calling tool ${name}: ${error}`);
    }
    return undefined;
  }

  public async callGreetTool(name: string): Promise<any> {
    return await this.callTool('greet', { name });
  }

  public async callMultiGreetTool(name: string): Promise<any> {
    return await this.callTool('multi-greet', { name });
  }

  public async callCollectInfoTool(infoType: string): Promise<any> {
    return await this.callTool('collect-user-info', { infoType });
  }

  public async startNotifications(interval: number, count: number): Promise<any> {
    return await this.callTool('start-notification-stream', { interval, count });
  }

  public async runNotificationsToolWithResumability(interval: number, count: number): Promise<any> {
    if (!this.client) {
      return undefined;
    }

    try {
      const request: CallToolRequest = {
        method: 'tools/call',
        params: {
          name: 'start-notification-stream',
          arguments: { interval, count },
        },
      };

      const onLastEventIdUpdate = (event: string) => {
        this.notificationsToolLastEventId = event;
        console.log(`Updated resumption token: ${event}`);
      };

      const result = await this.client.request(request, CallToolResultSchema, {
        resumptionToken: this.notificationsToolLastEventId,
        onresumptiontoken: onLastEventIdUpdate,
      });
      return result;
    } catch (error) {
      throw new Error(`MCP Client ${this.name} - Error starting notification stream: ${error}`);
    }
    return undefined;
  }

  public async listPrompts(): Promise<any> {
    if (!this.client) {
      return undefined;
    }

    try {
      const promptsRequest: ListPromptsRequest = {
        method: 'prompts/list',
        params: {},
      };
      return await this.client.request(promptsRequest, ListPromptsResultSchema);
    } catch (error) {
      throw new Error(`MCP Client ${this.name} - Prompts not supported by this server (${error})`);
    }
    return undefined;
  }

  public async getPrompt(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.client) {
      return undefined;
    }

    try {
      const promptRequest: GetPromptRequest = {
        method: 'prompts/get',
        params: {
          name,
          arguments: args as Record<string, string>,
        },
      };

      return await this.client.request(promptRequest, GetPromptResultSchema);
    } catch (error) {
      throw new Error(`MCP Client ${this.name} - Error getting prompt ${name}: ${error}`);
    }
    return undefined;
  }

  public async listResources(): Promise<any> {
    if (!this.client) {
      return undefined;
    }

    try {
      const resourcesRequest: ListResourcesRequest = {
        method: 'resources/list',
        params: {},
      };
      return await this.client.request(resourcesRequest, ListResourcesResultSchema);
    } catch (error) {
      throw new Error(
        `MCP Client ${this.name} - Resources not supported by this server (${error})`
      );
    }
    return undefined;
  }

  public async readResource(uri: string): Promise<any> {
    if (!this.client) {
      return undefined;
    }

    try {
      const request: ReadResourceRequest = {
        method: 'resources/read',
        params: { uri },
      };
      return await this.client.request(request, ReadResourceResultSchema);
    } catch (error) {
      throw new Error(`MCP Client ${this.name} - Error reading resource ${uri}: ${error}`);
    }
    return undefined;
  }

  public async callToolTask(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.client) {
      return undefined;
    }

    // Use task-based execution - call now, fetch later
    // Using the experimental tasks API - WARNING: may change without notice
    try {
      // Call the tool with task metadata using streaming API
      const stream = this.client.experimental.tasks.callToolStream(
        {
          name,
          arguments: args,
        },
        CallToolResultSchema,
        {
          task: {
            ttl: 60000, // Keep results for 60 seconds
          },
        }
      );
      for await (const message of stream) {
        switch (message.type) {
          case 'taskCreated':
            logger.info(
              `MCP Client ${this.name} - Task created successfully with ID: ${message.task.taskId}`
            );
            break;
          case 'taskStatus':
            logger.info(`MCP Client ${this.name} - Task status: ${message.task.status}`);
            break;
          case 'result':
            return message.result.content;
          case 'error':
            throw message.error;
        }
      }
    } catch (error) {
      throw new Error(`MCP Client ${this.name} - Error with task-based execution: ${error}`);
    }
    return undefined;
  }

  public async cleanup(): Promise<boolean> {
    if (this.client && this.transport) {
      try {
        // First try to terminate the session gracefully
        if (this.transport.sessionId) {
          try {
            await this.transport.terminateSession();
          } catch (error) {
            logger.warn(`MCP Client ${this.name} - Error terminating session: ${error}`);
          }
        }

        // Then close the transport
        await this.transport.close();
        return true;
      } catch (error) {
        logger.warn(`MCP Client ${this.name} - Error closing transport:, ${error}`);
      }
    }
    return false;
  }
}

const ConnectedClients = new Map<string, McpClient>()

export async function listClientTools(clientInst: Instance): Promise<any> {
  if (clientInst) {
    const n = clientInst.lookup('name')
    let mcpClient: McpClient | undefined = ConnectedClients.get(n)
    if (mcpClient === undefined) {
      mcpClient = new McpClient(n, clientInst.lookup('serverUrl')).setVersion(clientInst.lookup('version'))
      let authInfo: McpAuthInfo | undefined
      const clientId = clientInst.lookup('clientId')
      const clientSecret = clientInst.lookup('clientSecret')
      if (clientId && clientSecret) {
        authInfo = {provider: createProvider(clientId, clientSecret)}
      } else {
        const bearerToken = clientInst.lookup('bearerToken')
        authInfo = {bearerToken}
      }
      await mcpClient.connect(authInfo)
      ConnectedClients.set(n, mcpClient)
    }
    return await mcpClient.listTools()
  }
}
