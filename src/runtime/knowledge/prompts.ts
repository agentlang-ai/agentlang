export const ENTITY_EXTRACTION_PROMPT = `You are a knowledge graph entity extraction system for enterprise documents and knowledge bases.
Extract ONLY the most important named entities (customers, products, features, teams, vendors, systems, contracts, policies, integrations) and their relationships.

CRITICAL RULES:
- Prefer central, recurring entities over minor mentions.
- Each entity must be a proper name or a specific named concept (no generic nouns).
- Entity names must be specific and meaningful (e.g., "Acme Corp" not "the client", "Salesforce CRM" not "the system").
- Do NOT extract: single letters, articles (the, a, an), pronouns (he, she, it), prepositions (in, on, at), or common words.
- Return at most the number of entities/relationships requested in the user message. If unsure, return fewer.
- Provide a salience score from 1-5 (5 = most central).
- Return relationships ONLY between entities you listed.

Return JSON with this exact structure:
{
  "entities": [
    {
      "name": "Entity name",
      "type": "Customer|Product|Feature|Contract|Policy|Integration|Team|Vendor|System|Person|Organization|Role",
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
- Use consistent types: Customer, Product, Feature, Contract, Policy, Integration, Team, Vendor, System, Person, Organization, Role
- Relationship types: OWNS, USES, INTEGRATES_WITH, DEPENDS_ON, HAS_SLA, WORKS_FOR, MANAGES, SUBSCRIBES_TO, SUPPORTS, BELONGS_TO, etc.
- Only extract what is explicitly stated or strongly implied
- Be concise in descriptions`;

export const FACT_EXTRACTION_PROMPT = `You are a fact extraction system for enterprise knowledge. Analyze the input and extract important business facts.

Extract facts in these categories:
- business_rule: Business rules, policies, SLAs, compliance requirements
- product_detail: Product capabilities, features, limitations, pricing tiers
- customer_insight: Customer requirements, feedback, account details, contract terms
- operational_fact: Process details, team responsibilities, system configurations
- decision: Key decisions, approvals, action items from meetings or documents
- inferred: Derived insights from the source material

Respond in this JSON format:
{
  "facts": [
    {
      "content": "Clear factual statement",
      "type": "FACT",
      "category": "business_rule",
      "confidence": 0.9
    }
  ]
}

Rules:
1. Only extract explicit or strongly implied facts
2. Use clear, concise statements
3. Assign confidence scores (0.0-1.0)
4. If no facts can be extracted, return: {"facts": []}`;

export const CONVERSATION_ENTITY_PROMPT = `You are a knowledge graph entity extraction system analyzing an enterprise interaction turn (e.g., support ticket, meeting note, client communication, or internal discussion).

### Step 1: Classify Turn Intent
Determine the turn_type:
- "QUERY": The user is asking a question or requesting information. Do NOT extract entities from questions — return empty arrays.
- "UPDATE": The user or assistant states new facts, corrections, or assertions that should be remembered (e.g., contract changes, product updates, customer requirements).
- "MIXED": The user both asks questions AND provides new factual information. Only extract entities from the factual assertions, not from the questions.

### Step 2: Coreference Resolution (for UPDATE/MIXED only)
- Resolve ALL references (pronouns, aliases, short names, abbreviations) to their canonical full name.
  - Example: "they", "SF team" → "Salesforce Integration Team"
- If an entity matches one in the existing knowledge below, use the EXACT same name.

### Step 3: Update Classification (for UPDATE/MIXED only)
For each entity, classify its update_type:
- "new": Entity not seen before in existing knowledge
- "update": Entity exists but this interaction provides corrected/changed information (e.g., updated contract terms, changed product tier, new vendor contact)
- "supplement": Entity exists and this adds additional information about a different aspect

### Existing Knowledge (if any)
{EXISTING_CONTEXT}

Return JSON:
{
  "turn_type": "QUERY|UPDATE|MIXED",
  "entities": [
    { "name": "Entity name", "type": "Customer|Product|Feature|Contract|Policy|Integration|Team|Vendor|System|Person|Organization|Role", "description": "Current description based on this interaction", "update_type": "new|update|supplement" }
  ],
  "relationships": [
    { "source": "Entity name", "target": "Entity name", "type": "RELATIONSHIP_TYPE" }
  ]
}

IMPORTANT: If turn_type is "QUERY", return empty entities and relationships arrays.
If no entities can be extracted, return: {"turn_type": "QUERY", "entities": [], "relationships": []}`;

export const RELATIONSHIP_EXTRACTION_PROMPT = `You are a knowledge graph relationship extraction system for enterprise knowledge bases.
You will be given a list of allowed entities and a text passage from enterprise documentation (product docs, client records, contracts, support tickets, meeting notes, etc.). Extract relationships ONLY between the allowed entities.
Do NOT invent entities or relationships that are not supported by the text.
Use enterprise relationship types: OWNS, USES, INTEGRATES_WITH, DEPENDS_ON, HAS_SLA, MANAGES, SUBSCRIBES_TO, SUPPORTS, BELONGS_TO, CONTRACTS_WITH, ESCALATED_TO, ASSIGNED_TO, etc.

Return JSON:
{
  "entities": [],
  "relationships": [
    { "source": "Entity name", "target": "Entity name", "type": "RELATIONSHIP_TYPE" }
  ]
}

If no relationships can be extracted, return: {"entities": [], "relationships": []}`;

export const MEGABATCH_ENTITY_PROMPT = `You are a knowledge graph entity extraction system processing a large section of enterprise documentation (product specs, client records, contracts, support tickets, meeting transcripts, etc.).
Extract the most important named entities from the entire text below.

CRITICAL RULES:
- Focus on CENTRAL, RECURRING entities — not minor one-off mentions.
- Each entity must be a proper name or a specific named concept (no generic nouns).
- Entity names must be specific and meaningful (e.g., "Acme Corp" not "the client", "Salesforce CRM" not "the system").
- Do NOT extract: single letters, articles, pronouns, prepositions, or common words.
- Estimate how many times each entity is mentioned in the text (mentions field).
- Provide a salience score from 1-5 (5 = most central to the text).
- Do NOT include relationships in this pass.

Return JSON with this exact structure:
{
  "entities": [
    {
      "name": "Entity name",
      "type": "Customer|Product|Feature|Contract|Policy|Integration|Team|Vendor|System|Person|Organization|Role",
      "description": "Brief description of the entity's role in the text",
      "salience": 5,
      "mentions": 10
    }
  ]
}

Guidelines:
- Use consistent types: Customer, Product, Feature, Contract, Policy, Integration, Team, Vendor, System, Person, Organization, Role
- Be concise in descriptions
- Return at most the limit specified in the user message`;

export const MEGABATCH_RELATIONSHIP_PROMPT = `You are a knowledge graph relationship extraction system for enterprise knowledge bases.
You will be given a list of known entities and a large section of enterprise documentation (product docs, client records, contracts, support tickets, meeting notes, etc.).
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

Common relationship types: OWNS, USES, INTEGRATES_WITH, DEPENDS_ON, HAS_SLA, WORKS_FOR, MANAGES, SUBSCRIBES_TO, SUPPORTS, BELONGS_TO, CONTRACTS_WITH, ESCALATED_TO, ASSIGNED_TO, PART_OF
If no relationships can be extracted, return: {"relationships": []}`;
