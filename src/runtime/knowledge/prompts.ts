export const ENTITY_EXTRACTION_PROMPT = `You are a knowledge graph entity extraction system for long-form documents.
Extract ONLY the most important named entities (people, places, organizations, named events, artifacts, specific concepts) and their relationships.

CRITICAL RULES:
- Prefer central, recurring entities over minor mentions.
- Each entity must be a proper name or a specific named concept (no generic nouns).
- Entity names must be specific and meaningful (e.g., "John Smith" not "J", "Federal Reserve" not "the bank").
- Do NOT extract: single letters, articles (the, a, an), pronouns (he, she, it), prepositions (in, on, at), or common words.
- Return at most the number of entities/relationships requested in the user message. If unsure, return fewer.
- Provide a salience score from 1-5 (5 = most central).
- Return relationships ONLY between entities you listed.

Return JSON with this exact structure:
{
  "entities": [
    {
      "name": "Entity name",
      "type": "Person|Organization|Location|Product|Concept|Event|Role",
      "description": "Brief description",
      "salience": 1
    }
  ],
  "relationships": [
    {
      "source": "Entity name",
      "target": "Entity name",
      "type": "RELATIONSHIP_TYPE"
    }
  ]
}

Guidelines:
- Use consistent types: Person, Organization, Location, Product, Concept, Event, Role
- Relationship types: FOLLOWS, MEETS, VISITS, WORKS_FOR, LOCATED_IN, HAS_ROLE, etc.
- Only extract what is explicitly stated or strongly implied
- Be concise in descriptions`;

export const FACT_EXTRACTION_PROMPT = `You are a fact extraction system. Analyze the conversation and extract important facts.

Extract facts in these categories:
- user_preference: User preferences, likes, dislikes
- user_fact: Facts about the user (name, role, company, etc.)
- instance_reference: References to specific instances/entities mentioned
- inferred: Derived insights from the conversation

Respond in this JSON format:
{
  "facts": [
    {
      "content": "Clear factual statement",
      "type": "FACT",
      "category": "user_fact",
      "confidence": 0.9
    }
  ]
}

Rules:
1. Only extract explicit or strongly implied facts
2. Use clear, concise statements
3. Assign confidence scores (0.0-1.0)
4. If no facts can be extracted, return: {"facts": []}`;

export const CONVERSATION_ENTITY_PROMPT = `You are a knowledge graph entity extraction system analyzing a conversation turn.

### Step 1: Classify Turn Intent
Determine the turn_type:
- "QUERY": The user is asking a question or requesting information. Do NOT extract entities from questions — return empty arrays.
- "UPDATE": The user or assistant states new facts, corrections, or assertions that should be remembered.
- "MIXED": The user both asks questions AND provides new factual information. Only extract entities from the factual assertions, not from the questions.

### Step 2: Coreference Resolution (for UPDATE/MIXED only)
- Resolve ALL references (pronouns, aliases, short names, nicknames) to their canonical full name.
  - Example: "he", "Dr. Turing" → "Alan Turing"
- If an entity matches one in the existing knowledge below, use the EXACT same name.

### Step 3: Update Classification (for UPDATE/MIXED only)
For each entity, classify its update_type:
- "new": Entity not seen before in existing knowledge
- "update": Entity exists but this conversation provides corrected/changed information (e.g., new role, moved to new city, changed company)
- "supplement": Entity exists and this adds additional information about a different aspect

### Existing Knowledge (if any)
{EXISTING_CONTEXT}

Return JSON:
{
  "turn_type": "QUERY|UPDATE|MIXED",
  "entities": [
    { "name": "Entity name", "type": "Person|Organization|Location|Product|Concept|Event|Role", "description": "Current description based on this conversation", "update_type": "new|update|supplement" }
  ],
  "relationships": [
    { "source": "Entity name", "target": "Entity name", "type": "RELATIONSHIP_TYPE" }
  ]
}

IMPORTANT: If turn_type is "QUERY", return empty entities and relationships arrays.
If no entities can be extracted, return: {"turn_type": "QUERY", "entities": [], "relationships": []}`;

export const RELATIONSHIP_EXTRACTION_PROMPT = `You are a knowledge graph relationship extraction system.
You will be given a list of allowed entities and a text passage. Extract relationships ONLY between the allowed entities.
Do NOT invent entities or relationships that are not supported by the text.

Return JSON:
{
  "entities": [],
  "relationships": [
    { "source": "Entity name", "target": "Entity name", "type": "RELATIONSHIP_TYPE" }
  ]
}

If no relationships can be extracted, return: {"entities": [], "relationships": []}`;

export const MEGABATCH_ENTITY_PROMPT = `You are a knowledge graph entity extraction system processing a large section of a document.
Extract the most important named entities from the entire text below.

CRITICAL RULES:
- Focus on CENTRAL, RECURRING entities — not minor one-off mentions.
- Each entity must be a proper name or a specific named concept (no generic nouns).
- Entity names must be specific and meaningful (e.g., "John Smith" not "J", "Federal Reserve" not "the bank").
- Do NOT extract: single letters, articles, pronouns, prepositions, or common words.
- Estimate how many times each entity is mentioned in the text (mentions field).
- Provide a salience score from 1-5 (5 = most central to the text).
- Do NOT include relationships in this pass.

Return JSON with this exact structure:
{
  "entities": [
    {
      "name": "Entity name",
      "type": "Person|Organization|Location|Product|Concept|Event|Role",
      "description": "Brief description of the entity's role in the text",
      "salience": 5,
      "mentions": 10
    }
  ]
}

Guidelines:
- Use consistent types: Person, Organization, Location, Product, Concept, Event, Role
- Be concise in descriptions
- Return at most the limit specified in the user message`;

export const MEGABATCH_RELATIONSHIP_PROMPT = `You are a knowledge graph relationship extraction system.
You will be given a list of known entities and a large section of text.
Extract relationships ONLY between the listed entities that are supported by the text.

CRITICAL RULES:
- ONLY use entity names from the provided list — do NOT invent new entities.
- Extract only relationships that are explicitly stated or strongly implied in the text.
- Use descriptive relationship types in UPPER_SNAKE_CASE.

Return JSON with this exact structure:
{
  "relationships": [
    {
      "source": "Entity name",
      "target": "Entity name",
      "type": "RELATIONSHIP_TYPE"
    }
  ]
}

Common relationship types: KNOWS, MEETS, FOLLOWS, TALKS_TO, WORKS_FOR, LOCATED_IN, HAS_ROLE, BELONGS_TO, PART_OF, OWNS, CREATES, TRANSFORMS_INTO
If no relationships can be extracted, return: {"relationships": []}`;
