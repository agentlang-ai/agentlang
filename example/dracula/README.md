# Dracula - Knowledge Document Example

This example demonstrates Agentlang's knowledge retrieval system by processing "Dracula" by Bram Stoker (1897, public domain via [Project Gutenberg](https://www.gutenberg.org/ebooks/345)).

The system supports two modes:

- **Local mode** (via `agentlang-cli`): Chunks, embeds, and stores documents locally using LanceDB or pgvector, then retrieves relevant context via vector similarity search.
- **Remote mode** (via knowledge-service): Delegates all document processing and retrieval to a deployed knowledge-service instance.

## Prerequisites

- Node.js >= 20
- An OpenAI API key (for embeddings and chat)

## Option A: Running with agentlang-cli (Local Mode)

This is the default — no external services required. Documents are processed and queried locally.

### 1. Set your API key

```bash
export AGENTLANG_OPENAI_KEY=sk-...
```

### 2. Build Agentlang

From the agentlang root directory:

```bash
npm run build
```

### 3. Run the example

```bash
node ./bin/cli.js run example/dracula
```

**What happens:**

1. The CLI loads `config.al` (SQLite + LanceDB) and `src/core.al` (agent + document declaration)
2. On the first query, the agent lazily processes `dracula.txt`:
   - Splits into ~870 chunks (1000 chars, 200 overlap)
   - Generates OpenAI embeddings (`text-embedding-3-small`, 1536-dim)
   - Stores vectors in LanceDB (`./data/knowledge-vectors.lance`)
3. Each query embeds the question and retrieves the top-k most similar chunks
4. Relevant chunks are appended as context to the LLM prompt

## Option B: Running with a Knowledge Service (Remote Mode)

When a `knowledgeGraph.serviceUrl` is configured, the agent delegates document processing and retrieval to a remote knowledge-service.

### 1. Set environment variables

```bash
export AGENTLANG_OPENAI_KEY=sk-...
export KNOWLEDGE_SERVICE_URL=https://your-knowledge-service.example.com
```

### 2. Update config.al

Add the `knowledgeGraph` block to `config.al`:

```json
{
  "agentlang": {
    "service": {
        "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
    },
    "store": {
        "type": "sqlite",
        "dbname": "dracula.db"
    },
    "vectorStore": {
      "type": "lancedb"
    },
    "knowledgeGraph": {
      "serviceUrl": "#js process.env.KNOWLEDGE_SERVICE_URL || ''"
    }
  }
}
```

### 3. Run the example

```bash
node ./bin/cli.js run example/dracula
```

**What happens:**

1. `KnowledgeService` detects the configured `serviceUrl` and enters remote mode
2. Document processing is handled by the knowledge-service (no local embedding)
3. Queries are forwarded via HTTP POST to:
   - `POST {serviceUrl}/api/knowledge/query` (primary endpoint)
   - `POST {serviceUrl}/knowledge.core/ApiKnowledgeQuery` (fallback)
4. The remote service returns entities, relationships, chunks, and a context string
5. The context is appended to the LLM prompt

## Usage

### Ask questions about Dracula

```bash
# Characters
curl -s -X POST http://localhost:8080/Dracula/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "Who is Count Dracula and what are his powers?"}' | jq .

# Relationships
curl -s -X POST http://localhost:8080/Dracula/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "What is the relationship between Jonathan Harker and Mina?"}' | jq .

# The hunt
curl -s -X POST http://localhost:8080/Dracula/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "Who joins Van Helsing in hunting Dracula and what role does each play?"}' | jq .

# Lucy's fate
curl -s -X POST http://localhost:8080/Dracula/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "What happens to Lucy Westenra?"}' | jq .

# The journey
curl -s -X POST http://localhost:8080/Dracula/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "How does Dracula travel from Transylvania to England?"}' | jq .
```

## Topics

Topics group multiple documents under a named label that agents can reference instead of (or alongside) individual document titles. Define topics in your config or `.al` files:

```json
{
  "agentlang.ai/topic": {
    "name": "novel-knowledge",
    "documents": ["dracula", "other-doc"]
  }
}
```

Then reference in an agent:

```
agent dracula {
    topics "novel-knowledge",
    llm "llm01"
}
```

**How topics interact with local vs. remote mode:**

| | Local mode | Remote mode |
| --- | --- | --- |
| **Topic resolution** | Topic names → document titles → local embedding + vector search | Topic names → `containerTags` sent to knowledge-service |
| **`containerTags`** | Ignored (only `documentTitles` used for filtering) | Sent to knowledge-service to scope the query |
| **Documents** | Each document title is resolved to a URL and processed locally | Document titles sent as filter hints; processing handled by service |

In local mode, topics are a convenience for grouping documents — they resolve to the same document titles you'd list directly. In remote mode, topic names become `containerTags` that the knowledge-service uses to scope queries across its own document index.

> **Note:** If an agent has `topics` but no `documents`, the topic's linked document titles are still resolved and processed locally. Topics and documents can also be combined — the titles are merged and deduplicated.

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │           core.al                    │
                    │  doc "dracula" → dracula.txt         │
                    │  agent dracula (documents, llm)      │
                    │  workflow ask → {dracula {message}}  │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │       KnowledgeService               │
                    │  (src/runtime/knowledge/service.ts)  │
                    └──────┬───────────────┬──────────────┘
                           │               │
              Local mode   │               │  Remote mode
          (no serviceUrl)  │               │  (serviceUrl set)
                           │               │
              ┌────────────▼───┐   ┌───────▼────────────┐
              │  TextChunker   │   │  HTTP POST to       │
              │  → Embeddings  │   │  knowledge-service  │
              │  → LanceDB     │   │  /api/knowledge/    │
              │  → Vector      │   │  query              │
              │    Search      │   │                     │
              └────────────────┘   └─────────────────────┘
                           │               │
                           └───────┬───────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │  Context appended to LLM prompt      │
                    │  → Agent responds with grounded      │
                    │    knowledge from the novel           │
                    └──────────────────────────────────────┘
```
