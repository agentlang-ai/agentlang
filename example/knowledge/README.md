# Knowledge Microservice

A multi-tenant document sync service that ingests files from cloud storage providers (OneDrive, Dropbox, Box, Google Drive) into a versioned, locally-managed knowledge store. Built as an [Agentlang](https://github.com/agentlang-ai/agentlang) application using rclone for cloud provider abstraction.

---

## Architecture Overview

```
Cloud Storage (OneDrive, Dropbox, Box, Google Drive)
        |
        v
  rclone daemon (:5572)          <-- RC API, manages remotes & OAuth tokens
        |
        v
  Knowledge Service (:8080)      <-- Agentlang app
        |
        +---> Staging dir         <-- Per-remote mirror via rclone sync
        +---> Version store       <-- Immutable file copies with content hashes
        +---> SQLite / PostgreSQL <-- Entities, sync history, changelogs
```

### Sync Pipeline

1. **syncTick** (timer) iterates over all ready connections
2. **syncConnection** calls rclone `sync/sync` to mirror remote files into a staging directory
3. Compares staging against the database to build a **SyncChangelog** (added / modified / deleted)
4. **processChangelog** copies files into the immutable version store and creates KnowledgeDocument + DocumentVersion records
5. SyncJob is updated with counters and final status

---

## Prerequisites

- **Node.js** >= 18
- **Agentlang CLI** — installed and available as `agentlang` (or run via `node ./bin/cli.js`)
- **rclone** >= 1.65 — [install instructions](https://rclone.org/install/)

---

## Quick Start

### 1. Install dependencies

```bash
cd example/knowledge
npm install
```

### 2. Configure an rclone remote

Use `rclone config` to set up a remote. For example, to add a OneDrive remote called `my-onedrive`:

```bash
rclone config create my-onedrive onedrive
```

Follow the interactive prompts to complete OAuth. You can verify it works:

```bash
rclone ls my-onedrive:
```

### 3. Start the rclone daemon

The knowledge service communicates with rclone via its RC (Remote Control) API:

```bash
rclone rcd --rc-addr :5572
```

To enable authentication on the RC API:

```bash
export RCLONE_RC_USER=admin
export RCLONE_RC_PASS=secret
rclone rcd --rc-addr :5572 --rc-user $RCLONE_RC_USER --rc-pass $RCLONE_RC_PASS
```

Verify the daemon is running:

```bash
curl -s http://localhost:5572/rc/noop -d '{}' | jq .
```

### 4. Start the knowledge service

From the repository root:

```bash
node ./bin/cli.js run example/knowledge
```

The service starts on port 8080 by default (SQLite database, auth/RBAC disabled).

### 5. Create a Config (optional)

The service uses sensible defaults, but you can customize operational settings by creating a Config entity:

```bash
curl -s -X POST http://localhost:8080/knowledge.core/Config \
  -H 'Content-Type: application/json' \
  -d '{
    "rcloneRcUrl": "http://localhost:5572",
    "stagingDir": "~/.agentlang/studio/.knowledge_staging",
    "storeDir": "~/.agentlang/studio/.knowledge_store",
    "syncSchedulerIntervalSec": 21600
  }' | jq .
```

### 6. Create a Connection

Register a cloud storage connection. The `externalConnectionId` must match the rclone remote name:

```bash
curl -s -X POST http://localhost:8080/knowledge.core/Connection \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My OneDrive",
    "provider": "onedrive",
    "remotePath": "/Documents",
    "scope": "user",
    "status": "ready",
    "externalConnectionId": "my-onedrive",
    "tenantId": "00000000-0000-0000-0000-000000000000",
    "createdBy": "00000000-0000-0000-0000-000000000000"
  }' | jq .
```

Save the returned `id` — you'll need it to trigger syncs.

### 7. Trigger a sync

Start the sync scheduler, which will immediately sync all ready connections:

```bash
curl -s -X POST http://localhost:8080/knowledge.core/startSyncScheduler \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

Or trigger a one-off sync for a specific connection by calling the `syncTick` workflow:

```bash
curl -s -X POST http://localhost:8080/knowledge.core/syncTick \
  -H 'Content-Type: application/json' \
  -d '{}' | jq .
```

### 8. Check results

List synced documents:

```bash
curl -s "http://localhost:8080/knowledge.core/KnowledgeDocument" | jq .
```

List sync jobs:

```bash
curl -s "http://localhost:8080/knowledge.core/SyncJob" | jq .
```

View the changelog for a sync job:

```bash
curl -s "http://localhost:8080/knowledge.core/SyncChangelog" | jq .
```

---

## Configuration

### config.al

Runtime configuration for the Agentlang service itself:

| Section      | Variable            | Default             |
| ------------ | ------------------- | ------------------- |
| `store`      | `STORE_TYPE`        | `sqlite`            |
|              | `POSTGRES_HOST`     | `localhost`         |
|              | `POSTGRES_USER`     | (system user)       |
|              | `POSTGRES_PASSWORD` | (empty)             |
|              | `POSTGRES_DB`       | `knowledge_service` |
|              | `POSTGRES_PORT`     | `5432`              |
| `service`    | `SERVICE_PORT`      | `8080`              |
| `auth`       | `AUTH_ENABLED`      | `false`             |
| `rbac`       | `RBAC_ENABLED`      | `false`             |
| `auditTrail` | (always enabled)    | `true`              |

### Config Entity

The `Config` entity is a singleton that holds operational defaults. The resolver reads values in this order: **Config entity** > **environment variable** > **hardcoded default**.

| Field                         | Env var fallback | Default                                  |
| ----------------------------- | ---------------- | ---------------------------------------- |
| `rcloneRcUrl`                 | `RCLONE_RC_URL`  | `http://localhost:5572`                  |
| `stagingDir`                  | `STAGING_DIR`    | `~/.agentlang/studio/.knowledge_staging` |
| `storeDir`                    | `STORE_DIR`      | `~/.agentlang/studio/.knowledge_store`   |
| `syncSchedulerIntervalSec`    | —                | `21600` (6 hours)                        |
| `maxConcurrentSyncsPerTenant` | —                | `3`                                      |
| `defaultSyncIntervalMin`      | —                | `60`                                     |
| `defaultSyncTimeoutMin`       | —                | `30`                                     |
| `defaultRetentionPolicy`      | —                | `all`                                    |

Sensitive credentials are **environment variables only** (never stored in Config):

| Variable         | Description                       |
| ---------------- | --------------------------------- |
| `RCLONE_RC_USER` | rclone RC API basic auth username |
| `RCLONE_RC_PASS` | rclone RC API basic auth password |

---

## Core Concepts

### Entities

| Entity              | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `Config`            | Singleton — service-wide operational defaults             |
| `TenantConfig`      | Per-tenant quotas (max connections, documents, storage)   |
| `Connection`        | Cloud provider connection (OneDrive, Dropbox, etc.)       |
| `KnowledgeDocument` | A document ingested from a connection                     |
| `DocumentVersion`   | Immutable version record for a document                   |
| `VersionLock`       | Prevents retention cleanup of an active version           |
| `SyncJob`           | Tracks a sync execution (status, counters, errors)        |
| `SyncChangelog`     | Per-file change record (added / modified / deleted)       |
| `Topic`             | Grouping mechanism for documents (manual or auto-curated) |
| `TopicDocument`     | Join entity linking topics to documents (many-to-many)    |

### Relationships

```
Connection
  |-- 1:N --> KnowledgeDocument
  |              |-- 1:N --> DocumentVersion
  |              |              |-- 1:N --> VersionLock
  |              |-- M:N --> Topic (via TopicDocument)
  |-- 1:N --> SyncJob
                 |-- 1:N --> SyncChangelog
```

### Resolver-backed Entities

These entities are not persisted — they proxy to rclone or the local filesystem:

| Entity           | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `CloudFileProxy` | Proxy to rclone RC API (sync, list, stat, health)  |
| `StagingFile`    | Scans the local staging directory after sync       |
| `VersionStore`   | Copies staging files to immutable store + MD5 hash |

### Connection Status Lifecycle

```
awaiting_auth --> ready --> auth_revoked --> ready (re-auth)
                    |
                    +--> error --> ready (resolved)
```

---

## API Reference

All entities are exposed as REST endpoints at `http://localhost:8080/knowledge.core/<EntityName>`. Use POST to create, GET to query.

### Connection

**Create:**

```bash
curl -s -X POST http://localhost:8080/knowledge.core/Connection \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Team Dropbox",
    "provider": "dropbox",
    "remotePath": "/Shared/Docs",
    "scope": "org",
    "status": "ready",
    "externalConnectionId": "team-dropbox",
    "tenantId": "00000000-0000-0000-0000-000000000000",
    "createdBy": "00000000-0000-0000-0000-000000000000"
  }' | jq .
```

**List all:**

```bash
curl -s "http://localhost:8080/knowledge.core/Connection" | jq .
```

**Query by provider:**

```bash
curl -s "http://localhost:8080/knowledge.core/Connection?provider=onedrive" | jq .
```

**Update (e.g., disable sync):**

```bash
curl -s -X POST http://localhost:8080/knowledge.core/Connection \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "<connection-uuid>",
    "syncEnabled": false
  }' | jq .
```

### Sync

**Start the scheduler (syncs all ready connections on a timer):**

```bash
curl -s -X POST http://localhost:8080/knowledge.core/startSyncScheduler \
  -H 'Content-Type: application/json' -d '{}' | jq .
```

**Stop the scheduler:**

```bash
curl -s -X POST http://localhost:8080/knowledge.core/stopSyncScheduler \
  -H 'Content-Type: application/json' -d '{}' | jq .
```

**Trigger an immediate sync tick:**

```bash
curl -s -X POST http://localhost:8080/knowledge.core/syncTick \
  -H 'Content-Type: application/json' -d '{}' | jq .
```

**List sync jobs:**

```bash
curl -s "http://localhost:8080/knowledge.core/SyncJob" | jq .
```

**List sync changelog entries:**

```bash
curl -s "http://localhost:8080/knowledge.core/SyncChangelog" | jq .
```

### Documents

**List all documents:**

```bash
curl -s "http://localhost:8080/knowledge.core/KnowledgeDocument" | jq .
```

**Query by connection:**

```bash
curl -s "http://localhost:8080/knowledge.core/KnowledgeDocument?connectionId=<uuid>" | jq .
```

**List document versions:**

```bash
curl -s "http://localhost:8080/knowledge.core/DocumentVersion?documentId=<uuid>" | jq .
```

### Topics

**Create a topic:**

```bash
curl -s -X POST http://localhost:8080/knowledge.core/Topic \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Product Specs",
    "description": "All product specification documents",
    "type": "manual",
    "tenantId": "00000000-0000-0000-0000-000000000000",
    "createdBy": "00000000-0000-0000-0000-000000000000"
  }' | jq .
```

**Add a document to a topic:**

```bash
curl -s -X POST http://localhost:8080/knowledge.core/TopicDocument \
  -H 'Content-Type: application/json' \
  -d '{
    "topicId": "<topic-uuid>",
    "documentId": "<document-uuid>",
    "tenantId": "00000000-0000-0000-0000-000000000000",
    "addedBy": "00000000-0000-0000-0000-000000000000"
  }' | jq .
```

**List topics:**

```bash
curl -s "http://localhost:8080/knowledge.core/Topic" | jq .
```

### Cloud File Operations (via rclone)

**Check rclone health:**

```bash
curl -s "http://localhost:8080/knowledge.core/CloudFileProxy?action=health&remoteName=any&remotePath=" | jq .
```

**List remote files:**

```bash
curl -s "http://localhost:8080/knowledge.core/CloudFileProxy?action=list&remoteName=my-onedrive&remotePath=/Documents" | jq .
```

---

## Cloud Provider Setup

The knowledge service uses rclone as the cloud provider abstraction layer. Each provider needs an rclone remote configured before creating a Connection.

### OneDrive

```bash
rclone config create my-onedrive onedrive
# Follow the OAuth prompts in your browser
```

Connection entity: `provider: "onedrive"`, `externalConnectionId: "my-onedrive"`

### Dropbox

```bash
rclone config create my-dropbox dropbox
```

Connection entity: `provider: "dropbox"`, `externalConnectionId: "my-dropbox"`

### Google Drive

```bash
rclone config create my-gdrive drive
```

Connection entity: `provider: "google_drive"`, `externalConnectionId: "my-gdrive"`

### Box

```bash
rclone config create my-box box
```

Connection entity: `provider: "box"`, `externalConnectionId: "my-box"`

### Verify any remote

```bash
rclone ls <remote-name>:
rclone about <remote-name>:
```

---

## Sync Pipeline Details

### How syncTick works

The `syncTick` workflow is triggered on a timer (default: every 6 hours). For each Connection where `syncEnabled` is `true` and `status` is `"ready"`, it checks for an existing in-progress SyncJob. If none exists, it triggers `syncConnection`.

### How syncConnection works

1. Creates a SyncJob with `status: "in_progress"`
2. Calls `CloudFileProxy` with `action: "sync"` — the resolver calls rclone `sync/sync` to mirror the remote directory into `stagingDir/<remoteName>/`
3. **Detect added files** — scans staging via `StagingFile`, checks each against the DB; files with no matching KnowledgeDocument get a `SyncChangelog` entry with `changeType: "added"`
4. **Detect modified files** — files where `remoteModifiedAt` differs from the DB record get `changeType: "modified"`
5. **Detect deleted files** — KnowledgeDocuments with no matching staging file get `changeType: "deleted"`
6. Calls `processChangelog`
7. Updates SyncJob with final status and counters

### How processChangelog works

- **Added**: copies file from staging to versioned store (`storeDir/<remoteName>/<filePath>/<timestamp>`), computes MD5 hash, creates KnowledgeDocument (version 1) + DocumentVersion
- **Modified**: copies file to store, bumps `currentVersion` on existing KnowledgeDocument, creates new DocumentVersion
- **Deleted**: soft-deletes KnowledgeDocument (`isDeleted: true`)
- Each SyncChangelog entry is marked `"processed"` after handling

### Storage layout

```
~/.agentlang/studio/
  .knowledge_staging/
    <remoteName>/           <-- rclone mirror (transient)
      path/to/file.pdf
  .knowledge_store/
    <remoteName>/           <-- immutable version store
      path/to/file.pdf/
        2026-02-21T10-30-00.000Z    <-- version snapshot (timestamp as dir name)
```

---

## Using with PostgreSQL

By default the service uses SQLite. To switch to PostgreSQL:

```bash
export STORE_TYPE=postgres
export POSTGRES_HOST=localhost
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=secret
export POSTGRES_DB=knowledge_service
export POSTGRES_PORT=5432

node ./bin/cli.js run example/knowledge
```

---

## Enabling Auth & RBAC

```bash
export AUTH_ENABLED=true
export RBAC_ENABLED=true

node ./bin/cli.js run example/knowledge
```

When enabled, all requests require a Bearer token and RBAC rules are enforced per entity. See the `@rbac` annotations in `src/core.al` for the full permission matrix.

---

## Full Stack Setup

The knowledge service is part of a three-service stack. Here's how everything fits together:

```
Studio (Vite/React)          :5173
    |
    +---> Knowledge Service  :8080  (AgentLang app — document sync, topics, versioning)
    |         |
    |         +---> rclone daemon   :5572  (cloud file operations)
    |         +---> Integration Mgr :8085  (OAuth token management)
    |
    +---> Integration Manager :8085  (credential storage, OAuth flows)
```

### 1. Start the Integration Manager

The integration manager handles OAuth credential storage and token refresh for cloud providers (Google Drive, OneDrive). It runs as a separate AgentLang app on port 8085.

**Environment variables:**

| Variable                     | Required | Description                       |
| ---------------------------- | -------- | --------------------------------- |
| `GOOGLE_DRIVE_CLIENT_ID`     | Yes\*    | Google OAuth app client ID        |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Yes\*    | Google OAuth app client secret    |
| `ONEDRIVE_CLIENT_ID`         | Yes\*    | Microsoft OAuth app client ID     |
| `ONEDRIVE_CLIENT_SECRET`     | Yes\*    | Microsoft OAuth app client secret |
| `STORE_TYPE`                 | No       | `sqlite` (default) or `postgres`  |
| `AUTH_ENABLED`               | No       | `true` to require Bearer tokens   |
| `RBAC_ENABLED`               | No       | `true` to enforce RBAC            |

\* Required only for the providers you want to use. You can set just Google Drive or just OneDrive.

```bash
# Set OAuth credentials for the providers you need
export GOOGLE_DRIVE_CLIENT_ID="your-google-client-id"
export GOOGLE_DRIVE_CLIENT_SECRET="your-google-client-secret"
export ONEDRIVE_CLIENT_ID="your-microsoft-client-id"
export ONEDRIVE_CLIENT_SECRET="your-microsoft-client-secret"

# Start integration manager (from the agentlang repo root)
node ./bin/cli.js run ../integration-manager
```

The integration manager supports these credential strategies:

| Strategy       | Use case                                          |
| -------------- | ------------------------------------------------- |
| `api-key`      | API key in header or query                        |
| `basic-auth`   | Username/password                                 |
| `bearer-token` | Static bearer token                               |
| `jwt`          | JWT signing                                       |
| `oauth-2.0`    | OAuth2 (authorization code or client credentials) |

**OAuth consent flow:**

1. Studio calls `GET /integmanager.auth/oauthFlow?action=authorize&integrationName=google-drive` to get an authorization URL
2. User completes consent in the browser, which redirects to `http://localhost:8280/oauth/callback` with a code
3. Studio calls `POST /integmanager.auth/oauthFlow { action: "exchange", integrationName: "google-drive", code, state }` to exchange the code for tokens
4. Tokens are cached in-memory (with auto-refresh) and can be queried via `GET /integmanager.auth/oauthToken?integrationName=google-drive`

### 2. Start rclone

See [Quick Start — Step 3](#3-start-the-rclone-daemon) above.

### 3. Start the Knowledge Service

The knowledge service reads its integration manager host from `config.al`:

```
{
    "host": "#js process.env.INTEGRATION_MANAGER_HOST || 'http://localhost:8085'",
    "connections": "#js ({google_drive: 'google-drive/oauth-config', onedrive: 'onedrive/oauth-config'})",
    "oauth": true
} @as integrations
```

If the integration manager runs on a non-default host, set `INTEGRATION_MANAGER_HOST`:

```bash
export INTEGRATION_MANAGER_HOST=http://localhost:8085  # default

node ./bin/cli.js run example/knowledge
```

The knowledge service uses `agentlang.getAccessToken()` to fetch OAuth tokens from the integration manager. When syncing OAuth-connected remotes (Google Drive, OneDrive), it automatically refreshes the rclone remote's token before each sync.

### 4. Configure Studio

Studio connects to the knowledge service and integration manager via environment variables in `apps/studio/.env`:

```bash
# Knowledge service (document sync, topics, versioning)
VITE_KNOWLEDGE_SERVICE_URL=http://localhost:8080

# Integration manager (OAuth flows, credential management)
VITE_CONNECTION_MANAGER_SERVICE_URL=http://localhost:8085

# AgentLang meta API (workspace apps, agent management)
VITE_API_URL=https://agent-meta-dev.api.fractl.dev

# Document ingestion / storage
VITE_DOCUMENT_SERVICE_URL=https://docstore.fractl.io

# AWS Cognito (user authentication)
VITE_COGNITO_REGION=us-west-2
VITE_COGNITO_USER_POOL_ID=us-west-2_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=your-cognito-client-id
```

For local development, the knowledge service and integration manager URLs point to localhost. All other services use the dev cloud endpoints.

Start the studio dev server:

```bash
cd studio
npm install
npx nx serve studio
```

The studio runs on `http://localhost:5173` by default.

---

## Environment Variable Reference

All environment variables across the three services:

### Knowledge Service (port 8080)

| Variable                   | Default                                  | Description                       |
| -------------------------- | ---------------------------------------- | --------------------------------- |
| `SERVICE_PORT`             | `8080`                                   | HTTP server port                  |
| `STORE_TYPE`               | `sqlite`                                 | `sqlite` or `postgres`            |
| `POSTGRES_HOST`            | `localhost`                              | PostgreSQL host                   |
| `POSTGRES_USER`            | (system user)                            | PostgreSQL user                   |
| `POSTGRES_PASSWORD`        | (empty)                                  | PostgreSQL password               |
| `POSTGRES_DB`              | `knowledge_service`                      | PostgreSQL database name          |
| `POSTGRES_PORT`            | `5432`                                   | PostgreSQL port                   |
| `AUTH_ENABLED`             | `false`                                  | Require Bearer tokens             |
| `RBAC_ENABLED`             | `false`                                  | Enforce RBAC per entity           |
| `INTEGRATION_MANAGER_HOST` | `http://localhost:8085`                  | Integration manager base URL      |
| `RCLONE_RC_URL`            | `http://localhost:5572`                  | rclone RC API URL                 |
| `RCLONE_RC_USER`           | (empty)                                  | rclone RC basic auth username     |
| `RCLONE_RC_PASS`           | (empty)                                  | rclone RC basic auth password     |
| `STAGING_DIR`              | `~/.agentlang/studio/.knowledge_staging` | rclone sync staging directory     |
| `STORE_DIR`                | `~/.agentlang/studio/.knowledge_store`   | Immutable version store directory |

### Integration Manager (port 8085)

| Variable                     | Default  | Description                   |
| ---------------------------- | -------- | ----------------------------- |
| `GOOGLE_DRIVE_CLIENT_ID`     | —        | Google OAuth client ID        |
| `GOOGLE_DRIVE_CLIENT_SECRET` | —        | Google OAuth client secret    |
| `ONEDRIVE_CLIENT_ID`         | —        | Microsoft OAuth client ID     |
| `ONEDRIVE_CLIENT_SECRET`     | —        | Microsoft OAuth client secret |
| `STORE_TYPE`                 | `sqlite` | `sqlite` or `postgres`        |
| `AUTH_ENABLED`               | `false`  | Require Bearer tokens         |
| `RBAC_ENABLED`               | `false`  | Enforce RBAC                  |

### Studio

| Variable                              | Description                                              |
| ------------------------------------- | -------------------------------------------------------- |
| `VITE_KNOWLEDGE_SERVICE_URL`          | Knowledge service URL (default: `http://localhost:8080`) |
| `VITE_CONNECTION_MANAGER_SERVICE_URL` | Integration manager URL                                  |
| `VITE_API_URL`                        | AgentLang meta API URL                                   |
| `VITE_DOCUMENT_SERVICE_URL`           | Document ingestion/storage service URL                   |
| `VITE_COGNITO_REGION`                 | AWS Cognito region                                       |
| `VITE_COGNITO_USER_POOL_ID`           | AWS Cognito user pool ID                                 |
| `VITE_COGNITO_CLIENT_ID`              | AWS Cognito client ID                                    |
