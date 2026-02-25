# Dracula Knowledge Document - Memory System Documentation

## Overview

This document describes how the Dracula example uses Agentlang's `KnowledgeService` to process Bram Stoker's novel and enable intelligent query responses. The system operates in one of two modes depending on configuration:

- **Local mode**: Chunks text, generates embeddings, stores in LanceDB/pgvector, and performs vector similarity search — all within the agentlang-cli process.
- **Remote mode**: Delegates document processing and retrieval to a deployed knowledge-service via HTTP.

---

## Mode Selection

The `KnowledgeService` constructor determines the mode at startup:

```typescript
// src/runtime/knowledge/service.ts
constructor() {
  const kgConfig = getKnowledgeGraphConfig();
  const configuredServiceUrl = kgConfig?.serviceUrl?.trim();
  this.remoteKnowledgeServiceUrl =
    configuredServiceUrl || process.env.KNOWLEDGE_SERVICE_URL || null;

  if (this.remoteKnowledgeServiceUrl) {
    this.mode = 'remote';
  } else {
    this.mode = 'local';
  }
}
```

| Condition | Mode | Vector Backend |
| --- | --- | --- |
| No `serviceUrl`, no `KNOWLEDGE_SERVICE_URL` | Local | LanceDB (sqlite) or pgvector (postgres) |
| `serviceUrl` or `KNOWLEDGE_SERVICE_URL` set | Remote | Handled by knowledge-service |

---

## Local Mode (agentlang-cli)

### Configuration

```json
{
  "agentlang": {
    "store": { "type": "sqlite", "dbname": "dracula.db" },
    "vectorStore": { "type": "lancedb" }
  }
}
```

No `knowledgeGraph.serviceUrl` — the service defaults to local mode.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LOCAL MODE FLOW                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Input: dracula.txt (~870KB, public domain)                        │
│       ↓                                                             │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  INGESTION PIPELINE (lazy, on first query)                  │     │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │     │
│  │  │ Text Chunk   │ → │ Generate     │ → │ Store in     │   │     │
│  │  │ (1000+200)   │   │ Embeddings   │   │ LanceDB      │   │     │
│  │  │              │   │ (1536-dim)   │   │              │   │     │
│  │  └──────────────┘   └──────────────┘   └──────────────┘   │     │
│  └────────────────────────────────────────────────────────────┘     │
│       ↓                                                             │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  QUERY RETRIEVAL                                             │     │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │     │
│  │  │ Embed Query  │ → │ Vector       │ → │ Return Top-k │   │     │
│  │  │ (same model) │   │ Similarity   │   │ Chunks       │   │     │
│  │  │              │   │ Search       │   │              │   │     │
│  │  └──────────────┘   └──────────────┘   └──────────────┘   │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Startup Flow

```typescript
// src/cli/main.ts
export async function runPostInitTasks(appSpec, config) {
  await initDatabase(config?.store); // dracula.db (SQLite)

  // Initialize knowledge service singleton (local mode)
  getKnowledgeService();
  // No pre-processing — documents are processed lazily
}
```

### Lazy Document Processing

Documents are NOT pre-processed at startup. Processing is triggered when the agent first receives a message:

```typescript
// src/runtime/modules/ai.ts — maybeAddRelevantDocuments()
if (!knowledgeService.isRemote()) {
  for (const title of allDocumentTitles) {
    const url = aiModule.getDocument(title);
    if (url) {
      await knowledgeService.processLocalDocument(title, url);
    }
  }
}
```

```typescript
// src/runtime/knowledge/service.ts — processLocalDocument()
async processLocalDocument(title: string, url: string): Promise<void> {
  if (this.processedDocuments.has(title)) return; // skip if already done

  await this.ensureLocalInit(); // lazy init chunker, embeddings, vector store

  // 1. Read content from file or URL
  const content = readFileSync(pathResolve(url), 'utf-8');

  // 2. Split into chunks (1000 chars, 200 overlap)
  const chunks = this.chunker.splitText(content);

  // 3. Generate embeddings via OpenAI
  const embeddings = await this.embeddingProvider.embedTexts(chunks);

  // 4. Store in LanceDB (or pgvector)
  await this.storeLanceDBChunks(title, chunks, embeddings);

  this.processedDocuments.add(title);
}
```

### Local Query Flow

```typescript
// src/runtime/knowledge/service.ts — queryLocal()
async queryLocal(query, documentTitles, limit = 10) {
  // 1. Embed the query using the same model
  const queryEmbedding = await this.embeddingProvider.embedText(query);

  // 2. Search vector store for similar chunks
  const searchResults = await this.vectorStore.search(queryEmbedding, limit);

  // 3. Filter by document titles if specified
  // 4. Build context string from matched chunks
  return {
    entities: [],
    relationships: [],
    instanceData: results.map(r => ({ ... })),
    contextString: results.map(r => r.content).join('\n\n---\n\n'),
  };
}
```

### Vector Store Selection

```typescript
// src/runtime/knowledge/service.ts
function usePgvector(): boolean {
  if (AppConfig?.vectorStore?.type === 'pgvector') return true;
  if (AppConfig?.vectorStore?.type === 'lancedb') return false;
  return AppConfig?.store?.type === 'postgres'; // postgres store → pgvector
}
```

| Store Config | Vector Backend | Storage Location |
| --- | --- | --- |
| `sqlite` + `lancedb` | LanceDB | `./data/knowledge-vectors.lance` |
| `postgres` | pgvector | `knowledge_local_chunks` table |
| `postgres` + `lancedb` | LanceDB | `./data/knowledge-vectors.lance` |

---

## Remote Mode (Knowledge Service)

### Configuration

```json
{
  "agentlang": {
    "store": { "type": "sqlite", "dbname": "dracula.db" },
    "vectorStore": { "type": "lancedb" },
    "knowledgeGraph": {
      "serviceUrl": "#js process.env.KNOWLEDGE_SERVICE_URL || 'http://localhost:3000'"
    }
  }
}
```

Or via environment variable:

```bash
export KNOWLEDGE_SERVICE_URL=https://your-knowledge-service.example.com
```

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    REMOTE MODE FLOW                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  agentlang-cli                    knowledge-service                 │
│  ┌────────────┐                   ┌────────────────────────┐       │
│  │ Agent gets │   HTTP POST       │ /api/knowledge/query   │       │
│  │ a message  │ ─────────────────→│                        │       │
│  │            │                   │ • Document processing  │       │
│  │            │   JSON response   │ • Embedding + storage  │       │
│  │            │ ←─────────────────│ • Entity extraction    │       │
│  │            │                   │ • Graph traversal      │       │
│  │ Append     │                   │ • Context building     │       │
│  │ context    │                   └────────────────────────┘       │
│  │ to LLM    │                                                     │
│  └────────────┘                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Remote Query Flow

```typescript
// src/runtime/knowledge/service.ts — queryKnowledge() in remote mode
async queryKnowledge(query, containerTags, options) {
  // Primary endpoint
  let response = await fetch(`${serviceUrl}/api/knowledge/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, containerTags, ...options }),
  });

  // Fallback endpoint (agentlang-style)
  if (!response.ok) {
    response = await fetch(`${serviceUrl}/knowledge.core/ApiKnowledgeQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryText: query,
        containerTagsJson: JSON.stringify(containerTags),
        documentTitlesJson: JSON.stringify(options?.documentTitles || []),
        documentRefsJson: JSON.stringify(options?.documentRefs || []),
        optionsJson: JSON.stringify({ ... }),
      }),
    });
  }

  // Response includes entities, edges, chunks, contextString
  const payload = normalizeKnowledgeQueryPayload(await response.json());
  return {
    entities: payload.entities,
    relationships: payload.edges,
    instanceData: payload.chunks,
    contextString: payload.contextString,
  };
}
```

### Remote Response Format

The knowledge-service returns richer data than local mode:

```json
{
  "entities": [
    { "id": "...", "name": "Count Dracula", "entityType": "Person", "description": "..." }
  ],
  "edges": [
    { "sourceId": "...", "targetId": "...", "relationType": "TRAVELS_ON", "weight": 2.0 }
  ],
  "chunks": [
    { "id": "...", "content": "relevant text passage..." }
  ],
  "contextString": "## Knowledge Context\n..."
}
```

In remote mode, the knowledge-service can provide entity extraction, graph traversal, and structured context that goes beyond simple vector similarity search.

---

## Session Management

Both modes support session-based conversation history via the `KnowledgeSession` and `KnowledgeSessionMessage` entities:

```typescript
// src/runtime/knowledge/service.ts
await knowledgeService.createSession(sessionId, agentId, env);
await knowledgeService.addSessionMessage(ctx, 'user', message, env);
const history = await knowledgeService.getSessionMessages(ctx, env);
```

Sessions are stored in the application database (SQLite/Postgres) using the `agentlang.knowledge` module entities. Message count is capped at `MAX_KNOWLEDGE_SESSION_MESSAGES` (default: 100).

---

## Key Configuration

### Environment Variables

```bash
# Required
export AGENTLANG_OPENAI_KEY=sk-...

# Optional: Use remote knowledge-service instead of local processing
export KNOWLEDGE_SERVICE_URL=https://your-service.example.com

# Optional: Limit session messages (default: 100)
export MAX_KNOWLEDGE_SESSION_MESSAGES=100
```

---

## Code Reference Map

| Component              | File                                    | Purpose                    |
| ---------------------- | --------------------------------------- | -------------------------- |
| **CLI Entry**          | `src/cli/main.ts`                       | Startup orchestration      |
| **Knowledge Service**  | `src/runtime/knowledge/service.ts`      | Dual-mode service          |
| **AI Agent**           | `src/runtime/modules/ai.ts`             | Document context injection |
| **Text Chunking**      | `src/runtime/embeddings/chunker.ts`     | Split text into chunks     |
| **Embeddings**         | `src/runtime/embeddings/openai.ts`      | OpenAI embedding provider  |
| **LanceDB Store**      | `src/runtime/resolvers/vector/lancedb-store.ts` | Local vector storage |
| **Knowledge Module**   | `src/runtime/modules/knowledge.ts`      | Entity schema definitions  |
| **Config/State**       | `src/runtime/state.ts`                  | Configuration schema       |

---

## Summary

The Dracula example demonstrates both deployment modes:

**Local (agentlang-cli):**
1. Text → Chunks → OpenAI Embeddings → LanceDB/pgvector
2. Lazy processing on first query
3. Vector similarity search → Top-k chunks → Context augmentation

**Remote (knowledge-service):**
1. Queries forwarded to deployed knowledge-service via HTTP
2. Service handles embedding, entity extraction, graph traversal
3. Returns structured context (entities, relationships, chunks)

In both cases, the retrieved context is appended to the LLM prompt, enabling accurate answers grounded in the source text.

---
