# Knowledge Service Architecture

## 1. Overview & Goals

The Knowledge service is a multi-tenant platform for ingesting, versioning, and managing knowledge from cloud storage providers. It is built as an agentlang application that extends the runtime's existing infrastructure into a production-grade knowledge management system.

### Key Capabilities

- **Cloud connections** — OAuth-based access to OneDrive, Dropbox, Box, and Google Drive via rclone
- **Automated sync** — Scheduled and on-demand one-way sync from cloud storage into the platform
- **Document versioning** — Immutable version history per file, version locking for consumers, configurable retention policies
- **Topic-based organization** — User-defined and auto-curated topics for grouping documents across connections
- **Multi-tenancy** — Complete tenant isolation across connections, documents, and configuration

### How It Extends Agentlang

Agentlang already provides:

| Capability  | Agentlang Runtime                                               |
| ----------- | --------------------------------------------------------------- |
| Auth & RBAC | `agentlang.auth` module with users, roles, permissions, tenants |
| Audit       | `@meta {"audit": true}` for automatic audit logging             |
| Resolvers   | Pluggable query/mutation resolvers for custom data sources      |

The Knowledge service adds: tenant-scoped cloud connections, automated sync pipelines, document versioning with locks, and a purpose-built API for managing the full lifecycle.

---

## 2. Multi-Tenancy Model

### Isolation Strategy

The Knowledge service uses agentlang's built-in tenant isolation model: a shared database schema with tenant-scoped access. Every entity carries a tenant identifier, and the runtime enforces tenant boundaries at the query layer.

Agentlang's auth module provides:

- **Tenant entity** — `{ id, name, domain }` marked `@meta {"global": true}` (not subject to tenant filtering)
- **UserTenant mapping** — associates users with tenants via domain-based resolution (`getTenantIdForUserDomain` extracts the domain from the user's email)
- **Path-based scoping** — each record's `__path__` attribute encodes `{tenantId}/{userId}`

### Tenant-Scoped Resources

Every Knowledge service entity includes a `tenantId` field. Queries are automatically filtered to the authenticated user's tenant.

| Resource           | Isolation Mechanism                                                    |
| ------------------ | ---------------------------------------------------------------------- |
| Connections        | `tenantId` column, RBAC `where: auth.user` for user-scoped connections |
| KnowledgeDocuments | `tenantId` column, inherited from parent connection                    |
| DocumentVersions   | Inherited from parent document's tenant                                |
| Sync jobs          | Inherited from parent connection's tenant                              |
| Topics             | `tenantId` column, RBAC `where: auth.user` for creator-scoped edits    |
| TopicDocuments     | Inherited from parent topic's tenant                                   |
| Version locks      | Scoped by `consumerId` within tenant                                   |

### Per-Tenant Configuration

Tenants can configure:

- **Retention policies** — per-connection: keep all, keep last N, or keep versions newer than N days
- **Sync intervals** — per-connection, in minutes
- **Resource quotas** — max connections, max documents, max storage bytes

### RBAC Mapping

The Knowledge service defines RBAC rules using agentlang's declarative syntax:

```
entity Connection {
    ...
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read]),
        (allow: [read, update], where: auth.user = this.createdBy)
    ]
}

entity KnowledgeDocument {
    ...
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read])
    ]
}

entity Topic {
    ...
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read, create]),
        (allow: [update, delete], where: auth.user = this.createdBy)
    ]
}
```

Role hierarchy:

- **admin** — full CRUD on all tenant resources, manage connections and sync
- **member** — read access to documents, create manual topics, trigger manual sync on permitted connections
- **owner** — implicit via `where: auth.user = this.createdBy` on user-scoped connections

---

## 3. System Architecture

### Service Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                            │
│                           (Studio UI, API Consumers)                        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ REST API
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Knowledge Service (agentlang app)                    │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────────────┐                 │
│  │  REST API Handlers    │  │  Sync Coordinator             │                 │
│  └──────────┬───────────┘  └──────────────┬───────────────┘                 │
│             │                             │                                 │
│  ┌──────────▼─────────────────────────────▼───────────────┐                 │
│  │              agentlang Runtime                          │                 │
│  │  ┌─────────────────────────┐ ┌───────────────────────┐ │                 │
│  │  │ SqlDbResolver            │ │ cloudFileResolver      │ │                 │
│  │  │ (RBAC, tenant enforce.)  │ │ (rclone RC proxy)      │ │                 │
│  │  └────────────┬─────────────┘ └───────────┬───────────┘ │                 │
│  └───────────────┼───────────────────────────┼─────────────┘                 │
└──────────────────┼───────────────────────────┼──────────────────────────────┘
                   │                           │
                   ▼                           ▼
          ┌─────────────────┐        ┌──────────────────────┐
          │  PostgreSQL       │        │  rclone daemon       │
          │  ┌─────────────┐ │        │  (sidecar, :5572)    │
          │  │ Entity tables│ │        └──────────┬───────────┘
          │  └─────────────┘ │                    │
          └─────────────────┘         ┌──────────▼──────────┐
                                      │  Cloud Providers     │
                                      │  OneDrive | Dropbox  │
                                      │  Box | Google Drive   │
                                      └──────────────────────┘
```

### Request Flow: Connect a Cloud Provider

```
1. Admin → POST /api/v1/tenants/{tenantId}/connections
2. Knowledge Service validates RBAC (admin role required)
3. Knowledge Service calls rclone RC: config/create to register the remote
4. rclone stores remote config, Knowledge Service records the Connection entity
5. Admin → GET /api/v1/tenants/{tenantId}/connections/{id}/auth-url
6. Knowledge Service initiates OAuth flow via rclone's config/create with OAuth params
7. User completes OAuth consent, rclone stores encrypted tokens in its config
8. Connection status transitions: awaiting_auth → ready
```

### Request Flow: Sync Files

```
1. Scheduler (or manual trigger) → POST /api/v1/tenants/{tenantId}/connections/{id}/sync
2. Knowledge Service creates SyncJob record (status: in_progress)
3. Sync phase — pull files:
   a. Call rclone sync/copy to incrementally sync remote → local staging
   b. Only changed files are downloaded (stable staging dir enables incremental sync)
4. Changelog phase — detect changes by comparing staging against DB:
   a. Scan staging directory via StagingFile resolver (walks filesystem)
   b. For each staged file, check KnowledgeDocument DB:
      - No matching doc → "added" changelog entry
      - Doc exists but remoteModifiedAt differs → "modified" changelog entry
   c. For each non-deleted KnowledgeDocument, check staging:
      - No matching staging file → "deleted" changelog entry
   d. Persist each change as a SyncChangelog entry (status: pending)
5. Version management — `processChangelog` workflow processes pending SyncChangelog entries:
   a. For "added": copy staging file to versioned store via `VersionStore` resolver,
      create KnowledgeDocument (version 1) + DocumentVersion, increment SyncJob counters
   b. For "modified": copy staging file to versioned store, bump KnowledgeDocument
      `currentVersion`, create new DocumentVersion, increment SyncJob counters
   c. For "deleted": soft-delete KnowledgeDocument (isDeleted: true),
      increment `filesDeleted`
   d. Mark each SyncChangelog entry as "processed"
6. SyncJob updated with staging path, status, and error (if any)
```

---

## 4. Data Model

### Entity Definitions

All entities are defined in agentlang's `.al` DSL with tenant isolation and RBAC.

#### TenantConfig

Per-tenant configuration for the Knowledge service.

```
entity TenantConfig {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    maxConnections Int @default(10),
    maxDocuments Int @default(10000),
    maxStorageBytes Int @default(10737418240),
    @rbac [(roles: [admin], allow: [create, read, update, delete])],
    @meta {"audit": true}
}
```

#### Config

Singleton registry for service-wide operational defaults. One row holds all non-sensitive configuration values that were previously scattered across environment variables, hardcoded values, and entity `@default` annotations. Sensitive credentials (rclone RC password, DB credentials) remain as environment variables only.

```
entity Config {
    id UUID @id @default(uuid()),
    // rclone integration
    rcloneRcUrl String @default("http://localhost:5572"),
    // File storage paths
    stagingDir String @default("~/.agentlang/studio/.knowledge_staging"),
    storeDir String @default("~/.agentlang/studio/.knowledge_store"),
    // Sync scheduler
    syncSchedulerIntervalSec Int @default(60),
    maxConcurrentSyncsPerTenant Int @default(3),
    // Per-tenant defaults
    defaultMaxConnections Int @default(10),
    defaultMaxDocuments Int @default(10000),
    defaultMaxStorageBytes Int @default(10737418240),
    // Per-connection defaults
    defaultSyncIntervalMin Int @default(60),
    defaultSyncTimeoutMin Int @default(30),
    defaultRetentionPolicy @enum("all", "count", "age") @default("all"),
    @rbac [(roles: [admin], allow: [create, read, update])]
}
```

| Field Group             | Fields                                                                      | Purpose                                                 |
| ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| rclone integration      | `rcloneRcUrl`                                                               | URL for the rclone RC daemon                            |
| File storage paths      | `stagingDir`, `storeDir`                                                    | Local paths for sync staging and versioned file store   |
| Sync scheduler          | `syncSchedulerIntervalSec`, `maxConcurrentSyncsPerTenant`                   | Timer interval and per-tenant concurrency limit         |
| Per-tenant defaults     | `defaultMaxConnections`, `defaultMaxDocuments`, `defaultMaxStorageBytes`    | Default quotas used when creating new TenantConfig      |
| Per-connection defaults | `defaultSyncIntervalMin`, `defaultSyncTimeoutMin`, `defaultRetentionPolicy` | Default sync settings used when creating new Connection |

#### Connection

Represents a cloud provider connection within a tenant.

```
entity Connection {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    name String,
    provider @enum("onedrive", "dropbox", "box", "google_drive"),
    remotePath String,
    scope @enum("org", "user"),
    syncIntervalMin Int @default(60),
    syncEnabled Boolean @default(true),
    retentionPolicy @enum("all", "count", "age") @default("all"),
    retentionValue Int @default(0),
    status @enum("awaiting_auth", "ready", "auth_revoked", "error"),
    externalConnectionId String,
    syncTimeoutMin Int @default(30),
    syncErrorCount Int @default(0),
    createdBy UUID,
    createdAt DateTime @default(now()),
    updatedAt DateTime @default(now()),
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read]),
        (allow: [read, update], where: auth.user = this.createdBy)
    ],
    @meta {"audit": true}
}
```

#### KnowledgeDocument

A document ingested from a cloud connection.

```
entity KnowledgeDocument {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    connectionId UUID @indexed,
    title String,
    remotePath String,
    fileName String,
    fileType @enum("pdf", "markdown", "text", "docx", "html", "unknown") @default("unknown"),
    sizeBytes Int,
    currentVersion Int @default(1),
    isDeleted Boolean @default(false),
    remoteCreatedAt DateTime @optional,
    remoteCreatedBy String @optional,
    remoteModifiedAt DateTime @optional,
    remoteModifiedBy String @optional,
    lastSyncedAt DateTime,
    createdAt DateTime @default(now()),
    updatedAt DateTime @default(now()),
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read])
    ],
    @meta {"audit": true}
}
```

#### DocumentVersion

Immutable record of each version of a synced file.

```
entity DocumentVersion {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    documentId UUID @indexed,
    version Int,
    sizeBytes Int,
    remoteModifiedAt DateTime,
    syncedAt DateTime @default(now()),
    syncJobId UUID,
    changeType @enum("added", "modified"),
    contentHash String,
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read])
    ]
}
```

**Unique constraint:** `(documentId, version)`

#### VersionLock

Tracks which document versions are actively in use by consumers, preventing retention cleanup from deleting them.

```
entity VersionLock {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    documentVersionId UUID @indexed,
    consumerId String,
    lockedAt DateTime @default(now()),
    releasedAt DateTime @optional,
    @rbac [
        (roles: [admin], allow: [create, read, update, delete]),
        (roles: [member], allow: [create, read, update])
    ]
}
```

**Constraint:** Retention cleanup skips any DocumentVersion where an active lock exists (`releasedAt IS NULL`).

#### SyncJob

Tracks sync execution history per connection.

```
entity SyncJob {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    connectionId UUID @indexed,
    status @enum("pending", "in_progress", "completed", "failed"),
    trigger @enum("scheduled", "manual"),
    stagingPath String @optional,
    startedAt DateTime,
    completedAt DateTime @optional,
    filesAdded Int @default(0),
    filesUpdated Int @default(0),
    filesDeleted Int @default(0),
    versionsCreated Int @default(0),
    versionsCleaned Int @default(0),
    errorMessage String @optional,
    @rbac [
        (roles: [admin], allow: [create, read, update, delete]),
        (roles: [member], allow: [read])
    ]
}
```

#### SyncChangelog

Records each file change detected after a sync. Created by comparing staging files against existing `KnowledgeDocument` records in the DB. Each entry tracks its own processing status for resumability.

```
entity SyncChangelog {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    syncJobId UUID @indexed,
    connectionId UUID @indexed,
    filePath String,
    fileName String,
    changeType @enum("added", "modified", "deleted"),
    sizeBytes Int @optional,
    contentHash String @optional,
    remoteCreatedAt DateTime @optional,
    remoteCreatedBy String @optional,
    remoteModifiedAt DateTime @optional,
    remoteModifiedBy String @optional,
    status @enum("pending", "processed", "failed") @default("pending"),
    @rbac [
        (roles: [admin], allow: [create, read, update, delete]),
        (roles: [member], allow: [read])
    ]
}
```

- `status`: entries are created as `"pending"`, then marked `"processed"` or `"failed"` by the version management workflow
- `changeType`: `"added"` = file in staging but no matching KnowledgeDocument, `"modified"` = file in staging with different `remoteModifiedAt`, `"deleted"` = KnowledgeDocument exists but file not in staging

#### Topic

A grouping mechanism for knowledge documents. Topics can be user-defined (manual) or automatically curated (auto).

```
entity Topic {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    name String,
    description String @optional,
    type @enum("manual", "auto") @default("manual"),
    curatedBy String @optional,
    documentCount Int @default(0),
    createdBy UUID,
    createdAt DateTime @default(now()),
    updatedAt DateTime @default(now()),
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read, create]),
        (allow: [update, delete], where: auth.user = this.createdBy)
    ],
    @meta {"audit": true}
}
```

- `type`: `"manual"` for user-created topics, `"auto"` for system-generated topics
- `curatedBy`: for auto topics, identifies the curation source (e.g., `"filetype:pdf"`, `"connection:conn_abc"`, `"ai:classification"`)
- `documentCount`: denormalized count for display

#### TopicDocument

Join entity linking topics to documents (many-to-many).

```
entity TopicDocument {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    topicId UUID @indexed,
    documentId UUID @indexed,
    addedBy UUID,
    addedAt DateTime @default(now()),
    @rbac [
        (roles: [admin], allow: [create, read, delete]),
        (roles: [member], allow: [create, read, delete])
    ]
}
```

**Unique constraint:** `(topicId, documentId)`

### Entity Relationships

```
Config (standalone singleton — service-wide defaults)

TenantConfig ──── 1:1 ──── Tenant (from agentlang.auth)
     │
Connection ────── N:1 ──── Tenant
     │
     ├──── 1:N ──── KnowledgeDocument
     │                   │
     │                   ├──── 1:N ──── DocumentVersion
     │                   │                   │
     │                   │                   └──── 1:N ──── VersionLock
     │                   │
     │                   └──── M:N ──── Topic (via TopicDocument)
     │
     └──── 1:N ──── SyncJob
                          │
                          └──── 1:N ──── SyncChangelog
```

### Indexes

| Entity            | Index                             | Purpose                                         |
| ----------------- | --------------------------------- | ----------------------------------------------- |
| Connection        | `(tenantId, provider)`            | List connections by provider within tenant      |
| Connection        | `(tenantId, status)`              | Find connections needing re-auth                |
| KnowledgeDocument | `(tenantId, connectionId)`        | List documents per connection                   |
| KnowledgeDocument | `(tenantId, title)`               | Title-based lookup                              |
| KnowledgeDocument | `(tenantId, isDeleted)`           | Filter out soft-deleted documents               |
| DocumentVersion   | `(documentId, version)` UNIQUE    | Version lookup                                  |
| DocumentVersion   | `(syncJobId)`                     | Trace versions back to sync job                 |
| VersionLock       | `(documentVersionId, releasedAt)` | Find active locks for retention check           |
| Topic             | `(tenantId, type)`                | List topics by type within tenant               |
| Topic             | `(tenantId, name)`                | Name-based lookup                               |
| TopicDocument     | `(topicId, documentId)` UNIQUE    | Prevent duplicate assignments                   |
| TopicDocument     | `(documentId)`                    | Find all topics for a document                  |
| SyncJob           | `(connectionId, status)`          | Check for in-progress sync (prevent concurrent) |
| SyncChangelog     | `(syncJobId, status)`             | Find pending entries for processing             |
| SyncChangelog     | `(connectionId)`                  | List changes per connection                     |

---

## 5. API Design

All endpoints are tenant-scoped. The tenant is resolved from the authenticated user's session via agentlang's `getTenantIdForUserDomain()`.

Base path: `/api/v1/knowledge`

### Connection Management

```
POST   /api/v1/knowledge/connections
GET    /api/v1/knowledge/connections
GET    /api/v1/knowledge/connections/:id
PATCH  /api/v1/knowledge/connections/:id
DELETE /api/v1/knowledge/connections/:id
```

#### POST /api/v1/knowledge/connections

Create a new cloud storage connection for the tenant.

**Request:**

```json
{
  "name": "Engineering Dropbox",
  "provider": "dropbox",
  "clientId": "abc123...",
  "clientSecret": "secret...",
  "remotePath": "/Shared/Knowledge",
  "scope": "org",
  "syncIntervalMin": 60,
  "retentionPolicy": "count",
  "retentionValue": 10
}
```

**Response:** `201 Created`

```json
{
  "id": "conn_abc123",
  "tenantId": "tenant_xyz",
  "name": "Engineering Dropbox",
  "provider": "dropbox",
  "remotePath": "/Shared/Knowledge",
  "scope": "org",
  "syncIntervalMin": 60,
  "status": "awaiting_auth"
}
```

**Implementation:** Validates tenant quota (maxConnections), creates a Connection entity, then calls rclone RC `config/create` to register the remote.

### OAuth Flow

```
GET    /api/v1/knowledge/connections/:id/auth-url
GET    /api/v1/knowledge/connections/:id/oauth/callback
GET    /api/v1/knowledge/connections/:id/auth-status
```

Proxied to rclone's OAuth flow. On successful OAuth callback, the Connection status transitions from `awaiting_auth` to `ready`.

### File Operations

```
GET    /api/v1/knowledge/connections/:id/files?path=/&page=1&limit=50
GET    /api/v1/knowledge/connections/:id/files/download?path=/docs/readme.pdf&version=3
GET    /api/v1/knowledge/connections/:id/files/versions?path=/docs/readme.pdf
```

Proxied to rclone via `operations/list` and `operations/copyfile`. Calls are forwarded using the rclone remote name.

### Sync Operations

```
POST   /api/v1/knowledge/connections/:id/sync
GET    /api/v1/knowledge/connections/:id/sync/status
GET    /api/v1/knowledge/connections/:id/sync/history?page=1&limit=20
```

#### POST /api/v1/knowledge/connections/:id/sync

Triggers an on-demand sync.

**Response:** `202 Accepted`

```json
{
  "jobId": "sync_xyz789",
  "status": "pending"
}
```

**Implementation:**

1. Check for existing in-progress sync (advisory lock on connectionId)
2. Create SyncJob record
3. Sync phase: call rclone RC `sync/copy` to pull changed files into staging
4. Changelog phase: scan staging via `StagingFile` resolver, compare against `KnowledgeDocument` DB records to detect added/modified/deleted, persist `SyncChangelog` entries
5. Version management: `processChangelog` processes pending entries — copies files to versioned store, creates/updates `KnowledgeDocument` and `DocumentVersion` records

### Version Management

```
GET    /api/v1/knowledge/documents/:docId/versions
POST   /api/v1/knowledge/documents/:docId/versions/:version/lock
DELETE /api/v1/knowledge/documents/:docId/versions/locks/:lockId
GET    /api/v1/knowledge/documents/:docId/versions/locks
```

#### POST /api/v1/knowledge/documents/:docId/versions/:version/lock

Lock a specific version to prevent retention cleanup.

**Request:**

```json
{
  "consumerId": "agent_workflow_abc"
}
```

**Response:** `201 Created`

```json
{
  "lockId": "lock_xyz",
  "documentId": "doc_123",
  "version": 2,
  "consumerId": "agent_workflow_abc",
  "lockedAt": "2026-02-20T10:05:00Z"
}
```

### Document Listing

```
GET    /api/v1/knowledge/documents?connectionId=...&page=1&limit=20
GET    /api/v1/knowledge/documents/:docId
```

List and retrieve document metadata within the tenant. Supports filtering by `connectionId`, `fileType`, and `isDeleted`.

### Topic Management

```
POST   /api/v1/knowledge/topics
GET    /api/v1/knowledge/topics
GET    /api/v1/knowledge/topics/:id
PATCH  /api/v1/knowledge/topics/:id
DELETE /api/v1/knowledge/topics/:id
POST   /api/v1/knowledge/topics/:id/documents
DELETE /api/v1/knowledge/topics/:id/documents/:docId
GET    /api/v1/knowledge/topics/:id/documents?page=1&limit=20
```

#### POST /api/v1/knowledge/topics

Create a new topic.

**Request:**

```json
{
  "name": "Product Specifications",
  "description": "All product spec documents across connections",
  "type": "manual"
}
```

**Response:** `201 Created`

```json
{
  "id": "topic_abc123",
  "tenantId": "tenant_xyz",
  "name": "Product Specifications",
  "description": "All product spec documents across connections",
  "type": "manual",
  "documentCount": 0,
  "createdBy": "user_456",
  "createdAt": "2026-02-20T10:00:00Z"
}
```

#### POST /api/v1/knowledge/topics/:id/documents

Add a document to a topic.

**Request:**

```json
{
  "documentId": "doc_789"
}
```

**Response:** `201 Created`

```json
{
  "id": "td_xyz",
  "topicId": "topic_abc123",
  "documentId": "doc_789",
  "addedBy": "user_456",
  "addedAt": "2026-02-20T10:05:00Z"
}
```

**Implementation:** Creates a TopicDocument join record and increments the Topic's `documentCount`. The unique constraint on `(topicId, documentId)` prevents duplicate assignments.

---

## 6. rclone Integration

The Knowledge service communicates with cloud storage providers through [rclone's RC (Remote Control) API](https://rclone.org/rc/). rclone runs as a daemon (`rclone rcd`) and exposes an HTTP API for managing remotes, listing files, and syncing directories. The Knowledge service calls this API via a custom agentlang resolver.

### Resolver Definition

A `CloudFileProxy` entity acts as the interface to rclone. The `action` field selects the operation, and `remoteName` maps to an rclone remote configured via `config/create`:

```
entity CloudFileProxy {
    action String,
    remoteName String,
    remotePath String,
    dstPath String @optional,
    providerType String @optional,
    providerConfig String @optional,
    stagingPath String @optional,
    syncStatus String @optional,
    errorMessage String @optional,
    errorIncrement Int @optional
}

resolver cloudFileResolver [knowledge.core/CloudFileProxy] {
    query r.queryCloudFiles,
    create r.createCloudFileOp
}
```

### Staging File Scanner

After rclone `sync/copy` pulls files into the staging directory, a `StagingFile` resolver-backed entity scans the local staging filesystem and returns one entry per file. The `syncConnection` workflow then compares these against `KnowledgeDocument` records in the DB to build the changelog:

```
entity StagingFile {
    remoteName String,
    filePath String,
    fileName String,
    sizeBytes Int,
    remoteModifiedAt DateTime
}

resolver stagingFileResolver [knowledge.core/StagingFile] {
    query r.scanStagingFiles
}
```

The resolver reads `stagingDir` from the Config entity (falling back to the `STAGING_DIR` env var, then a hardcoded default), walks `stagingDir/remoteName` recursively, and returns file metadata. rclone preserves remote modification times as local `mtime`, so `remoteModifiedAt` comes from `statSync`. The optional `filePath` query filter supports the deletion check (querying for a specific file path to see if it exists in staging).

### Version Store

After the changelog detects added or modified files, the `processChangelog` workflow copies each file from the staging directory into an immutable versioned store via the `VersionStore` resolver:

```
entity VersionStore {
    remoteName String,
    filePath String,
    remoteModifiedAt String,
    storagePath String @optional,
    contentHash String @optional
}

resolver versionStoreResolver [knowledge.core/VersionStore] {
    create r.storeVersion
}
```

**Storage layout:** `storeDir/{remoteName}/{filePath}/{sanitized-timestamp}` (where `storeDir` is read from Config entity)

The resolver:

1. Sanitizes the `remoteModifiedAt` timestamp (replaces `:` with `-`) for safe filesystem paths
2. Copies the staging file to the versioned store directory
3. Computes an MD5 content hash of the stored file
4. Returns `storagePath` and `contentHash` on the instance

### rclone RC Endpoints Used

| Action (query) | rclone endpoint   | Purpose                               |
| -------------- | ----------------- | ------------------------------------- |
| `list`         | `operations/list` | List files at `remoteName:remotePath` |
| `stat`         | `operations/stat` | Get metadata for a single path        |
| `health`       | `rc/noop`         | Confirm the rclone daemon is alive    |

| Action (create) | rclone endpoint       | Purpose                                 |
| --------------- | --------------------- | --------------------------------------- |
| `create-remote` | `config/create`       | Register a new rclone remote            |
| `delete-remote` | `config/delete`       | Remove a remote from rclone config      |
| `copyfile`      | `operations/copyfile` | Download a single file to local staging |
| `sync`          | `sync/copy`           | One-way sync from remote dir to staging |

### Resolver Implementation

All rclone RC calls are `POST` with a JSON body. The resolver reads operational configuration (`rcloneRcUrl`, `stagingDir`, `storeDir`) from the Config entity at runtime via `agentlang.fetchConfig('knowledge.core/Config')`, falling back to environment variables, then hardcoded defaults. Sensitive credentials (`RCLONE_RC_USER`, `RCLONE_RC_PASS`) remain as environment variables only:

```javascript
const RCLONE_RC_USER = process.env.RCLONE_RC_USER || '';
const RCLONE_RC_PASS = process.env.RCLONE_RC_PASS || '';

// Read Config entity at runtime, fall back to env vars, then hardcoded defaults.
async function getConfig() {
  const config = await agentlang.fetchConfig('knowledge.core/Config');
  return {
    rcloneRcUrl: config?.rcloneRcUrl || process.env.RCLONE_RC_URL || 'http://localhost:5572',
    stagingDir: config?.stagingDir || process.env.STAGING_DIR || `${homedir()}/.agentlang/studio/.knowledge_staging`,
    storeDir: config?.storeDir || process.env.STORE_DIR || `${homedir()}/.agentlang/studio/.knowledge_store`,
  };
}

// Query resolver — read-only operations
export async function queryCloudFiles(ctx, inst) {
  const cfg = await getConfig();
  const action = inst.getQueryValue('action');
  switch (action) {
    case 'list':
      return rc(cfg.rcloneRcUrl, 'operations/list', { fs: `${remoteName}:`, remote: remotePath });
    case 'stat':
      return rc(cfg.rcloneRcUrl, 'operations/stat', { fs: `${remoteName}:`, remote: remotePath });
    case 'health':
      return rc(cfg.rcloneRcUrl, 'rc/noop', { ping: 'knowledge-service' });
  }
}

// Create resolver — mutating operations
export async function createCloudFileOp(ctx, inst) {
  const cfg = await getConfig();
  const action = inst.lookup('action');
  switch (action) {
    case 'create-remote': ...
    case 'delete-remote': ...
    case 'copyfile': ...
    case 'sync': {
      // Stable staging dir per remote. Catches errors internally,
      // returns syncStatus and errorIncrement on the instance.
      const stagingPath = `${cfg.stagingDir}/${remoteName}`;
      try {
        await rc(cfg.rcloneRcUrl, 'sync/copy', { srcFs: `${remoteName}:${remotePath}`, dstFs: stagingPath });
        inst.attributes.set('syncStatus', 'completed');
        inst.attributes.set('errorIncrement', 0);
      } catch (err) {
        console.error(`[knowledge] sync failed for ${remoteName}:${remotePath} — ${err.message}`);
        inst.attributes.set('syncStatus', 'failed');
        inst.attributes.set('errorMessage', err.message);
        inst.attributes.set('errorIncrement', 1);
      }
      inst.attributes.set('stagingPath', stagingPath);
      return inst;
    }
  }
}
```

### Connection Lifecycle

```
                ┌─────────────────┐
                │  awaiting_auth   │
                │  (created, no    │
                │   OAuth yet)     │
                └────────┬────────┘
                         │ OAuth callback success
                         ▼
                ┌─────────────────┐
          ┌────>│     ready        │<────┐
          │     │  (authenticated, │     │
          │     │   can sync)      │     │
          │     └────────┬────────┘     │
          │              │               │
          │   Token expired/   Re-auth   │
          │   revoked          success   │
          │              │               │
          │              ▼               │
          │     ┌─────────────────┐      │
          │     │  auth_revoked    │──────┘
          │     │  (needs re-auth) │
          │     └─────────────────┘
          │
          │ Error resolved
          │
          │     ┌─────────────────┐
          └─────│     error        │
                │  (sync failure,  │
                │   config issue)  │
                └─────────────────┘
```

### Sync Scheduling and Execution

The sync scheduler uses agentlang's built-in `agentlang/timer` to fire a `syncTick` workflow at a configurable interval (default 60 seconds, read from `Config.syncSchedulerIntervalSec`):

```
// Timer callback. Prune stale jobs per-connection, then trigger syncs.
workflow syncTick {
    // Step 1: For each connection, prune stale in_progress jobs using
    // that connection's syncTimeoutMin. Bump syncErrorCount on prune.
    for conn in {Connection {}} {
        now() - conn.syncTimeoutMin * 60000 @as cutoff;
        for staleJob in {SyncJob {connectionId? conn.id,
                                  status? "in_progress",
                                  startedAt?< cutoff}} {
            {SyncJob {id? staleJob.id, status "failed",
                      errorMessage "timed out", completedAt now()}};
            {Connection {id? conn.id, syncErrorCount syncErrorCount + 1}}
        }
    };

    // Step 2: For each ready connection with no in_progress job, trigger sync.
    for conn in {Connection {syncEnabled? true, status? "ready"}} {
        {SyncJob {connectionId? conn.id, status? "in_progress"}}
            @empty {syncConnection {connectionId conn.id,
                                    tenantId conn.tenantId,
                                    remoteName conn.externalConnectionId,
                                    remotePath conn.remotePath}}
    }
}

// Full sync lifecycle for one connection:
// 1. Create SyncJob (in_progress)
// 2. Sync files via rclone sync/copy
// 3. Scan staging and compare against DB to build changelog
// 4. Process changelog entries into KnowledgeDocument/DocumentVersion
// 5. Update SyncJob, bump syncErrorCount on Connection
workflow syncConnection {
    {SyncJob {connectionId syncConnection.connectionId,
              tenantId syncConnection.tenantId,
              status "in_progress", trigger "scheduled",
              startedAt now()}} @as [job];

    // Sync the actual files first.
    {CloudFileProxy {action "sync",
                     remoteName syncConnection.remoteName,
                     remotePath syncConnection.remotePath}} @as [result];

    // Detect added files: in staging but no matching KnowledgeDocument.
    for file in {StagingFile {remoteName? syncConnection.remoteName}} {
        {KnowledgeDocument {connectionId? syncConnection.connectionId,
                            remotePath? file.filePath,
                            isDeleted? false}}
            @empty {SyncChangelog {syncJobId job.id,
                                   connectionId syncConnection.connectionId,
                                   tenantId syncConnection.tenantId,
                                   filePath file.filePath,
                                   fileName file.fileName,
                                   changeType "added",
                                   sizeBytes file.sizeBytes,
                                   remoteModifiedAt file.remoteModifiedAt,
                                   status "pending"}}
    };

    // Detect modified files: in staging with different remoteModifiedAt.
    for file in {StagingFile {remoteName? syncConnection.remoteName}} {
        for doc in {KnowledgeDocument {connectionId? syncConnection.connectionId,
                                       remotePath? file.filePath,
                                       isDeleted? false,
                                       remoteModifiedAt?<> file.remoteModifiedAt}} {
            {SyncChangelog {syncJobId job.id,
                            connectionId syncConnection.connectionId,
                            tenantId syncConnection.tenantId,
                            filePath file.filePath,
                            fileName file.fileName,
                            changeType "modified",
                            sizeBytes file.sizeBytes,
                            remoteModifiedAt file.remoteModifiedAt,
                            status "pending"}}
        }
    };

    // Detect deleted files: KnowledgeDocument exists but not in staging.
    for doc in {KnowledgeDocument {connectionId? syncConnection.connectionId,
                                    isDeleted? false}} {
        {StagingFile {remoteName? syncConnection.remoteName,
                      filePath? doc.remotePath}}
            @empty {SyncChangelog {syncJobId job.id,
                                   connectionId syncConnection.connectionId,
                                   tenantId syncConnection.tenantId,
                                   filePath doc.remotePath,
                                   fileName doc.fileName,
                                   changeType "deleted",
                                   status "pending"}}
    };

    // Process changelog entries into KnowledgeDocument/DocumentVersion records.
    {processChangelog {syncJobId job.id,
                       tenantId syncConnection.tenantId,
                       connectionId syncConnection.connectionId,
                       remoteName syncConnection.remoteName}};

    // Update SyncJob and bump Connection error count.
    {SyncJob {id? job.id,
              status result.syncStatus,
              stagingPath result.stagingPath,
              errorMessage result.errorMessage,
              completedAt now()}};
    {Connection {id? syncConnection.connectionId,
                 syncErrorCount syncErrorCount + result.errorIncrement}}
}

// Start/stop the scheduler.
// Query for Config singleton; if none exists, create one with @default values.
// Use its syncSchedulerIntervalSec for the timer duration.
@public workflow startSyncScheduler {
    {Config {}} @empty {Config {}} @as [config];
    {agentlang/timer {name "sync-scheduler", duration config.syncSchedulerIntervalSec,
                      unit "second", trigger "knowledge.core/syncTick"}}
}

@public workflow stopSyncScheduler {
    delete {agentlang/timer {name? "sync-scheduler"}}
}
```

Execution flow:

1. **Timer fires** — `syncTick` runs every `Config.syncSchedulerIntervalSec` seconds (default 60)
2. **Per-connection stale pruning** — for each connection, a cutoff timestamp is computed using DSL arithmetic: `now() - conn.syncTimeoutMin * 60000`. Any `in_progress` SyncJob with `startedAt` before the cutoff is marked `failed` with error "timed out", and the connection's `syncErrorCount` is incremented. This unblocks connections whose syncs hung or crashed
3. **Concurrency guard** — for each ready connection, queries for an existing `in_progress` SyncJob; `@empty` ensures `syncConnection` only runs if no sync is already active
4. **SyncJob created** — `syncConnection` creates a SyncJob with status `in_progress` and captures it
5. **rclone sync** — the `CloudFileProxy` resolver reads `stagingDir` from the Config entity and uses a stable per-remote staging directory (`stagingDir/remoteName`) so rclone can perform incremental syncs, calls `sync/copy`, catches errors internally (logging failures to stderr), and returns `stagingPath`, `syncStatus` ("completed" or "failed"), `errorMessage`, and `errorIncrement` (0 or 1) on the instance
6. **Changelog — added** — the `StagingFile` resolver walks the staging directory. For each file, the workflow checks if a matching `KnowledgeDocument` exists (by `connectionId` + `remotePath` + `isDeleted: false`). If `@empty` (no match), a `SyncChangelog` entry with `changeType: "added"` is created
7. **Changelog — modified** — for each staging file, the workflow queries `KnowledgeDocument` with `remoteModifiedAt?<>` (not equal to the staging file's mtime). If a doc is found with a different timestamp, a `SyncChangelog` entry with `changeType: "modified"` is created
8. **Changelog — deleted** — for each non-deleted `KnowledgeDocument` in the DB, the workflow queries `StagingFile` with `filePath? doc.remotePath`. If `@empty` (file no longer in staging), a `SyncChangelog` entry with `changeType: "deleted"` is created
9. **Version management — added** — the `processChangelog` workflow iterates over pending `SyncChangelog` entries with `changeType: "added"`. For each: copies the staging file to the versioned store via `VersionStore` resolver (`storeDir/{remoteName}/{filePath}/{sanitized-timestamp}`), creates a `KnowledgeDocument` (version 1, title = fileName), creates a `DocumentVersion` (version 1, changeType "added", contentHash from store), marks the changelog entry "processed", and increments `SyncJob.filesAdded` and `versionsCreated`
10. **Version management — modified** — for each pending "modified" entry: copies file to store, finds the existing `KnowledgeDocument` and bumps `currentVersion`, updates `sizeBytes`, `remoteModifiedAt`, and `lastSyncedAt`, creates a new `DocumentVersion` (version = doc.currentVersion + 1), marks entry "processed", increments `SyncJob.filesUpdated` and `versionsCreated`
11. **Version management — deleted** — for each pending "deleted" entry: soft-deletes the `KnowledgeDocument` (`isDeleted: true`, `lastSyncedAt: now()`), marks entry "processed", increments `SyncJob.filesDeleted`
12. **SyncJob updated** — the workflow writes the resolver's results back to the SyncJob: staging path, final status, error message (if any), and completion timestamp
13. **Error tracking** — `syncErrorCount` on the Connection is incremented by `errorIncrement` (0 for success, 1 for failure), providing a cumulative error counter for monitoring

### Error Handling and Retry

| Error Type            | Handling                                                                |
| --------------------- | ----------------------------------------------------------------------- |
| OAuth token expired   | rclone auto-refreshes; if refresh fails, mark connection `auth_revoked` |
| Provider rate limit   | Exponential backoff with jitter, max 3 retries per sync                 |
| Network timeout       | Retry once, then mark SyncJob as `failed`                               |
| File download failure | Skip file, log error, continue with remaining files                     |
| rclone daemon crash   | Restart daemon; remotes recovered from persisted rclone config          |

---

## 7. Scalability & Performance

### Horizontal Scaling

The Knowledge service is stateless — all state lives in PostgreSQL. Multiple instances can run behind a load balancer.

```
                    ┌─────────────────┐
                    │  Load Balancer   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
     │ Knowledge    │ │ Knowledge    │ │ Knowledge    │
     │ Service #1   │ │ Service #2   │ │ Service #3   │
     └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
            │               │               │
            └───────────────┼───────────────┘
                            ▼
                    ┌─────────────────┐
                    │   PostgreSQL     │
                    │                  │
                    └─────────────────┘
```

**Sync coordination:** Only one instance should run the sync scheduler. Use PostgreSQL advisory locks (`pg_try_advisory_lock(connectionId)`) so that only one instance processes a given connection's sync at a time.

### Caching

| Cache                | Strategy                                                          | TTL        |
| -------------------- | ----------------------------------------------------------------- | ---------- |
| Connection metadata  | In-memory cache of Connection entity (name, provider, status)     | 1 minute   |
| Tenant config        | In-memory cache of TenantConfig                                   | 5 minutes  |
| File listing results | Optional response cache keyed by `(tenantId, connectionId, path)` | 30 seconds |

### Sync Concurrency Controls

- **Advisory locks** — `SELECT pg_try_advisory_lock(hashtext(connectionId))` before starting sync; skip if lock held
- **SyncJob status check** — reject manual sync trigger if an `in_progress` job exists for the connection
- **Connection-level throttle** — max 1 concurrent sync per connection, max N concurrent syncs per tenant (configurable)

---

## 8. Security

### Tenant Isolation Enforcement

Tenant isolation is enforced at every layer:

| Layer        | Mechanism                                                                 |
| ------------ | ------------------------------------------------------------------------- |
| **API**      | Tenant resolved from authenticated session; all queries scoped to tenant  |
| **RBAC**     | `@rbac` rules on every entity; `where: auth.user` for owner-scoped access |
| **Database** | `tenantId` column on all entities                                         |
| **rclone**   | Remote names are tenant-scoped; OAuth tokens are per-remote               |

Cross-tenant access is impossible at the query layer because agentlang's `SqlDbResolver` automatically injects tenant filtering from the authenticated context.

### Credential Security

| Credential                  | Protection                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| OAuth client secrets        | Stored in rclone config; encrypt rclone.conf at rest                                      |
| OAuth access/refresh tokens | AES-256 encryption at rest, auto-refresh on expiry                                        |
| Encryption key              | Stored in secrets manager (Vault, AWS Secrets Manager), injected via environment variable |
| API authentication tokens   | JWT validated by agentlang's `verifySession()`, supports Cognito                          |
| Database credentials        | Environment variables, never in code or config files                                      |

### RBAC on All Entities

Every entity declares explicit RBAC rules:

```
@rbac [
    (roles: [admin], allow: [create, update, delete]),
    (roles: [member], allow: [read]),
    (allow: [read, update], where: auth.user = this.createdBy)
]
```

Permission checks are enforced in `SqlDbResolver` via `checkUserPerm()`:

1. Get user's roles via `findUserRoles(userId)`
2. Check `RolePermissionsCache` for matching permission on the resource
3. For `where` clauses: compare entity field value against `auth.user`
4. Ownership auto-granted on creation via `createOwnership()`

### Document Access Control

Access is layered:

1. **Tenant level** — user must belong to the document's tenant
2. **Connection level** — user must have read access to the connection (RBAC)
3. **User-scoped connections** — `scope: "user"` connections restrict access to the authenticating user via `where: auth.user = this.createdBy`
4. **Document level** — KnowledgeDocument inherits connection's tenant and is subject to RBAC
5. **Topic level** — Topics are tenant-scoped; members can read and create manual topics; only admins or the topic creator can update/delete

### Audit Trail

Entities marked with `@meta {"audit": true}` automatically log all mutations:

```
entity auditlog {
    id UUID,
    action @enum("c", "d", "u"),   // Create, Delete, Update
    resource String,                // Entity __path__
    timestamp DateTime,
    diff Any,                       // Change details
    user String,
    token String
}
```

Audited entities: `TenantConfig`, `Connection`, `KnowledgeDocument`, `Topic`.

---

## 9. Deployment

### Container Topology

```
┌────────────────────────────────────────────────────────────────┐
│  Pod / Docker Compose                                          │
│                                                                │
│  ┌──────────────────────┐    ┌──────────────────────────────┐  │
│  │  Knowledge Service    │    │  rclone daemon (sidecar)      │  │
│  │  (agentlang app)     │    │  Port: 5572 (internal)        │  │
│  │  Port: 3000           │    │                              │  │
│  │                      │    │  Volumes:                    │  │
│  │  Env:                │    │  - /config/rclone            │  │
│  │  - DATABASE_URL      │    │  - /staging                  │  │
│  │  - RCLONE_RC_USER    │    │                              │  │
│  │  - RCLONE_RC_PASS    │    │                              │  │
│  │  - AUTH_ENABLED      │    │                              │  │
│  │  - RBAC_ENABLED      │    │                              │  │
│  └──────────────────────┘    └──────────────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  PostgreSQL 16                                             │  │
│  │  Port: 5432                                               │  │
│  │  Database: knowledge_service                              │  │
│  │  Volume: /var/lib/postgresql/data                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Environment Configuration

#### Knowledge Service

| Variable         | Description                                            | Default                                  |
| ---------------- | ------------------------------------------------------ | ---------------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection string                           | required                                 |
| `RCLONE_RC_URL`  | rclone daemon RC API URL (fallback if Config not set)  | `http://localhost:5572`                  |
| `RCLONE_RC_USER` | rclone RC auth user (sensitive — env var only)         | (none)                                   |
| `RCLONE_RC_PASS` | rclone RC auth password (sensitive — env var only)     | (none)                                   |
| `STAGING_DIR`    | Local path for synced files (fallback if Config not set) | `~/.agentlang/studio/.knowledge_staging` |
| `STORE_DIR`      | Local path for versioned file store (fallback if Config not set) | `~/.agentlang/studio/.knowledge_store`   |
| `AUTH_ENABLED`   | Enable authentication                                  | `true`                                   |
| `RBAC_ENABLED`   | Enable RBAC enforcement                                | `true`                                   |

> **Note:** `rcloneRcUrl`, `stagingDir`, `storeDir`, `syncSchedulerIntervalSec`, and `maxConcurrentSyncsPerTenant` are now stored in the **Config entity**. The resolver reads Config first, then falls back to the corresponding env var (if any), then to a hardcoded default. Sensitive credentials (`RCLONE_RC_USER`, `RCLONE_RC_PASS`) remain as env vars only.

#### rclone Daemon

| Variable    | Description      | Default  |
| ----------- | ---------------- | -------- |
| `--rc-addr` | Listen address   | `:5572`  |
| `--rc-user` | RC auth user     | required |
| `--rc-pass` | RC auth password | required |

### Health Checks

| Service           | Endpoint        | Checks                                       |
| ----------------- | --------------- | -------------------------------------------- |
| Knowledge Service | `GET /health`   | Database connection, rclone daemon reachable |
| rclone daemon     | `POST /rc/noop` | Daemon is running and accepting commands     |
| PostgreSQL        | TCP port 5432   | Accepting connections                        |

### Monitoring

| Metric                    | Source                    | Alert Threshold                              |
| ------------------------- | ------------------------- | -------------------------------------------- |
| Sync error count          | Connection.syncErrorCount | Cumulative errors rising; alert on threshold |
| Connection auth status    | Connection table          | Any connection in `auth_revoked` state       |
| Document count per tenant | KnowledgeDocument table   | Per-tenant quota approaching limit           |
| API latency (p95)         | Request middleware        | > 2s for sync trigger                        |
| Disk usage (staging)      | File system               | > 80% capacity                               |

### Production Deployment Notes

- **Kubernetes** — run rclone as a sidecar container in the Knowledge Service pod; RC API stays on localhost
- **Staging volume** — use ephemeral storage or object storage (S3) for file staging to support horizontal scaling
- **Database** — use a managed PostgreSQL service (AWS RDS, Cloud SQL, or Neon)
- **Secrets** — inject `RCLONE_RC_PASS` and database credentials via secrets manager
- **Sync scheduler** — use leader election (Kubernetes lease or PostgreSQL advisory lock) so only one instance runs the scheduler
- **Backup** — regular PostgreSQL backups; staging files are transient and reconstructable from cloud sources
