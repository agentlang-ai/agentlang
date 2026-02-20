# Using Integration Manager for Authentication in Resolvers

This guide shows how to connect your Agentlang resolvers to external APIs that require authentication (OAuth tokens, API keys, etc.) using the Integration Manager service.

## Overview

The Integration Manager is a separate service that owns all credential storage, token lifecycle (including OAuth refresh), and secret management. Your Agentlang app never stores credentials directly. Instead, at runtime your resolvers ask the Integration Manager for the current auth headers and use them when calling external APIs.

The flow looks like this:

```
Resolver function
  --> resolver.getAuthHeaders()
    --> Agentlang runtime (integration-client)
      --> Integration Manager HTTP API
        --> returns { "Authorization": "Bearer <token>" }
  --> fetch("https://api.example.com/...", { headers: authHeaders })
```

## Setup

### 1. Start the Integration Manager

The Integration Manager runs as its own process. It must be running before your Agentlang app starts.

```bash
cd integration-manager
npm start
```

By default it listens on `http://localhost:8085`.

### 2. Configure your app's `config.al`

Add an `integrations` section to your app's config file. This tells the runtime where the Integration Manager is and which resolvers are bound to which integrations.

```json
{
  "agentlang": {
    "service": {
      "port": 8080
    },
    "store": {
      "type": "sqlite",
      "dbname": "myapp.db"
    },
    "integrations": {
      "host": "http://localhost:8085",
      "connections": {
        "gmail": {
          "config": "gmail/gmail-oauth",
          "resolvers": ["mymodule/gmailResolver1", "mymodule/gmailResolver2"]
        },
        "slack": {
          "config": "slack/slack-bot-token",
          "resolvers": ["mymodule/slackResolver"]
        }
      }
    }
  }
}
```

| Field | Description |
|---|---|
| `host` | URL of the running Integration Manager service |
| `connections` | A map of integration names to their configuration |
| `connections.<name>.config` | Path to the credential config in Integration Manager (`<integrationId>/<configId>`) |
| `connections.<name>.resolvers` | List of resolver names (as `module/resolverName`) that should receive auth headers from this integration |

You can use `#js` expressions for the host (e.g. to read from an environment variable):

```json
"host": "#js (process.env.INTEGRATION_MANAGER_HOST || 'http://localhost:8085')"
```

### 3. Define your resolvers in `.al`

Define your entities and resolvers as usual. No special DSL syntax is needed -- the binding between a resolver and its integration is done entirely through the `connections` config above.

```
module mymodule

import "resolver.js" @as r

entity Email {
    id UUID @id @default(uuid()),
    sender String @optional,
    subject String @optional,
    body String @optional
}

resolver gmailResolver1 [mymodule/Email] {
    create r.createEmail,
    query r.queryEmail,
    delete r.deleteEmail
}
```

At startup, the runtime reads the `connections` config and automatically calls `resolver.setIntegrationName("gmail")` for every resolver listed under that connection. You don't need to do this yourself.

## Writing Resolver Functions

### Getting auth headers via the resolver object

Every resolver function receives the `resolver` object as its first argument. If the resolver is bound to an integration (via the config), you can call `resolver.getAuthHeaders()` to get the current auth headers:

```js
export const queryEmail = async (resolver, inst) => {
  // getAuthHeaders() calls Integration Manager and returns
  // something like: { "Authorization": "Bearer eyJhbG..." }
  const authHeaders = await resolver.getAuthHeaders();

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages", {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
  });

  const data = await response.json();
  // ... map data to entity instances and return
};
```

A common pattern is to create a helper for all HTTP requests in your resolver file:

```js
const makeRequest = async (resolver, endpoint, options = {}) => {
  const authHeaders = await resolver.getAuthHeaders();

  const response = await fetch(`https://api.example.com${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
};

// Then use it in all your resolver functions:
export const queryItems = async (resolver, inst) => {
  const data = await makeRequest(resolver, "/v1/items", { method: "GET" });
  // ...
};

export const createItem = async (resolver, inst) => {
  const body = { name: inst.attributes.get("name") };
  const data = await makeRequest(resolver, "/v1/items", {
    method: "POST",
    body: JSON.stringify(body),
  });
  // ...
};
```

### Using the global API helpers

Two convenience functions are also available globally on the `agentlang` object. These are useful when you need auth outside of a resolver function, or when calling a different integration than the one bound to the current resolver.

#### `agentlang.getAuthHeaders(integrationName)`

Returns the auth headers for a named integration:

```js
const headers = await agentlang.getAuthHeaders("gmail");
// { "Authorization": "Bearer eyJhbG..." }
```

#### `agentlang.authFetch(integrationName, url, options?)`

A drop-in replacement for `fetch()` that automatically injects the integration's auth headers:

```js
const response = await agentlang.authFetch(
  "gmail",
  "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10"
);

const data = await response.json();
```

You can pass additional headers -- they are merged on top of the auth headers:

```js
const response = await agentlang.authFetch("slack", "https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ channel: "#general", text: "Hello!" }),
});
```

### Which approach should I use?

| Approach | When to use |
|---|---|
| `resolver.getAuthHeaders()` | Default choice. Works inside any resolver function. Uses the integration bound to the resolver in config. |
| `agentlang.getAuthHeaders(name)` | When you need headers for a specific integration by name, or outside a resolver context. |
| `agentlang.authFetch(name, url)` | When you want a one-liner that combines header injection + fetch. |

## Complete Example: Gmail Integration

### File structure

```
my_app/
  config.al
  src/
    gmail.al
    resolver.js
```

### `config.al`

```json
{
  "agentlang": {
    "service": { "port": 8080 },
    "store": { "type": "sqlite", "dbname": "myapp.db" },
    "integrations": {
      "host": "#js (process.env.INTEGRATION_MANAGER_HOST || 'http://localhost:8085')",
      "connections": {
        "gmail": {
          "config": "gmail/gmail-oauth",
          "resolvers": ["gmail/gmail1", "gmail/gmail2"]
        }
      }
    }
  }
}
```

### `src/gmail.al`

```
module gmail

import "resolver.js" @as gmr

entity Email {
    id UUID @id @default(uuid()),
    sender String @optional,
    subject String @optional,
    body String @optional
}

entity Label {
    id UUID @id @default(uuid()),
    name String @optional,
    type String @optional
}

resolver gmail1 [gmail/Email] {
    create gmr.createEmail,
    query gmr.queryEmail,
    delete gmr.deleteEmail
}

resolver gmail2 [gmail/Label] {
    query gmr.queryLabel
}
```

### `src/resolver.js`

```js
import { makeInstance } from "agentlang/out/runtime/module.js";

// Helper: make authenticated requests using the resolver's bound integration
const makeRequest = async (resolver, endpoint, options = {}) => {
  const authHeaders = await resolver.getAuthHeaders();
  const url = `https://gmail.googleapis.com${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
};

export const queryEmail = async (resolver, inst) => {
  const data = await makeRequest(resolver, "/gmail/v1/users/me/messages?maxResults=10", {
    method: "GET",
  });

  const emails = [];
  for (const msg of data.messages || []) {
    const detail = await makeRequest(resolver, `/gmail/v1/users/me/messages/${msg.id}`, {
      method: "GET",
    });

    const headers = detail.payload?.headers?.reduce(
      (acc, h) => ({ ...acc, [h.name]: h.value }),
      {}
    ) || {};

    emails.push(
      makeInstance("gmail", "Email", new Map(Object.entries({
        id: detail.id,
        sender: headers["From"],
        subject: headers["Subject"],
        body: detail.snippet,
      })))
    );
  }

  return emails;
};

export const createEmail = async (resolver, inst) => {
  const to = inst.attributes.get("sender");
  const subject = inst.attributes.get("subject");
  const body = inst.attributes.get("body");

  const raw = Buffer.from(`To: ${to}\nSubject: ${subject}\n\n${body}`).toString("base64");

  const result = await makeRequest(resolver, "/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });

  return { id: result.id };
};

export const deleteEmail = async (resolver, inst) => {
  const id = inst.attributes.get("id");
  await makeRequest(resolver, `/gmail/v1/users/me/messages/${id}`, { method: "DELETE" });
  return { result: "success" };
};

export const queryLabel = async (resolver, inst) => {
  const data = await makeRequest(resolver, "/gmail/v1/users/me/labels", { method: "GET" });

  return (data.labels || []).map((label) =>
    makeInstance("gmail", "Label", new Map(Object.entries({
      id: label.id,
      name: label.name,
      type: label.type,
    })))
  );
};
```

## Resolver Function Signatures

For reference, the resolver functions are called with the following arguments:

| Method | Signature |
|---|---|
| `create` | `async (resolver, instance) => ...` |
| `query` | `async (resolver, instance, queryAll) => ...` |
| `update` | `async (resolver, instance, newAttributes) => ...` |
| `delete` | `async (resolver, instance, purge) => ...` |
| `subscribe` | `async (resolver) => ...` |

The `resolver` is always the first argument. Call `resolver.getAuthHeaders()` on it to get tokens.

## Troubleshooting

**"Integration client not configured"** -- The `integrations` section is missing from your `config.al`, or the Integration Manager host is not set.

**"Failed to get auth headers for integration: 404"** -- The integration name in your config doesn't match what's registered in Integration Manager. Check that the `config` path (`<integrationId>/<configId>`) is correct.

**`resolver.getAuthHeaders()` returns `{}`** -- The resolver is not listed in any connection's `resolvers` array in the config. Verify the resolver name matches exactly (format: `module/resolverName`).

**Token expired errors from the external API** -- The Integration Manager handles token refresh automatically. If you're still getting 401s, check that the Integration Manager's refresh logic is working by querying its `/integmanager.auth/authRefresh` endpoint directly.
