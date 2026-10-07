import { assert, describe, test, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../../src/api/http.js';
import { collectMcpTools, McpServerConfig, toolNameFor } from '../../src/api/mcp.js';
import { doInternModule } from '../util.js';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

let server: Server;
let baseUrl: string;

const annotated: McpServerConfig = { enabled: true, path: '/mcp', expose: 'annotated' };

beforeAll(async () => {
  await doInternModule(
    'McpT',
    `entity Task {
      id Int @id,
      title String,
      status @enum("Open", "Done") @default("Open"),
      tags String[] @optional
    }

    @public event CreateTask {
      id Int,
      title String,
      tags String[] @optional,
      @meta {"mcp": true, "documentation": "Creates a task. Status starts as Open."}
    }

    workflow CreateTask {
      {Task {id CreateTask.id, title CreateTask.title, tags CreateTask.tags}}
    }

    @public event FindTask {
      id Int,
      @meta {"mcp": true}
    }

    workflow FindTask {
      {Task {id? FindTask.id}}
    }

    @public event Unannotated {
      x Int
    }

    workflow Unannotated {
      Unannotated.x
    }

    @public event Hidden {
      x Int,
      @meta {"mcp": false}
    }

    workflow Hidden {
      Hidden.x
    }

    event Private {
      x Int,
      @meta {"mcp": true}
    }

    workflow Private {
      Private.x
    }`
  );
  const app = await createApp({ name: 'mcp-test-app', version: '0.0.1' }, {
    mcpServer: annotated,
  } as any);
  server = app.listen(0);
  const addr = server.address() as AddressInfo;
  baseUrl = `http://localhost:${addr.port}`;
});

afterAll(() => {
  server?.close();
});

async function connectClient(): Promise<Client> {
  const client = new Client({ name: 'mcp-test-client', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
  return client;
}

describe('MCP tool collection', () => {
  test('annotated mode exposes only public events tagged @meta {"mcp": true}', () => {
    const names = Array.from(collectMcpTools(annotated).keys()).sort();
    assert.deepEqual(names, ['McpT_CreateTask', 'McpT_FindTask']);
  });

  test('public mode exposes all public user events except @meta {"mcp": false}', () => {
    const names = Array.from(collectMcpTools({ ...annotated, expose: 'public' }).keys()).sort();
    assert.deepEqual(names, ['McpT_CreateTask', 'McpT_FindTask', 'McpT_Unannotated']);
  });

  test('include and exclude override annotations', () => {
    const names = Array.from(
      collectMcpTools({ ...annotated, include: ['McpT/Hidden'], exclude: ['McpT/FindTask'] }).keys()
    ).sort();
    assert.deepEqual(names, ['McpT_CreateTask', 'McpT_Hidden']);
  });

  test('tool description and input schema come from the event definition', () => {
    const tool = collectMcpTools(annotated).get('McpT_CreateTask')!.tool;
    assert.equal(tool.title, 'McpT/CreateTask');
    assert.equal(tool.description, 'Creates a task. Status starts as Open.');
    assert.deepEqual(tool.inputSchema, {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'title'],
    });
  });

  test('tool names are sanitized for MCP', () => {
    assert.equal(toolNameFor('acme.core', 'CreateUser'), 'acme_core_CreateUser');
  });
});

describe('MCP over Streamable HTTP', () => {
  test('tools/list returns the exposed events', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['McpT_CreateTask', 'McpT_FindTask']);
    await client.close();
  });

  test('tools/call evaluates the event and returns its result', async () => {
    const client = await connectClient();
    const created: any = await client.callTool({
      name: 'McpT_CreateTask',
      arguments: { id: 1, title: 'Write MCP docs', tags: ['docs'] },
    });
    assert(!created.isError, JSON.stringify(created.content));
    const task = JSON.parse(created.content[0].text);
    assert.equal(task.Task.title, 'Write MCP docs');
    assert.equal(task.Task.status, 'Open');

    const found: any = await client.callTool({ name: 'McpT_FindTask', arguments: { id: 1 } });
    assert(!found.isError, JSON.stringify(found.content));
    const tasks = JSON.parse(found.content[0].text);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].Task.id, 1);
    await client.close();
  });

  test('tools/call on an unexposed event is rejected', async () => {
    const client = await connectClient();
    const res: any = await client.callTool({ name: 'McpT_Unannotated', arguments: { x: 1 } });
    assert(res.isError);
    assert.match(res.content[0].text, /Unknown tool/);
    await client.close();
  });

  test('workflow errors are returned as tool errors', async () => {
    const client = await connectClient();
    const res: any = await client.callTool({
      name: 'McpT_CreateTask',
      arguments: { id: 1, title: 'Duplicate id' },
    });
    assert(res.isError);
    assert(res.content[0].text.length > 0);
    await client.close();
  });

  test('GET on the MCP endpoint is not allowed in stateless mode', async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    assert.equal(res.status, 405);
  });
});
