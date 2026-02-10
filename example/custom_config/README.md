# Resolver Configuration Example — Using Entities as Config Providers

This example demonstrates:
1. How an Agentlang application can expose configuration values to JavaScript resolvers using **entities** and **`fetchConfig`**.
2. How to configure documents from various sources: local files, S3, HTTPS, and the secure **Document Service**.

A resolver may require external configuration—such as API keys, endpoints, or credentials—and Agentlang provides a clean, typed, declarative way to supply this information.

---

## 1. Overview

In this module:

* The `Config` entity is used to **store resolver configuration** (server URL and API key).
* The configuration is **initialized via `config.al`**, not created through workflows.
* The resolver (`ChatResolver`) uses the JavaScript function `createChatMessage` to send or simulate sending chat messages.
* The resolver retrieves configuration using the Agentlang runtime helper **`fetchConfig()`**.

This architecture cleanly separates **configuration**, **data**, and **resolver behavior**, enabling maintainable and secure integrations.

---

## 2. Agentlang Module

```agentlang
module custom_config.core

import "resolver.js" @as r

entity Config {
    id UUID @id @default(uuid()),
    server String,
    key String
}

entity ChatMessage {
    id Int @id,
    message String,
    to String
}

resolver ChatResolver ["custom_config.core/ChatMessage"] {
    create r.createChatMessage
}
```

### Key Features

* `ChatMessage` is resolved by `ChatResolver`, which implements the **create** handler.
* The resolver pulls configuration from the `Config` entity using `fetchConfig('custom_config.core/Config')`.

---

## 3. Resolver Logic (`resolver.js`)

```js
import { fetchConfig } from "../../../out/runtime/api.js"

export async function createChatMessage(_, inst) {
    const config = await fetchConfig('custom_config.core/Config')
    console.log(`Connecting to chat server ${config.server} using key ${config.key}`)

    const to = inst.lookup('to')
    const message = inst.lookup('message')
    console.log(`To: ${to}, Body: ${message}`)

    return inst
}
```

### How it Works

* **`fetchConfig(entityName)`** loads the config entity from the service configuration.
* The resolver reads attributes from the `ChatMessage` instance via `inst.lookup()`.
* The function returns the instance, completing the creation process.

---

## 4. Declaring the Config Entity in `package.json`

The `Chat` package declares that it expects configuration for the `Config` entity:

```json
{
    "name": "Chat",
    "version": "0.0.1",
    "agentlang": {
        "config": ["custom_config.core/Config"]
    }
}
```

This tells Agentlang that the configuration must be provided in **config.al**.

---

## 5. Document Configuration Examples

This example also demonstrates various ways to configure documents for agents:

### 5.1 Local File
```json
{
  "agentlang.ai/doc": {
    "title": "price list",
    "url": "./example/camera_info/docs/prices.txt"
  }
}
```

### 5.2 S3 Storage
```json
{
  "agentlang.ai/doc": {
    "title": "company handbook",
    "url": "s3://my-bucket/docs/handbook.pdf",
    "retrievalConfig": {
      "provider": "s3",
      "config": {
        "region": "#js process.env.AWS_REGION",
        "accessKeyId": "#js process.env.AWS_ACCESS_KEY_ID",
        "secretAccessKey": "#js process.env.AWS_SECRET_ACCESS_KEY"
      }
    }
  }
}
```

### 5.3 HTTPS URL
```json
{
  "agentlang.ai/doc": {
    "title": "api documentation",
    "url": "https://docs.example.com/api.md"
  }
}
```

### 5.4 Document Service (Recommended)

The secure way to access documents uploaded via Studio:

**Option A: Direct URL (with document-service:// protocol)**
```json
{
  "agentlang.ai/doc": {
    "title": "product manual",
    "url": "document-service://<app-uuid>/<document-uuid>.pdf",
    "retrievalConfig": {
      "provider": "document-service",
      "config": {
        "baseUrl": "#js process.env.DOCUMENT_SERVICE_URL",
        "authToken": "#js process.env.DOCUMENT_SERVICE_AUTH_TOKEN"
      }
    },
    "embeddingConfig": {
      "provider": "openai",
      "model": "text-embedding-3-small",
      "chunkSize": 1000,
      "chunkOverlap": 200
    }
  }
}
```

**Option B: Lookup by Title**
```json
{
  "agentlang.ai/doc": {
    "title": "company policies",
    "retrievalConfig": {
      "provider": "document-service",
      "config": {
        "baseUrl": "#js process.env.DOCUMENT_SERVICE_URL",
        "appName": "my-app",
        "authToken": "#js process.env.DOCUMENT_SERVICE_AUTH_TOKEN"
      }
    }
  }
}
```

### Document Service Setup

1. Upload documents via Studio (normal mode)
2. Copy the `document-service://` URL from the upload response
3. Set environment variables:
   ```bash
   export DOCUMENT_SERVICE_URL=https://docstore.fractl.io
   export DOCUMENT_SERVICE_AUTH_TOKEN=<your-cognito-id-token>
   ```

## 6. Initializing Configuration (`config.al`)

```agentlang
{
    custom_config.core/Config: {
        server: "https://my.chat",
        key: "#js process.env.CHAT_SECRET" // or "#js readSecret(\"CHAT_SECRET\")"
    }
}

{
    "service": {
        "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
    },
    "store": {
        "type": "sqlite",
        "dbname": "cc.db"
    }
}
```

### Notes

* The `Config` entity is populated at startup using values in this file.
* These values are immediately accessible to resolvers via `fetchConfig`.
* This design avoids hard-coding sensitive values (API keys, credentials).

---

## 7. Running the Example

1. Start the Agentlang service:

   ```bash
   node ./bin/cli.js run example/custom_config
   ```

2. Create a `ChatMessage`:

   ```bash
    curl -X POST http://localhost:8080/custom_config.core/ChatMessage  \
    -H 'Content-Type: application/json'  \
    -d '{"to": "joe", "message": "hello"}'
   ```

3. The resolver output will appear in the console:

   ```
   Connecting to chat server https://my.chat using key 333dwddsd7738
   To: joe@acme.com, Body: Hello!
   ```

---

## 8. Summary

This example shows:

### ✔ Using an entity (`Config`) to hold resolver configuration

### ✔ Injecting that configuration via `config.al`

### ✔ Accessing configuration in resolvers via `fetchConfig()`

### ✔ Clean separation between configuration, data, and resolver logic

This pattern is ideal for any resolver that integrates with external systems—chat services, APIs, payment gateways, databases, etc.