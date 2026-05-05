# MCP Server: Expose Your Agentlang App as Model Context Protocol

This guide shows how to turn an agentlang application into an [MCP](https://modelcontextprotocol.io) server so that MCP clients (Claude Desktop, Cursor, custom agents, etc.) can call your agents, run your workflows, and read your data.

## Overview

When `mcpServer.enabled` is set in your app config, the runtime mounts a [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) MCP transport on the same Express app that already serves the agentlang HTTP API. No extra process; same port; same auth.

What gets exposed:

- **Every `@public` event becomes a tool** named `module__event`. This includes agents, since agents in agentlang are invoked as events.
- **Every entity becomes four CRUD tools**: `module__Entity__create`, `module__Entity__list`, `module__Entity__get`, `module__Entity__delete`.
- **Every entity is also exposed as a resource** at `agentlang://module/Entity`. `resources/read` returns all rows as JSON.
- **A built-in `agentlang_search_tools` tool** lets clients discover tools by free-text query, ranked over name, module, and description.

The tool list is rebuilt per `tools/list` request, so dynamically interned modules show up without a restart.

## Quick start

### 1. Enable in your config

```jsonc
{
  "service": { "port": 8080 },
  "mcpServer": {
    "enabled": true,
    "path": "/mcp",
  },
}
```

### 2. Run your app

```bash
agent run my-app.al
# Application my-app version 0.0.1 started on port 8080
# MCP server 'my-app' v0.0.1 ready (path=/mcp, stateless=true)
```

### 3. Point an MCP client at it

Most clients accept a `url` in their `mcpServers` block. For Claude Desktop:

```jsonc
{
  "mcpServers": {
    "my-agentlang-app": {
      "url": "http://localhost:8080/mcp",
    },
  },
}
```

If your app has `auth.enabled: true`, add a Bearer token:

```jsonc
{
  "mcpServers": {
    "my-agentlang-app": {
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer <session-token>" },
    },
  },
}
```

## Worked example

Given this module:

```typescript
module shop

entity Item {
    id Int @id,
    name String,
    price Float,
    inStock Boolean
}

@public event MakeItem {
    id Int,
    name String,
    price Float
}

workflow MakeItem {
    {Item {id MakeItem.id, name MakeItem.name, price MakeItem.price, inStock true}}
}
```

`tools/list` returns:

```json
{
  "tools": [
    {
      "name": "agentlang_search_tools",
      "description": "Search the available agentlang MCP tools..."
    },
    { "name": "shop__MakeItem", "description": "Invoke agentlang event shop/MakeItem." },
    {
      "name": "shop__Item__create",
      "description": "Create a shop/Item record. Pass attributes as JSON."
    },
    {
      "name": "shop__Item__list",
      "description": "List shop/Item records. Optional filter attributes are matched as exact equality."
    },
    { "name": "shop__Item__get", "description": "Fetch a single shop/Item record by primary key." },
    { "name": "shop__Item__delete", "description": "Delete a shop/Item record by primary key." }
  ]
}
```

`resources/list` returns:

```json
{
  "resources": [
    {
      "uri": "agentlang://shop/Item",
      "name": "shop/Item",
      "description": "All records of shop/Item."
    }
  ]
}
```

Calling the event tool:

```json
{ "name": "shop__MakeItem", "arguments": { "id": 1, "name": "Pen", "price": 2.5 } }
```

returns text content with the workflow's last result (the new `Item` instance as JSON).

## Tool naming

Tool names cannot contain `/`, so agentlang separators (`module/Entity`) are remapped to `__`:

| Source                   | Tool name                |
| ------------------------ | ------------------------ |
| `@public event` X in M   | `M__X`                   |
| Entity X in M, create    | `M__X__create`           |
| Entity X in M, list      | `M__X__list`             |
| Entity X in M, get by id | `M__X__get`              |
| Entity X in M, delete    | `M__X__delete`           |
| Built-in search          | `agentlang_search_tools` |

The search tool is intentionally single-segment (no `__`) so it can never collide with module/entry tool names.

## Input schemas

The tool's JSON Schema is derived from the corresponding agentlang record:

| Agentlang type                                            | JSON Schema                                      |
| --------------------------------------------------------- | ------------------------------------------------ |
| `String` / `Email` / `UUID` / `URL` / `Path` / `Password` | `{ type: "string" }`                             |
| `Date`                                                    | `{ type: "string", format: "date" }`             |
| `Time`                                                    | `{ type: "string", format: "time" }`             |
| `DateTime`                                                | `{ type: "string", format: "date-time" }`        |
| `Int`                                                     | `{ type: "integer" }`                            |
| `Number` / `Float` / `Decimal`                            | `{ type: "number" }`                             |
| `Boolean`                                                 | `{ type: "boolean" }`                            |
| `Map`                                                     | `{ type: "object", additionalProperties: true }` |
| `Any`                                                     | `{}` (any value)                                 |
| Custom object types                                       | `{ type: "object", additionalProperties: true }` |
| `String @array` (or any array)                            | `{ type: "array", items: <inner> }`              |
| `String @enum("a", "b")`                                  | `{ type: "string", enum: ["a", "b"] }`           |

Attributes that are not marked `@optional` and have no `@default` or expression are listed in `required`. The `list` tool is an exception: all filter attributes are optional so clients can pass any subset.

## Discovering tools at runtime: `agentlang_search_tools`

When a client connects to a large agentlang app, listing every tool is noisy. Use the search tool instead:

```json
{
  "name": "agentlang_search_tools",
  "arguments": {
    "query": "invoice",
    "kind": "event",
    "limit": 5
  }
}
```

Response (text JSON):

```json
{
  "matches": [
    {
      "name": "shop__SendInvoice",
      "description": "Send an invoice...",
      "kind": "event",
      "score": 10
    }
  ]
}
```

Arguments:

| Field   | Type                               | Default | Notes                                                                                                     |
| ------- | ---------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `query` | `string` (required)                |         | Whitespace-split into terms; each term matched (case-insensitive) against tool name, module, description. |
| `limit` | `integer`                          | `20`    | Clamped to `[1, 100]`.                                                                                    |
| `kind`  | `"any"` \| `"event"` \| `"entity"` | `"any"` | Narrow by surface. `event` = `@public` events; `entity` = entity CRUD tools.                              |

Scoring weights tool-name and entry-name matches highest, then module, then suffix (`create`/`list`/...), then description. Results sort by score desc with name as tiebreak. Tools disabled by `expose.events` / `expose.entities` are not included.

## Auth

When `auth.enabled` is true in your config, `/mcp` requires `Authorization: Bearer <token>`. The same `verifyAuth` path used by the rest of the agentlang HTTP API checks the token, and the resulting session is threaded into every tool/resource handler via `AsyncLocalStorage`. RBAC rules on entities and events apply transparently — a tool call only sees data the caller is authorized to see.

Requests without a valid bearer get `401 Authorization required`.

## Configuration reference

```jsonc
{
  "mcpServer": {
    "enabled": false, // turn the MCP server on
    "path": "/mcp", // mount path on the existing Express app
    "name": "my-app", // server name advertised to clients (defaults to appSpec.name)
    "version": "0.0.1", // server version (defaults to appSpec.version)
    "stateless": true, // see "Stateless vs stateful" below
    "expose": {
      "events": true, // expose @public events as tools
      "entities": true, // expose entity CRUD tools
      "resources": true, // expose entities as MCP resources
    },
  },
}
```

`expose.*` defaults to `true`. The `agentlang_search_tools` tool is always available regardless of these toggles.

## Stateless vs stateful

By default the server runs stateless (`stateless: true`): each HTTP request creates a fresh MCP `Server` and transport, handles one request, then closes. This matches the [SDK's recommended pattern for simple API-style servers](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/server/simpleStatelessStreamableHttp.ts) and works well with HTTP-based MCP clients.

Set `stateless: false` to opt into a session-based model:

- The server returns an `Mcp-Session-Id` header on `initialize`.
- The client must echo that header on subsequent requests.
- The same `transport` and `Server` instance handles all requests for that session.
- `GET /mcp` and `DELETE /mcp` become valid (used for SSE streaming and explicit session teardown).

In stateless mode, `GET` and `DELETE` on `/mcp` return `405 Method not allowed`.

## How it maps onto the existing HTTP API

| Surface         | HTTP endpoint                  | MCP equivalent                                                        |
| --------------- | ------------------------------ | --------------------------------------------------------------------- |
| `@public` event | `POST /:module/:event`         | `tools/call` with `name = "module__event"`                            |
| Entity create   | `POST /:module/:entity`        | `tools/call` with `name = "module__Entity__create"`                   |
| Entity query    | `GET /:module/:entity`         | `tools/call` with `name = "module__Entity__list"` or `resources/read` |
| Entity by id    | `GET /:module/:entity/<id>`    | `tools/call` with `name = "module__Entity__get"`                      |
| Entity delete   | `DELETE /:module/:entity/<id>` | `tools/call` with `name = "module__Entity__delete"`                   |

Auth, RBAC, hot-reload of dynamically interned modules, and result normalization all behave the same on both surfaces.

## Caveats

- **Tool naming**: agentlang uses `/` between module and entry; MCP forbids `/` in tool names, so we use `__`. Single-segment names (no `__`) are reserved for built-ins like `agentlang_search_tools`.
- **Entity tools assume an `id` primary key** for `get` and `delete`. Path-qualified or relationship-scoped CRUD should go through public events.
- **No `tools/list_changed` notification** is emitted on hot-reload — clients re-list on demand and pick up changes naturally.
- **Concurrency**: stateful sessions are kept in-memory in a `Map<sessionId, ...>`. There is no persistence or cross-process replication; restarts drop sessions and clients have to re-`initialize`.
