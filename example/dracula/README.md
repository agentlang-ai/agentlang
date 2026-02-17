# Dracula - Knowledge Graph Example

This example demonstrates Agentlang's knowledge graph memory system by building a knowledge graph from "Dracula" by Bram Stoker (1897, public domain via [Project Gutenberg](https://www.gutenberg.org/ebooks/345)).

When you first send a message, the system:

1. Processes the document into chunks
2. Extracts entities (characters, locations, events) and relationships using LLM
3. Deduplicates entities using exact + semantic similarity (when embeddings enabled)
4. Stores everything in Neo4j (graph database) + Agentlang entities (vector search)
5. On subsequent queries, retrieves relevant context via vector search + graph traversal

## Prerequisites

- Node.js >= 20
- An OpenAI API key (for entity extraction and chat). You can switch to Anthropic in `src/core.al`.
- Docker (for Neo4j - optional but recommended)

## Setup

### 1. Start Neo4j (Optional)

Neo4j provides graph storage and traversal. Without it, the system still works using Agentlang's built-in vector search, but you won't get multi-hop graph traversal or the Neo4j Browser visualization.

```bash
docker run -d --name neo4j-dracula \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:5
```

Set the environment variables:

```bash
export GRAPH_DB_URI=bolt://localhost:7687
export GRAPH_DB_USER=neo4j
export GRAPH_DB_PASSWORD=password
```

### 2. Set your API key

```bash
export AGENTLANG_OPENAI_KEY=sk-...
```

Or if using Anthropic (edit `src/core.al` to change `service "openai"` to `service "anthropic"`):

```bash
export AGENTLANG_ANTHROPIC_KEY=sk-ant-...
```

### 3. Build Agentlang

From the agentlang root directory:

```bash
npm run build
```

### 4. Run the example

```bash
node ./bin/cli.js run example/dracula
```

## Performance Notes

Dracula is a large novel (~870KB, about 6x the size of Alice in Wonderland). The streaming approach keeps memory constant regardless of size, but expect more LLM calls:

- ~18 mega-batches → **18 LLM calls** for entity extraction + **18 for relationships** = **~36 total**
- **First request will take 3-5 minutes** depending on LLM response times
- Subsequent requests are fast (<1s)

### Recommended settings for large documents

```bash
# Increase mega-batch size to reduce LLM calls further (halves to ~18 total)
export KG_MEGA_BATCH_CHARS=100000

# Higher salience threshold filters noise from a longer text
export KG_MIN_ENTITY_SALIENCE=3
export KG_MIN_ENTITY_MENTIONS=3

# Run with exposed GC for memory efficiency
node --expose-gc ./bin/cli.js run example/dracula
```

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

# Locations
curl -s -X POST http://localhost:8080/Dracula/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "Describe Castle Dracula and its significance in the story."}' | jq .

# The journey
curl -s -X POST http://localhost:8080/Dracula/ask \
  -H 'Content-Type: application/json' \
  -d '{"question": "How does Dracula travel from Transylvania to England?"}' | jq .
```

### Inspect the Knowledge Graph (Neo4j Browser)

If you started Neo4j, open http://localhost:7474 in your browser and run:

```cypher
-- See all nodes
MATCH (n:KnowledgeNode) RETURN n LIMIT 50

-- See all relationships
MATCH (n:KnowledgeNode)-[r]->(m:KnowledgeNode)
RETURN n, r, m LIMIT 100

-- Find Dracula's relationships
MATCH (n:KnowledgeNode {name: 'Dracula'})-[r]->(m)
RETURN n, r, m

-- Find all characters
MATCH (n:KnowledgeNode {type: 'Person'})
RETURN n.name, n.description
ORDER BY n.name

-- Find all locations
MATCH (n:KnowledgeNode {type: 'Location'})
RETURN n.name, n.description
```

## Expected Knowledge Graph

After processing, the knowledge graph should contain entities like:

```
Characters (Person):
├── Count Dracula - Ancient vampire, Transylvanian nobleman
├── Jonathan Harker - Solicitor, travels to Castle Dracula
├── Mina Harker (née Murray) - Jonathan's wife, resourceful and brave
├── Abraham Van Helsing - Dutch professor, vampire expert
├── Dr. John Seward - Psychiatrist, runs asylum near Carfax
├── Arthur Holmwood (Lord Godalming) - Lucy's fiancé, nobleman
├── Quincey Morris - American, Texan adventurer
├── Lucy Westenra - Mina's friend, Dracula's victim
├── R.M. Renfield - Seward's patient, eats insects for "life"
├── Peter Hawkins - Jonathan's employer, solicitor
├── Captain of the Demeter - Ship that carries Dracula to England
└── The Three Vampire Women - Dracula's brides at the castle

Locations:
├── Castle Dracula - Ancient fortress in the Carpathian Mountains
├── Transylvania - Region in Romania, Dracula's homeland
├── Borgo Pass - Mountain pass near the castle
├── Whitby - English coastal town where Dracula arrives
├── Carfax Abbey - Dracula's English estate, next to asylum
├── Dr. Seward's Asylum - Adjacent to Carfax
├── Hillingham - Lucy's home
├── Piccadilly - Dracula's London property
├── The Demeter - Ship from Varna to Whitby
└── Varna - Port city, Dracula's escape route

Key Relationships:
Jonathan Harker ──MARRIED_TO──> Mina Harker
Count Dracula ──IMPRISONS──> Jonathan Harker
Count Dracula ──FEEDS_ON──> Lucy Westenra
Count Dracula ──FEEDS_ON──> Mina Harker
Van Helsing ──LEADS──> Hunting Party
Arthur Holmwood ──ENGAGED_TO──> Lucy Westenra
Dr. Seward ──TREATS──> Renfield
Renfield ──SERVES──> Count Dracula
Count Dracula ──TRAVELS_ON──> The Demeter
Count Dracula ──RESIDES_AT──> Castle Dracula
Count Dracula ──PURCHASES──> Carfax Abbey
Van Helsing ──DESTROYS──> Count Dracula
```

## Architecture

```
Document (dracula.txt, ~870KB)
    ↓
Chunking (1000 chars, 200 overlap)
    ↓
Entity Extraction (LLM per chunk)
    ↓
Semantic Deduplication (cosine similarity > 0.85)
    ↓
┌──────────────────┬───────────────────┐
│  Neo4j           │  Agentlang        │
│  (Graph DB)      │  (KnowledgeNode)  │
│  - Nodes         │  - Vector search  │
│  - Edges         │  - Instance data  │
│  - BFS traversal │  - @fullTextSearch│
└──────────────────┴───────────────────┘
    ↓
Query: "Who hunts Dracula?"
    ↓
Vector Search → Seed nodes (Dracula, Van Helsing)
    ↓
Graph Expansion (2-hop BFS) → Related entities
    ↓
Structured Context → LLM → Answer
```
