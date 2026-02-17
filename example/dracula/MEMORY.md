# Dracula Knowledge Graph - Memory System Documentation

## Overview

This document describes how the Dracula example uses Agentlang's knowledge graph memory system to process Bram Stoker's novel and enable intelligent query responses.

**Key Insight:** Unlike simple text search, the system extracts **entities** (characters, locations), **relationships** (TRAVELS_TO, IMPRISONS), and **embeddings** (vector representations), then stores them in both SQL (with vectors) and Neo4j (graph database) for hybrid retrieval.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         KNOWLEDGE GRAPH FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Input: dracula.txt (~870KB, public domain)                                │
│       ↓                                                                     │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  INGESTION PIPELINE                                                │     │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │     │
│  │  │ Text Chunk   │ → │ Entity       │ → │ Generate     │         │     │
│  │  │ (1000+200)   │   │ Extraction   │   │ Embeddings   │         │     │
│  │  └──────────────┘   │ (LLM)        │   │ (1536-dim)   │         │     │
│  │                     └──────┬───────┘   └──────┬───────┘         │     │
│  │                            │                  │                  │     │
│  │                     ┌──────┴──────────┬───────┴──────────┐         │     │
│  │                     ↓                 ↓                  ↓         │     │
│  │              ┌────────────┐   ┌────────────┐   ┌────────────┐    │     │
│  │              │ Deduplicate│   │ Create     │   │ Create     │    │     │
│  │              │ (exact +   │   │ Nodes      │   │ Edges      │    │     │
│  │              │ semantic)  │   │            │   │            │    │     │
│  │              └────────────┘   └────────────┘   └────────────┘    │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│       ↓                                                                     │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  HYBRID STORAGE                                                    │     │
│  │                                                                    │     │
│  │   ┌──────────────────┐            ┌──────────────────┐             │     │
│  │   │  SQLite          │            │  Neo4j           │             │     │
│  │   │  (dracula.db)    │            │  (Graph DB)      │             │     │
│  │   ├────────────────┤            ├──────────────────┤             │     │
│  │   │ • KnowledgeNode │            │ • Nodes          │             │     │
│  │   │ • KnowledgeEdge │◄──────────►│ • Edges          │             │     │
│  │   │ • Vectors       │   Sync     │ • Traversal      │             │     │
│  │   └────────────────┘            └──────────────────┘             │     │
│  │                                                                    │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│       ↓                                                                     │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │  QUERY RETRIEVAL                                                  │     │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │     │
│  │  │ Extract      │ → │ Vector       │ → │ Graph        │         │     │
│  │  │ Entities     │   │ Search       │   │ Expansion    │         │     │
│  │  │ from Query   │   │ (Semantic)   │   │ (BFS 2-hop)  │         │     │
│  │  └──────────────┘   └──────┬───────┘   └──────┬───────┘         │     │
│  │                            │                  │                  │     │
│  │                     ┌──────┴──────────────────┴──────────┐         │     │
│  │                     ↓                                      ↓         │     │
│  │              ┌────────────────────────────────────────────────┐    │     │
│  │              │ Build Structured Context                         │    │     │
│  │              │ - Entities by type                                │    │     │
│  │              │ - Relationship chains                             │    │     │
│  │              │ - Instance data                                 │    │     │
│  │              └────────────────────────────────────────────────┘    │     │
│  └────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Startup Flow

When you run `agentlang run example/dracula`:

### Phase 1: CLI Initialization

```typescript
// src/cli/main.ts
export const runModule = async (fileName: string) => {
  // 1. Initialize SQLite database
  await initDatabase(config?.store); // dracula.db

  // 2. Load module (src/core.al)
  await load(fileName, undefined, async appSpec => {
    await runPostInitTasks(appSpec, config); // ← Triggers document processing
  });
};
```

**Storage after load:**

```sql
-- Table: agentlang.ai/Document
-- id | title   | url
-- ----|---------|-------------------------------
-- 1  | dracula | ./example/dracula/docs/dracula.txt

-- Table: Dracula/dracula (Agent)
-- name    | documents | llm
-- --------|-----------|-------
-- dracula | dracula   | llm01
```

### Phase 2: Document Pre-Processing (BLOCKING)

```typescript
// src/cli/main.ts
export async function runPostInitTasks(appSpec, config) {
  // Initialize Knowledge Service
  const knowledgeService = getKnowledgeService();
  await knowledgeService.init(); // Connects to Neo4j

  // PRE-PROCESS DOCUMENTS (blocks startup)
  await preProcessAgentDocuments(knowledgeService);
}
```

```typescript
// src/cli/main.ts
async function preProcessAgentDocuments(knowledgeService) {
  // Find all agents with documents
  const agents = await parseAndEvaluateStatement(`{agentlang.ai/Agent? {}}`);

  for (const agent of agents) {
    const docTitles = agent.documents.split(','); // ["dracula"]

    // Create session for processing
    const session = await knowledgeService.getOrCreateSession(
      agent.name, // "dracula"
      'system', // System user
      `${agent.moduleName}/${agent.name}` // "Dracula/dracula"
    );

    // Process documents (THIS IS THE KEY)
    await knowledgeService.maybeProcessAgentDocuments(
      session,
      docTitles, // ["dracula"]
      undefined,
      agent.llm // "gpt-4o"
    );
  }
}
```

---

## Knowledge Ingestion

### Step 1: Document Loading

```typescript
// src/runtime/knowledge/service.ts
async maybeProcessAgentDocuments(session, documentTitles, env, llmName) {
  // Check if already processed
  const existing = await parseAndEvaluateStatement(`
    {agentlang.knowledge/KnowledgeNode {
      agentId? "${session.agentId}",
      sourceType? "DOCUMENT"
    }} @limit 1
  `);

  if (existing.length > 0) {
    logger.info('Documents already processed, skipping');
    return;
  }

  // Fetch documents
  const allDocs = await parseAndEvaluateStatement(
    `{agentlang.ai/Document? {}}`
  );

  // Load content from file
  const matchingDocs = [];
  for (const doc of allDocs) {
    if (documentTitles.includes(doc.lookup('title'))) {
      const content = await loadDocumentContent(doc.lookup('url'));
      // content = "Count Dracula is the protagonist..."
      matchingDocs.push({name: doc.lookup('title'), content});
    }
  }

  // Process
  await this.processDocuments(matchingDocs, containerTag, userId, agentId, env, llmName);

  // Sync to Neo4j
  await this.syncToNeo4j(containerTag);
}
```

### Step 2: Text Chunking

```typescript
// src/runtime/knowledge/document-processor.ts
async processDocument(document, containerTag, userId, agentId, env, llmName) {
  const chunker = new TextChunker(1000, 200);  // chunkSize=1000, overlap=200

  // Generate chunks
  const chunks = [];
  for (const chunk of chunker.streamChunks(document.content)) {
    chunks.push(chunk);
  }
  // ~870 chunks for Dracula

  // Group into mega-batches (up to 50K chars)
  const megaBatches = groupIntoMegaBatches(chunks);
  // ~18 mega-batches for Dracula
}
```

**TextChunker logic** (from `src/runtime/embeddings/chunker.js`):

- Splits text at word boundaries
- Maintains 200-character overlap between chunks
- Preserves context across chunk boundaries

### Step 3: Entity Extraction via LLM

```typescript
// src/runtime/knowledge/document-processor.ts
const entityResults = await runParallel(
  megaBatches,
  async (batch, i) => {
    const entities = await this.extractor.extractEntitiesFromBatch(
      batch,
      env,
      llmName, // "gpt-4o"
      MAX_ENTITIES_PER_BATCH // 50
    );
    return entities;
  },
  LLM_CONCURRENCY // 5 concurrent
);
```

**LLM Prompt** (from `src/runtime/knowledge/prompts.ts`):

```typescript
export const MEGABATCH_ENTITY_PROMPT = `You are a knowledge graph entity extraction system...

CRITICAL RULES:
- Focus on CENTRAL, RECURRING entities
- Each entity must be a proper name
- Provide a salience score from 1-5 (5 = most central)
- Estimate how many times each entity is mentioned

Return JSON:
{
  "entities": [
    {
      "name": "Entity name",
      "type": "Person|Organization|Location|Product|Concept|Event|Role",
      "description": "Brief description",
      "salience": 5,
      "mentions": 10
    }
  ]
}`;
```

**LLM Response for Dracula batch:**

```json
{
  "entities": [
    {
      "name": "Count Dracula",
      "type": "Person",
      "description": "The protagonist, an ancient vampire",
      "salience": 5,
      "mentions": 156
    },
    {
      "name": "Jonathan Harker",
      "type": "Person",
      "description": "Young English lawyer",
      "salience": 5,
      "mentions": 89
    },
    {
      "name": "Transylvania",
      "type": "Location",
      "description": "Region in Romania where Dracula lives",
      "salience": 4,
      "mentions": 45
    }
  ]
}
```

### Step 4: Type Normalization

```typescript
// src/runtime/knowledge/extractor.ts
function normalizeEntityType(type: string): string {
  const normalized = type.trim().toLowerCase();
  switch (normalized) {
    case 'person':
    case 'character':
    case 'animal':
    case 'creature':
      return 'Person';
    case 'location':
    case 'place':
    case 'setting':
      return 'Location';
    case 'product':
    case 'artifact':
    case 'object':
      return 'Product';
    // ... other mappings
    default:
      return 'Concept';
  }
}
```

### Step 5: Select Core Entities

```typescript
// src/runtime/knowledge/document-processor.ts
const coreEntities = selectCoreEntities(
  candidateEntities,
  CORE_ENTITY_LIMIT, // 60 max entities
  CORE_ENTITY_PER_TYPE, // 20 per type
  MIN_ENTITY_MENTIONS, // 2 minimum
  MIN_ENTITY_SALIENCE, // 3.0 minimum
  MAX_DOCUMENT_NODES // 1000
);

// Filters by:
// - Score: mentions * 2 + salience
// - Per-type limit: max 20 per type
// - Minimum thresholds
```

### Step 6: Create Nodes with Embeddings

```typescript
// src/runtime/knowledge/deduplicator.ts
async findOrCreateNodesBatch(entities, containerTag, userId, sourceType, sourceId, sourceChunks, agentId) {
  const results = [];
  const needsEmbedding = [];

  // Step 1: Check for duplicates
  for (const entity of entities) {
    const existing = await this.findNodeByExactName(entity.name, containerTag);
    if (existing) {
      results.push(await this.mergeNode(existing, entity));
      continue;
    }

    const similar = await this.findSimilarNode(entity, containerTag);
    if (similar) {
      results.push(await this.mergeNode(similar, entity));
      continue;
    }

    needsEmbedding.push({entity, index: results.length});
  }

  // Step 2: Batch embed ALL new entities (ONE API call)
  if (needsEmbedding.length > 0) {
    const embeddingService = new EmbeddingService(embeddingConfig);

    const textsToEmbed = needsEmbedding.map(item =>
      `${item.entity.name} ${item.entity.type} ${item.entity.description || ''}`.trim()
    );
    // ["Count Dracula Person ancient vampire", "Jonathan Harker Person lawyer", ...]

    const embeddings = await embeddingService.embedTexts(textsToEmbed);
    // Returns: [[0.023, -0.156, 0.089, ...], ...] (1536 dimensions each)

    // Step 3: Create nodes with embeddings
    for (let i = 0; i < needsEmbedding.length; i++) {
      const {entity, index} = needsEmbedding[i];
      const node = await this.createNewNode(
        entity,
        containerTag,
        userId,
        sourceType,
        sourceId,
        sourceChunks,
        agentId,
        embeddings[i]  // ← EMBEDDING STORED
      );
      results[index] = node;
    }
  }

  return results;
}
```

**Storage:**

```sql
-- Table: agentlang.knowledge/KnowledgeNode
-- id         | name            | type     | description
-- -----------|-----------------|----------|--------------------------
-- uuid-abc   | Count Dracula   | Person   | Ancient vampire
-- uuid-def   | Jonathan Harker | Person   | Young lawyer
-- uuid-ghi   | Transylvania    | Location | Region in Romania
-- uuid-jkl   | Castle Dracula  | Location | Ancient fortress
-- uuid-mno   | The Demeter     | Product  | Russian sailing ship

-- Table: agentlang.knowledge/KnowledgeNode_vector (pgvector/sqlite-vec)
-- id       | embedding (1536-dim vector)
-- ---------|----------------------------------
-- uuid-abc | [0.023, -0.156, 0.089, 0.234, ...]
-- uuid-def | [-0.045, 0.234, 0.123, -0.078, ...]
-- uuid-ghi | [0.156, -0.089, 0.045, 0.312, ...]
```

### Step 7: Relationship Extraction

```typescript
// src/runtime/knowledge/document-processor.ts
const relResults = await runParallel(
  megaBatches,
  async (batch, i) => {
    const relationships = await this.extractor.extractRelationshipsFromBatch(
      batch,
      coreEntityNames, // ["Count Dracula", "Jonathan Harker", ...]
      env,
      llmName,
      MAX_RELATIONSHIPS_PER_BATCH // 100
    );
    return relationships;
  },
  LLM_CONCURRENCY
);
```

**LLM Prompt** (from `src/runtime/knowledge/prompts.ts`):

```typescript
export const MEGABATCH_RELATIONSHIP_PROMPT = `You are a knowledge graph relationship extraction system.

CRITICAL RULES:
- ONLY use entity names from the provided list
- Extract only relationships explicitly stated or strongly implied
- Use descriptive relationship types in UPPER_SNAKE_CASE

Return JSON:
{
  "relationships": [
    {
      "source": "Entity name",
      "target": "Entity name",
      "type": "RELATIONSHIP_TYPE"
    }
  ]
}

Common relationship types: KNOWS, MEETS, FOLLOWS, WORKS_FOR, LOCATED_IN, HAS_ROLE, BELONGS_TO, TRAVELS_TO`;
```

**LLM Response:**

```json
{
  "relationships": [
    { "source": "Count Dracula", "target": "Jonathan Harker", "type": "IMPRISONS" },
    { "source": "Count Dracula", "target": "Transylvania", "type": "RESIDES_AT" },
    { "source": "Count Dracula", "target": "The Demeter", "type": "TRAVELS_ON" },
    { "source": "The Demeter", "target": "England", "type": "ARRIVES_AT" },
    { "source": "Jonathan Harker", "target": "Mina Harker", "type": "MARRIED_TO" }
  ]
}
```

### Step 8: Create Edges

```typescript
// src/runtime/knowledge/document-processor.ts
for (const rel of candidateRelationships.values()) {
  const edge = await this.createEdgeFromCandidate(
    rel,
    coreNodeMap,
    containerTag,
    userId,
    agentId
  );
}

// SQL storage:
-- Table: agentlang.knowledge/KnowledgeEdge
-- id         | sourceId | targetId | relType     | weight
-- ------------|----------|----------|-------------|--------
-- uuid-edge1 | uuid-abc | uuid-def | IMPRISONS   | 3.0
-- uuid-edge2 | uuid-abc | uuid-ghi | RESIDES_AT  | 5.0
-- uuid-edge3 | uuid-abc | uuid-mno | TRAVELS_ON  | 2.0
-- uuid-edge4 | uuid-mno | uuid-pqr | ARRIVES_AT  | 4.0
-- uuid-edge5 | uuid-def | uuid-stu | MARRIED_TO  | 5.0
```

### Step 9: Sync to Neo4j

```typescript
// src/runtime/knowledge/service.ts
async syncToNeo4j(containerTag: string): Promise<void> {
  // 1. Fetch nodes from SQL
  const nodes = await parseAndEvaluateStatement(`
    {agentlang.knowledge/KnowledgeNode {
      containerTag? "${containerTag}",
      isLatest? true
    }}
  `);

  // 2. Upsert to Neo4j
  for (const inst of nodes) {
    const node = {
      id: inst.lookup('id'),
      name: inst.lookup('name'),
      type: inst.lookup('type'),
      description: inst.lookup('description')
    };
    await this.graphDb.upsertNode(node);
    // Cypher: MERGE (n:KnowledgeNode {id: $id}) SET n.name = $name, ...
  }

  // 3. Sync edges
  const edges = await parseAndEvaluateStatement(`
    {agentlang.knowledge/KnowledgeEdge {
      containerTag? "${containerTag}"
    }}
  `);

  for (const inst of edges) {
    const edge = {
      sourceId: inst.lookup('sourceId'),
      targetId: inst.lookup('targetId'),
      relationship: inst.lookup('relType'),
      weight: inst.lookup('weight')
    };
    await this.graphDb.upsertEdge(edge);
    // Cypher: MERGE (a)-[r:RELTYPE]->(b) SET r.weight = $weight
  }
}
```

**Neo4j after sync:**

```cypher
// Nodes
(:KnowledgeNode {name: "Count Dracula", type: "Person"})
(:KnowledgeNode {name: "Jonathan Harker", type: "Person"})
(:KnowledgeNode {name: "Transylvania", type: "Location"})
(:KnowledgeNode {name: "The Demeter", type: "Product"})
(:KnowledgeNode {name: "England", type: "Location"})

// Relationships
(:KnowledgeNode {name: "Count Dracula"})-[:IMPRISONS]->(:KnowledgeNode {name: "Jonathan Harker"})
(:KnowledgeNode {name: "Count Dracula"})-[:RESIDES_AT]->(:KnowledgeNode {name: "Transylvania"})
(:KnowledgeNode {name: "Count Dracula"})-[:TRAVELS_ON]->(:KnowledgeNode {name: "The Demeter"})
(:KnowledgeNode {name: "The Demeter"})-[:ARRIVES_AT]->(:KnowledgeNode {name: "England"})
```

---

## Knowledge Retrieval

When user asks: **"How does Dracula travel from Transylvania to England?"**

### Phase 1: Query Processing

```typescript
// src/runtime/modules/ai.ts
async handleMessage(message, env) {
  // 1. Get knowledge session
  const knowledgeService = getKnowledgeService();
  const knowledgeSession = await knowledgeService.getOrCreateSession(
    this.name,      // "dracula"
    userId,         // user's ID
    agentFqName     // "Dracula/dracula"
  );

  // 2. Build context from knowledge graph
  const knowledgeContext = await knowledgeService.buildContext(
    message,                    // "How does Dracula travel..."
    knowledgeSession.containerTag,  // "Dracula/dracula:user:xyz"
    knowledgeSession.userId,
    knowledgeSession.agentId
  );

  // 3. Add context to LLM prompt
  const finalMsg = knowledgeContext.contextString
    ? `${message}\n\n${knowledgeContext.contextString}`
    : message;

  // 4. Send to LLM
  const response = await llm.complete(finalMsg);
}
```

### Phase 2: Context Building

```typescript
// src/runtime/knowledge/context-builder.ts
async buildContext(query, containerTag, userId, extraContainerTags) {
  // Step 1: Extract entity candidates from query
  const candidates = extractEntityCandidates(query);
  // Returns: ["Dracula", "Transylvania", "England"]

  // Step 2: Find exact matches
  let seedNodes = [];
  for (const candidate of candidates) {
    const matches = await this.findExactMatches(candidate, containerTag);
    seedNodes = mergeNodes(seedNodes, matches, MAX_SEED_NODES);
  }
  // seedNodes = [Dracula, Transylvania, England]

  // Step 3: Vector search for semantic matches (if needed)
  if (seedNodes.length < MAX_SEED_NODES) {
    const vectorMatches = await this.vectorSearchNodes(query, containerTag);
    seedNodes = mergeNodes(seedNodes, vectorMatches, MAX_SEED_NODES);
  }

  // Step 4: Graph expansion (BFS)
  let expandedNodes = seedNodes;
  let expandedEdges = [];

  if (this.graphDb.isConnected()) {
    const seedIds = seedNodes.map(n => n.id);
    const expanded = await this.graphDb.expandGraph(
      seedIds,
      MAX_GRAPH_DEPTH,  // 2 hops
      containerTag
    );
    expandedNodes = expanded.nodes;
    expandedEdges = expanded.edges;
  }

  // Step 5: Fetch instance data (if any)
  const instanceData = await this.fetchInstanceData(expandedNodes);

  // Step 6: Format context
  const contextString = this.formatContext(
    expandedNodes,
    expandedEdges,
    instanceData
  );

  return {
    entities: expandedNodes,
    relationships: expandedEdges,
    instanceData,
    contextString
  };
}
```

### Phase 3: Vector Search

```typescript
// src/runtime/knowledge/context-builder.ts
private async vectorSearchNodes(query: string, containerTag: string): Promise<GraphNode[]> {
  // Embed the query
  const result = await parseAndEvaluateStatement(`
    {agentlang.knowledge/KnowledgeNode {
      containerTag? "${containerTag}",
      name? "${query}"   // ← This triggers vector search!
    }, @limit ${MAX_SEED_NODES}}
  `);

  return result.map(instanceToGraphNode);
}
```

**Behind the scenes** (from `src/runtime/resolvers/sqldb/impl.ts`):

```typescript
// Embed query
const embeddingService = new EmbeddingService(embeddingConfig);
const queryVec = await embeddingService.embedQuery(
  'How does Dracula travel from Transylvania to England?'
);
// Returns: [0.034, -0.128, 0.067, ...]

// Search in vector store
const rslt = await vectorStoreSearch(tableName, queryVec, 10, ctx);
// SQL: SELECT id FROM KnowledgeNode_vector
//      ORDER BY embedding <-> '[0.034, -0.128, ...]'  -- cosine distance
//      LIMIT 10
```

### Phase 4: Graph Expansion

```typescript
// src/runtime/graph/neo4j.ts
async expandGraph(seedIds: string[], maxDepth: number, containerTag: string) {
  const session = this.driver.session();

  try {
    const result = await session.run(`
      MATCH (seed:KnowledgeNode)
      WHERE seed.id IN $seedIds AND seed.containerTag = $containerTag

      // Use APOC for subgraph expansion
      CALL apoc.path.subgraphAll(seed, {
        maxLevel: $maxDepth,     // 2 hops
        labelFilter: 'KnowledgeNode'
      })
      YIELD nodes, relationships

      RETURN DISTINCT n,
             startNode(r).id AS srcId,
             endNode(r).id AS tgtId,
             type(r) AS relType,
             r.weight AS weight
    `, { seedIds, maxDepth: 2, containerTag });

    // Process results into nodes and edges
    const nodeMap = new Map();
    const edges = [];

    for (const record of result.records) {
      const n = record.get('n');
      if (n) {
        nodeMap.set(n.properties.id, this.recordToNode(n));
      }

      const srcId = record.get('srcId');
      const tgtId = record.get('tgtId');
      if (srcId && tgtId) {
        edges.push({
          sourceId: srcId,
          targetId: tgtId,
          relationship: record.get('relType'),
          weight: record.get('weight') ?? 1.0
        });
      }
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges
    };
  } finally {
    await session.close();
  }
}
```

**Graph traversal for "Dracula travel Transylvania England":**

```
Seed: [Dracula]

Depth 0: Dracula
           │
           ▼
Depth 1: RESIDES_AT → Transylvania
         IMPRISONS   → Jonathan Harker
         TRAVELS_ON  → The Demeter
           │
           ▼
Depth 2: (from The Demeter)
         ARRIVES_AT  → England
         DEPARTS_FROM→ Transylvania

Result: Dracula, Transylvania, Jonathan Harker, The Demeter, England
Edges: RESIDES_AT, IMPRISONS, TRAVELS_ON, ARRIVES_AT, DEPARTS_FROM
```

### Phase 5: Context Formatting

```typescript
// src/runtime/knowledge/context-builder.ts
formatContext(nodes, edges, instances) {
  let context = '## Knowledge Graph Context\n\n';

  // Entities by type
  context += '### Relevant Entities\n';
  const byType = this.groupByType(nodes);
  for (const [type, entities] of byType) {
    context += `\n**${type}s:**\n`;
    for (const entity of entities) {
      context += `- ${entity.name}`;
      if (entity.description) {
        context += `: ${entity.description}`;
      }
      context += '\n';
    }
  }

  // Relationships
  context += '\n### Relationships\n';
  for (const edge of edges) {
    const source = nodes.find(n => n.id === edge.sourceId);
    const target = nodes.find(n => n.id === edge.targetId);
    if (source && target) {
      context += `- ${source.name} ${edge.relationship} ${target.name}\n`;
    }
  }

  return context;
}
```

**Generated Context:**

```markdown
## Knowledge Graph Context

### Relevant Entities

**Persons:**

- Count Dracula: Ancient vampire, Transylvanian nobleman
- Jonathan Harker: Young English lawyer

**Locations:**

- Transylvania: Region in Romania where Dracula lives
- England: Destination country

**Products:**

- The Demeter: Russian sailing ship

### Relationships

- Count Dracula RESIDES_AT Transylvania
- Count Dracula IMPRISONS Jonathan Harker
- Count Dracula TRAVELS_ON The Demeter
- The Demeter ARRIVES_AT England
```

### Phase 6: LLM Response

The LLM receives:

```
User: How does Dracula travel from Transylvania to England?

## Knowledge Graph Context

### Relevant Entities
**Persons:**
- Count Dracula: Ancient vampire, Transylvanian nobleman
...

### Relationships
- Count Dracula TRAVELS_ON The Demeter
- The Demeter ARRIVES_AT England
...
```

**LLM Response:**

> "Count Dracula travels from Transylvania to England aboard the Russian sailing ship **The Demeter**. He boards the ship at a port in Transylvania and arrives at **Whitby**, a port town in Yorkshire, England. During the voyage, Dracula uses his supernatural abilities to transform into mist, allowing him to move undetected among the crew and cargo."

---

## Key Configuration

### Environment Variables

```bash
# Required
export AGENTLANG_OPENAI_KEY=sk-...

# Optional: Neo4j
export GRAPH_DB_URI=bolt://localhost:7687
export GRAPH_DB_USER=neo4j
export GRAPH_DB_PASSWORD=password

# Optional: Processing tuning
export KG_CHUNK_SIZE=1000
export KG_CHUNK_OVERLAP=200
export KG_MEGA_BATCH_CHARS=50000
export KG_CORE_ENTITY_LIMIT=60
export KG_MIN_ENTITY_SALIENCE=3
export KG_MAX_SEED_NODES=5
export KG_MAX_GRAPH_DEPTH=2
```

### Database Schema

**SQLite (dracula.db):**

```sql
-- KnowledgeNode: Main entity store
CREATE TABLE KnowledgeNode (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  description TEXT,
  containerTag TEXT,
  isLatest BOOLEAN,
  confidence FLOAT,
  createdAt DATETIME
);

-- KnowledgeNode_vector: Vector embeddings (sqlite-vec)
CREATE VIRTUAL TABLE KnowledgeNode_vector USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);

-- KnowledgeEdge: Relationships
CREATE TABLE KnowledgeEdge (
  id TEXT PRIMARY KEY,
  sourceId TEXT,
  targetId TEXT,
  relType TEXT,
  weight FLOAT,
  containerTag TEXT
);

-- KnowledgeSession: Session tracking
CREATE TABLE KnowledgeSession (
  id TEXT PRIMARY KEY,
  agentId TEXT,
  userId TEXT,
  containerTag TEXT,
  documentsProcessed BOOLEAN
);
```

**Neo4j:**

```cypher
// Nodes
(:KnowledgeNode {
  id: "uuid",
  name: "Count Dracula",
  type: "Person",
  description: "...",
  containerTag: "Dracula/dracula:shared"
})

// Edges
(:KnowledgeNode)-[:TRAVELS_ON {weight: 2.0}]->(:KnowledgeNode)
```

---

## Performance Characteristics

| Operation             | Time      | Details                            |
| --------------------- | --------- | ---------------------------------- |
| **First Startup**     | 3-5 min   | Document processing (18 LLM calls) |
| **Subsequent Starts** | <1s       | Skips processing (already done)    |
| **Query Context**     | 300-500ms | Vector search + graph expansion    |
| **Neo4j Sync**        | 10-30s    | After document processing          |

**Large Document Handling:**

- Dracula: ~870KB → ~60 nodes, ~200 edges
- Streaming chunk processing keeps memory constant
- Parallel LLM calls (5 concurrent) for speed

---

## Code Reference Map

| Component               | File                                          | Purpose               |
| ----------------------- | --------------------------------------------- | --------------------- |
| **CLI Entry**           | `src/cli/main.ts`                             | Startup orchestration |
| **Document Processing** | `src/runtime/knowledge/service.ts`            | Main API              |
| **Chunking**            | `src/runtime/knowledge/document-processor.ts` | Text processing       |
| **Entity Extraction**   | `src/runtime/knowledge/extractor.ts`          | LLM calls             |
| **Deduplication**       | `src/runtime/knowledge/deduplicator.ts`       | Semantic matching     |
| **Context Builder**     | `src/runtime/knowledge/context-builder.ts`    | Query handling        |
| **Neo4j Adapter**       | `src/runtime/graph/neo4j.ts`                  | Graph operations      |
| **Embedding Service**   | `src/runtime/resolvers/sqldb/impl.ts`         | Vector generation     |
| **LLM Prompts**         | `src/runtime/knowledge/prompts.ts`            | Extraction prompts    |

---

## Summary

The Dracula example demonstrates:

1. **Document Ingestion**: Text → Chunks → LLM extraction → Embeddings → SQL + Neo4j
2. **Hybrid Storage**: SQLite (authoritative + vectors) + Neo4j (graph traversal)
3. **Semantic Retrieval**: Exact match → Vector search → Graph expansion → Structured context
4. **Intelligent Responses**: LLM answers using entity relationships, not just text

**Result:** The agent doesn't just search for text—it **understands** the relationships between characters, locations, and events to provide contextually rich answers.

---
