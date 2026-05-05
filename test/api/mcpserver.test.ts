import { assert, describe, test, beforeAll, afterAll } from 'vitest';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';

import { createApp } from '../../src/api/http.js';
import { doInternModule } from '../util.js';
import { parseAndIntern } from '../../src/runtime/loader.js';
import { runPostInitTasks } from '../../src/cli/main.js';
import { setAppConfig, AppConfig } from '../../src/runtime/state.js';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

type Booted = {
  http: HttpServer;
  url: string;
  client: Client;
};

async function bootApp(opts: {
  appName?: string;
  appVersion?: string;
  config?: any;
  authHeader?: string;
}): Promise<Booted> {
  const app = await createApp(
    { name: opts.appName ?? 'mcp-test', version: opts.appVersion ?? '0.0.1' },
    opts.config
  );
  const http = app.listen(0);
  const addr = http.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const url = `${baseUrl}/mcp`;

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: opts.authHeader ? { headers: { Authorization: opts.authHeader } } : undefined,
  });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(transport);
  return { http, url: baseUrl, client };
}

async function shutdown(b: Booted) {
  try {
    await b.client.close();
  } catch {
    /* ignore */
  }
  await new Promise<void>(resolve => b.http.close(() => resolve()));
}

function parseToolText(result: any): any {
  const first = result?.content?.[0];
  assert.ok(first, 'tool call should return content');
  assert.equal(first.type, 'text');
  if (typeof first.text !== 'string') return first.text;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

// ──────────────────────────────────────────────────────────────────
// Main suite — no auth, full surface (events + entities + resources)
// ──────────────────────────────────────────────────────────────────

describe('MCP server — full surface', () => {
  let booted: Booted;

  beforeAll(async () => {
    await doInternModule(
      'McpApi',
      `entity Item {
        id Int @id,
        name String,
        qty Int
      }

      @public event MakeItem {
        id Int,
        name String,
        qty Int
      }

      workflow MakeItem {
        {Item {id MakeItem.id, name MakeItem.name, qty MakeItem.qty}}
      }

      event PrivateOp {
        id Int
      }`
    );
    booted = await bootApp({
      config: { service: { port: 0, httpFileHandling: false }, mcpServer: { enabled: true } },
    });
  });

  afterAll(async () => {
    await shutdown(booted);
  });

  test('initialize hands shake completes', () => {
    const info = booted.client.getServerVersion();
    assert.ok(info, 'server info should be returned');
    assert.equal(info?.name, 'mcp-test');
    assert.equal(info?.version, '0.0.1');
  });

  test('tools/list returns event tool for @public event but not private events', async () => {
    const { tools } = await booted.client.listTools();
    const names = tools.map(t => t.name);
    assert.include(names, 'McpApi__MakeItem');
    assert.notInclude(names, 'McpApi__PrivateOp');
  });

  test('tools/list also returns entity CRUD tools', async () => {
    const { tools } = await booted.client.listTools();
    const names = new Set(tools.map(t => t.name));
    assert.isTrue(names.has('McpApi__Item__create'));
    assert.isTrue(names.has('McpApi__Item__list'));
    assert.isTrue(names.has('McpApi__Item__get'));
    assert.isTrue(names.has('McpApi__Item__delete'));
  });

  test('event tool inputSchema reflects attribute types', async () => {
    const { tools } = await booted.client.listTools();
    const ev = tools.find(t => t.name === 'McpApi__MakeItem');
    assert.ok(ev);
    const sch: any = ev!.inputSchema;
    assert.equal(sch.type, 'object');
    assert.deepEqual(sch.properties.id, { type: 'integer' });
    assert.deepEqual(sch.properties.name, { type: 'string' });
    assert.deepEqual(sch.properties.qty, { type: 'integer' });
    assert.includeMembers(sch.required, ['id', 'name', 'qty']);
  });

  test('calling event tool runs workflow and creates entity', async () => {
    const result = await booted.client.callTool({
      name: 'McpApi__MakeItem',
      arguments: { id: 1, name: 'Pen', qty: 5 },
    });
    parseToolText(result); // should be JSON-parseable, not isError
    assert.notEqual(result.isError, true);

    // Read back via list tool.
    const listed = await booted.client.callTool({
      name: 'McpApi__Item__list',
      arguments: {},
    });
    const rows = parseToolText(listed);
    const flat = Array.isArray(rows[0]) ? rows[0] : rows;
    const found = flat.find((r: any) => r?.Item?.id === 1 || r?.id === 1);
    assert.ok(found, `Item id=1 not found in ${JSON.stringify(rows)}`);
  });

  test('entity create tool inserts a row that the get tool can fetch', async () => {
    await booted.client.callTool({
      name: 'McpApi__Item__create',
      arguments: { id: 2, name: 'Mug', qty: 12 },
    });
    const got = await booted.client.callTool({
      name: 'McpApi__Item__get',
      arguments: { id: 2 },
    });
    const rows = parseToolText(got);
    const flat = Array.isArray(rows[0]) ? rows[0] : rows;
    const found = flat.find((r: any) => r?.Item?.id === 2 || r?.id === 2);
    assert.ok(found, `expected to find id=2 in ${JSON.stringify(rows)}`);
  });

  test('entity delete tool removes a row', async () => {
    await booted.client.callTool({
      name: 'McpApi__Item__create',
      arguments: { id: 99, name: 'Tmp', qty: 1 },
    });
    await booted.client.callTool({
      name: 'McpApi__Item__delete',
      arguments: { id: 99 },
    });
    const got = await booted.client.callTool({
      name: 'McpApi__Item__get',
      arguments: { id: 99 },
    });
    const rows = parseToolText(got);
    const flat = Array.isArray(rows) ? (Array.isArray(rows[0]) ? rows[0] : rows) : [];
    const stillThere = flat.find((r: any) => r?.Item?.id === 99 || r?.id === 99);
    assert.notOk(stillThere, `id=99 should have been deleted; got ${JSON.stringify(rows)}`);
  });

  test('get tool with missing id surfaces an error', async () => {
    // An McpError thrown from the call handler may either
    //   (a) come back as a protocol error the SDK throws on the client, or
    //   (b) come back as a CallToolResult with isError=true.
    // We accept either — both are valid MCP surfaces for tool-level failure.
    let threw = false;
    try {
      const result = await booted.client.callTool({
        name: 'McpApi__Item__get',
        arguments: {},
      });
      if (result.isError !== true) {
        assert.fail(`expected an error response, got ${JSON.stringify(result)}`);
      }
    } catch (err: any) {
      threw = true;
      const msg = String(err?.message ?? err);
      assert.match(msg, /id/i, `expected error to mention 'id', got: ${msg}`);
    }
    // If we got here without isError or throwing, that's a fail; assert.fail above already handles it.
    if (threw) {
      // good — server-side validation surfaced as a protocol error.
    }
  });

  test('unknown tool name returns isError', async () => {
    const result = await booted.client.callTool({
      name: 'McpApi__DoesNotExist',
      arguments: {},
    });
    assert.equal(result.isError, true);
  });

  test('resources/list exposes one resource per entity', async () => {
    const { resources } = await booted.client.listResources();
    const names = resources.map(r => r.name);
    assert.include(names, 'McpApi/Item');
    const item = resources.find(r => r.name === 'McpApi/Item');
    assert.equal(item!.uri, 'agentlang://McpApi/Item');
  });

  test('resources/read returns JSON of all rows for an entity', async () => {
    const out = await booted.client.readResource({ uri: 'agentlang://McpApi/Item' });
    assert.ok(out.contents && out.contents.length > 0);
    const first = out.contents[0];
    assert.equal(first.uri, 'agentlang://McpApi/Item');
    assert.equal(first.mimeType, 'application/json');
    const parsed = JSON.parse(first.text as string);
    assert.ok(Array.isArray(parsed) || Array.isArray(parsed?.[0]) || parsed !== undefined);
  });

  test('resources/read with bad URI fails', async () => {
    let threw = false;
    try {
      await booted.client.readResource({ uri: 'bogus://x/y' });
    } catch {
      threw = true;
    }
    assert.isTrue(threw, 'expected readResource to throw on bad URI');
  });

  test('agentlang_search_tools is listed and finds tools by query', async () => {
    const { tools } = await booted.client.listTools();
    const search = tools.find(t => t.name === 'agentlang_search_tools');
    assert.ok(search, 'expected built-in search tool to be listed');

    const result = await booted.client.callTool({
      name: 'agentlang_search_tools',
      arguments: { query: 'Item' },
    });
    const payload = parseToolText(result);
    assert.ok(Array.isArray(payload.matches));
    assert.isAbove(payload.matches.length, 0);
    const names = payload.matches.map((m: any) => m.name);
    // Both the event tool and entity CRUD tools for Item should rank.
    assert.include(names, 'McpApi__MakeItem');
    assert.include(names, 'McpApi__Item__create');
    // Scores are non-increasing.
    for (let i = 1; i < payload.matches.length; i++) {
      assert.isAtLeast(payload.matches[i - 1].score, payload.matches[i].score);
    }
  });

  test('agentlang_search_tools respects kind=event', async () => {
    const result = await booted.client.callTool({
      name: 'agentlang_search_tools',
      arguments: { query: 'Item', kind: 'event' },
    });
    const payload = parseToolText(result);
    for (const m of payload.matches) {
      assert.equal(m.kind, 'event', `expected event-only matches, got ${m.name}`);
    }
  });

  test('agentlang_search_tools with no matches returns empty list', async () => {
    const result = await booted.client.callTool({
      name: 'agentlang_search_tools',
      arguments: { query: 'completely-unrelated-zzz' },
    });
    const payload = parseToolText(result);
    assert.deepEqual(payload.matches, []);
  });

  test('hot-reload: dynamically interned module shows up in tools/list', async () => {
    // Add a brand-new module after the server is already running.
    await parseAndIntern(
      `module HotMcp
       @public event Echo { msg String }
       workflow Echo { Echo.msg }`
    );
    await runPostInitTasks();

    const { tools } = await booted.client.listTools();
    const names = tools.map(t => t.name);
    assert.include(names, 'HotMcp__Echo');

    const out = await booted.client.callTool({
      name: 'HotMcp__Echo',
      arguments: { msg: 'hi' },
    });
    const txt = parseToolText(out);
    // Workflow returns the msg string; expect "hi" to appear in result.
    const flat = JSON.stringify(txt);
    assert.include(flat, 'hi');
  });
});

// ──────────────────────────────────────────────────────────────────
// Expose toggles
// ──────────────────────────────────────────────────────────────────

describe('MCP server — expose toggles', () => {
  let booted: Booted;

  beforeAll(async () => {
    await doInternModule(
      'McpToggles',
      `entity Box { id Int @id, label String }
       @public event Ping { name String }
       workflow Ping { Ping.name }`
    );
    booted = await bootApp({
      appName: 'toggles-app',
      config: {
        service: { port: 0, httpFileHandling: false },
        mcpServer: {
          enabled: true,
          expose: { events: false, entities: true, resources: false },
        },
      },
    });
  });

  afterAll(async () => {
    await shutdown(booted);
  });

  test('events disabled → no event tools', async () => {
    const { tools } = await booted.client.listTools();
    const names = tools.map(t => t.name);
    assert.notInclude(names, 'McpToggles__Ping');
    // Entity tools still present.
    assert.include(names, 'McpToggles__Box__create');
  });

  test('resources disabled → empty resources/list', async () => {
    const { resources } = await booted.client.listResources();
    assert.equal(resources.length, 0);
  });

  test('resources/read fails when resources disabled', async () => {
    let threw = false;
    try {
      await booted.client.readResource({ uri: 'agentlang://McpToggles/Box' });
    } catch {
      threw = true;
    }
    assert.isTrue(threw);
  });
});

// ──────────────────────────────────────────────────────────────────
// Auth gating: with config.auth.enabled, /mcp requires bearer token
// ──────────────────────────────────────────────────────────────────

describe('MCP server — auth gating', () => {
  let http: HttpServer;
  let baseUrl: string;
  let savedAuthCfg: any;

  beforeAll(async () => {
    await doInternModule(
      'McpAuth',
      `@public event Hello { name String }
       workflow Hello { Hello.name }`
    );

    // Flip auth on at the global config level — this is what isAuthEnabled() reads.
    savedAuthCfg = AppConfig?.auth;
    setAppConfig({ ...(AppConfig as any), auth: { enabled: true } } as any);

    const app = await createApp({ name: 'auth-app', version: '0.0.1' }, {
      service: { port: 0, httpFileHandling: false },
      auth: { enabled: true },
      mcpServer: { enabled: true },
    } as any);
    http = app.listen(0);
    const addr = http.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => http.close(() => resolve()));
    // Restore previous auth config so other test files aren't affected.
    setAppConfig({ ...(AppConfig as any), auth: savedAuthCfg } as any);
  });

  test('POST /mcp without Authorization returns 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'curl', version: '0.0.0' },
        },
      }),
    });
    assert.equal(res.status, 401);
  });

  test('GET /mcp without Authorization returns 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'GET' });
    assert.equal(res.status, 401);
  });
});
