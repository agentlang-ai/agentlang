import { logger } from '../logger.js';
import type { ExtractionResult, ExtractedEntity, ExtractedRelationship } from '../graph/types.js';
import {
  ENTITY_EXTRACTION_PROMPT,
  CONVERSATION_ENTITY_PROMPT,
  FACT_EXTRACTION_PROMPT,
  RELATIONSHIP_EXTRACTION_PROMPT,
  MEGABATCH_ENTITY_PROMPT,
  MEGABATCH_RELATIONSHIP_PROMPT,
} from './prompts.js';
import { findProviderForLLM } from '../modules/ai.js';
import { humanMessage, systemMessage } from '../agents/provider.js';
import { Environment } from '../interpreter.js';

/**
 * Extract the first complete JSON object from text using brace-depth matching.
 * Handles code fences, extra commentary, and nested braces.
 */
function extractJsonObject(text: string): string | null {
  // First try to extract from markdown code fences
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fencedMatch) {
    const inner = fencedMatch[1].trim();
    if (inner.startsWith('{')) return inner;
  }

  // Brace-depth matching: find the first complete JSON object
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.substring(startIdx, i + 1);
      }
    }
  }

  return null;
}

export interface ExtractedFact {
  content: string;
  type: 'FACT' | 'PREFERENCE' | 'DERIVED';
  category: string;
  confidence: number;
  instanceId?: string;
  instanceType?: string;
}

export interface ExtractionOptions {
  maxEntities?: number;
  maxRelationships?: number;
}

export class EntityExtractor {
  async extractFromText(
    text: string,
    env?: Environment,
    llmName: string = 'default',
    options?: ExtractionOptions
  ): Promise<ExtractionResult> {
    try {
      logger.info(`[KNOWLEDGE] EntityExtractor: Finding provider for LLM "${llmName}"...`);
      const provider = await findProviderForLLM(llmName, env || new Environment());
      logger.info(`[KNOWLEDGE] EntityExtractor: Provider found, invoking LLM for extraction...`);
      const maxEntities = options?.maxEntities ?? 0;
      const maxRelationships = options?.maxRelationships ?? 0;
      const limitsHint =
        maxEntities || maxRelationships
          ? `\n\nLimits: maxEntities=${maxEntities || 'unspecified'}, maxRelationships=${
              maxRelationships || 'unspecified'
            }. If unsure, return fewer.`
          : '';
      const messages = [
        systemMessage(ENTITY_EXTRACTION_PROMPT),
        humanMessage(
          `Extract entities and relationships from the following text:${limitsHint}\n\n"""${text}"""`
        ),
      ];
      const response = await provider.invoke(messages, undefined);
      logger.info(`[KNOWLEDGE] EntityExtractor: LLM responded, parsing result...`);
      const result = parseExtractionResponse(response.content);
      return applyExtractionLimits(result, maxEntities, maxRelationships);
    } catch (err) {
      logger.error(`[KNOWLEDGE] Entity extraction failed: ${err}`);
      return { entities: [], relationships: [] };
    }
  }

  async extractFromConversation(
    userMessage: string,
    assistantResponse: string,
    env?: Environment,
    llmName: string = 'default',
    existingContext?: string
  ): Promise<ExtractionResult> {
    try {
      const provider = await findProviderForLLM(llmName, env || new Environment());
      const conversation = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
      const contextFilled = existingContext || 'None — this is the first conversation turn.';
      const prompt = CONVERSATION_ENTITY_PROMPT.replace('{EXISTING_CONTEXT}', contextFilled);
      const messages = [
        systemMessage(prompt),
        humanMessage(`Extract entities from this conversation:\n\n${conversation}`),
      ];
      const response = await provider.invoke(messages, undefined);
      return parseExtractionResponse(response.content);
    } catch (err) {
      logger.error(`[KNOWLEDGE] Conversation entity extraction failed: ${err}`);
      return { entities: [], relationships: [] };
    }
  }

  async extractFacts(
    userMessage: string,
    assistantResponse: string,
    env?: Environment,
    llmName: string = 'default'
  ): Promise<ExtractedFact[]> {
    try {
      const provider = await findProviderForLLM(llmName, env || new Environment());
      const conversation = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
      const messages = [
        systemMessage(FACT_EXTRACTION_PROMPT),
        humanMessage(`Extract facts from this conversation:\n\n${conversation}`),
      ];
      const response = await provider.invoke(messages, undefined);
      return parseFactResponse(response.content);
    } catch (err) {
      logger.error(`[KNOWLEDGE] Fact extraction failed: ${err}`);
      return [];
    }
  }

  async extractRelationships(
    text: string,
    allowedEntities: string[],
    env?: Environment,
    llmName: string = 'default',
    maxRelationships?: number
  ): Promise<ExtractionResult> {
    if (!allowedEntities || allowedEntities.length === 0) {
      return { entities: [], relationships: [] };
    }
    try {
      const provider = await findProviderForLLM(llmName, env || new Environment());
      const entityList = allowedEntities.join(', ');
      const limitsHint = maxRelationships ? `\n\nLimit: maxRelationships=${maxRelationships}.` : '';
      const messages = [
        systemMessage(RELATIONSHIP_EXTRACTION_PROMPT),
        humanMessage(
          `Allowed entities: ${entityList}.${limitsHint}\n\nExtract relationships from:\n"""${text}"""`
        ),
      ];
      const response = await provider.invoke(messages, undefined);
      const relationships = parseMegaBatchRelationshipResponse(response.content, allowedEntities);
      return {
        entities: [],
        relationships: maxRelationships ? relationships.slice(0, maxRelationships) : relationships,
      };
    } catch (err) {
      logger.error(`[KNOWLEDGE] Relationship extraction failed: ${err}`);
      return { entities: [], relationships: [] };
    }
  }

  async extractEntitiesFromBatch(
    text: string,
    env?: Environment,
    llmName: string = 'default',
    maxEntities?: number
  ): Promise<ExtractedEntity[]> {
    try {
      const provider = await findProviderForLLM(llmName, env || new Environment());
      const limitsHint = maxEntities ? `\n\nReturn at most ${maxEntities} entities.` : '';
      const messages = [
        systemMessage(MEGABATCH_ENTITY_PROMPT),
        humanMessage(
          `Extract the most important entities from the following text:${limitsHint}\n\n"""${text}"""`
        ),
      ];
      const response = await provider.invoke(messages, undefined);
      return parseMegaBatchEntityResponse(response.content);
    } catch (err) {
      logger.error(`[KNOWLEDGE] Mega-batch entity extraction failed: ${err}`);
      return [];
    }
  }

  async extractRelationshipsFromBatch(
    text: string,
    entityNames: string[],
    env?: Environment,
    llmName: string = 'default',
    maxRelationships?: number
  ): Promise<ExtractedRelationship[]> {
    if (entityNames.length === 0) return [];
    try {
      const provider = await findProviderForLLM(llmName, env || new Environment());
      const entityList = entityNames.join(', ');
      const limitsHint = maxRelationships
        ? `\n\nReturn at most ${maxRelationships} relationships.`
        : '';
      const messages = [
        systemMessage(MEGABATCH_RELATIONSHIP_PROMPT),
        humanMessage(
          `Known entities: ${entityList}${limitsHint}\n\nExtract relationships from:\n\n"""${text}"""`
        ),
      ];
      const response = await provider.invoke(messages, undefined);
      return parseMegaBatchRelationshipResponse(response.content, entityNames);
    } catch (err) {
      logger.error(`[KNOWLEDGE] Mega-batch relationship extraction failed: ${err}`);
      return [];
    }
  }
}

// Simple regex patterns to filter obvious invalid entities
const INVALID_ENTITY_PATTERNS = [
  /^[a-zA-Z]$/, // Single letters
  /^[a-zA-Z]\d?$/, // Single letter + optional digit (A1, B2, etc.)
  /^[\p{P}\s]+$/u, // Pure punctuation
  /^\d+$/, // Numbers only
  /^chapter\s+[ivxlcdm]+$/i, // Chapter I, Chapter IV, etc.
];

const INVALID_ENTITY_NAMES = new Set([
  'chapter',
  'chapters',
  'section',
  'sections',
  'page',
  'pages',
  'volume',
  'book',
  'part',
]);

// Common grammatical categories to skip
const GRAMMATICAL_WORDS = new Set([
  'a',
  'an',
  'the', // Articles
  'and',
  'or',
  'but', // Conjunctions
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by', // Prepositions
]);

function isValidEntityName(name: string): boolean {
  const trimmed = name.trim();

  // Must be at least 2 characters
  if (trimmed.length < 2) return false;

  // Check invalid patterns
  for (const pattern of INVALID_ENTITY_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  const lower = trimmed.toLowerCase();

  // Skip common grammatical words
  if (GRAMMATICAL_WORDS.has(lower)) return false;

  // Skip known non-entities
  if (INVALID_ENTITY_NAMES.has(lower)) return false;

  // Skip if it's all lowercase and very short (likely a common word)
  if (trimmed.length <= 3 && trimmed === trimmed.toLowerCase()) return false;

  // Skip if it's excessively long (likely a sentence)
  if (trimmed.length > 80) return false;

  return true;
}

function normalizeEntityName(name: string): string {
  // Trim whitespace
  let normalized = name.trim();

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');

  // Remove leading/trailing punctuation
  normalized = normalized.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');

  // Remove trailing possessive ("Alice's" -> "Alice")
  normalized = normalized.replace(/['’]s$/i, '');

  // Title case for consistency (but preserve acronyms)
  if (normalized.length > 3 && normalized === normalized.toUpperCase()) {
    // Keep acronyms uppercase
    return normalized;
  }

  // Title case
  return normalized.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeEntityType(type: string): string {
  const normalized = type.trim().toLowerCase();
  switch (normalized) {
    case 'person':
    case 'character':
    case 'animal':
    case 'creature':
      return 'Person';
    case 'organization':
    case 'org':
    case 'company':
    case 'institution':
      return 'Organization';
    case 'location':
    case 'place':
    case 'setting':
      return 'Location';
    case 'event':
    case 'occasion':
      return 'Event';
    case 'role':
    case 'title':
      return 'Role';
    case 'product':
    case 'artifact':
    case 'object':
      return 'Product';
    case 'concept':
    case 'idea':
    case 'topic':
      return 'Concept';
    default:
      return 'Concept';
  }
}

function normalizeSalience(value: unknown): number {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return Math.max(1, Math.min(5, value));
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!Number.isNaN(parsed)) {
      return Math.max(1, Math.min(5, parsed));
    }
  }
  return 3;
}

function parseExtractionResponse(content: string): ExtractionResult {
  try {
    const jsonStr = extractJsonObject(content);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);

      // Process and filter entities
      const processedEntities: ExtractedEntity[] = (parsed.entities || [])
        .map((e: any) => ({
          name: normalizeEntityName(String(e.name || '')),
          entityType: normalizeEntityType(String(e.type || 'Concept')),
          description: e.description ? String(e.description).trim() : undefined,
          salience: normalizeSalience(e.salience ?? e.importance),
          update_type: (['new', 'update', 'supplement'].includes(e.update_type)
            ? e.update_type
            : undefined) as ExtractedEntity['update_type'],
        }))
        .filter((e: ExtractedEntity) => isValidEntityName(e.name));

      // Deduplicate entities by name (keep first occurrence)
      const seenNames = new Set<string>();
      const entities: ExtractedEntity[] = [];
      for (const entity of processedEntities) {
        const normalizedName = entity.name.toLowerCase();
        if (!seenNames.has(normalizedName)) {
          seenNames.add(normalizedName);
          entities.push(entity);
        }
      }

      const entityNames = new Set(entities.map((e: ExtractedEntity) => e.name));

      // Process relationships
      const relationships: ExtractedRelationship[] = (parsed.relationships || [])
        .filter((r: any) => r.source && r.target && r.type)
        .filter((r: any) => {
          const source = normalizeEntityName(String(r.source));
          const target = normalizeEntityName(String(r.target));
          return entityNames.has(source) && entityNames.has(target);
        })
        .map((r: any) => ({
          source: normalizeEntityName(String(r.source)),
          target: normalizeEntityName(String(r.target)),
          type: String(r.type).trim().toUpperCase().replace(/\s+/g, '_'),
        }))
        .filter((r: ExtractedRelationship) => r.source !== r.target);

      const turn_type = (
        ['QUERY', 'UPDATE', 'MIXED'].includes(parsed.turn_type) ? parsed.turn_type : undefined
      ) as ExtractionResult['turn_type'];
      return { turn_type, entities, relationships };
    }
  } catch (err) {
    logger.warn(`[KNOWLEDGE] Failed to parse extraction response: ${err}`);
  }
  return { entities: [], relationships: [] };
}

function applyExtractionLimits(
  result: ExtractionResult,
  maxEntities?: number,
  maxRelationships?: number
): ExtractionResult {
  let entities = result.entities;
  let relationships = result.relationships;

  if (maxEntities && maxEntities > 0 && entities.length > maxEntities) {
    // Prefer higher salience when trimming
    entities = [...entities]
      .sort((a, b) => (b.salience || 0) - (a.salience || 0))
      .slice(0, maxEntities);
  }

  if (maxRelationships && maxRelationships > 0 && relationships.length > maxRelationships) {
    relationships = relationships.slice(0, maxRelationships);
  }

  // Ensure relationships only reference remaining entities after trimming
  if (entities.length > 0) {
    const allowed = new Set(entities.map(e => e.name));
    relationships = relationships.filter(r => allowed.has(r.source) && allowed.has(r.target));
  } else {
    relationships = [];
  }

  return { entities, relationships };
}

function parseFactResponse(content: string): ExtractedFact[] {
  try {
    const jsonStr = extractJsonObject(content);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      return (parsed.facts || [])
        .map((f: any) => ({
          content: String(f.content || ''),
          type: f.type || 'FACT',
          category: f.category || 'general',
          confidence: typeof f.confidence === 'number' ? f.confidence : 0.8,
          instanceId: f.instanceId || undefined,
          instanceType: f.instanceType || undefined,
        }))
        .filter((f: ExtractedFact) => f.content.length > 0);
    }
  } catch (err) {
    logger.warn(`[KNOWLEDGE] Failed to parse fact response: ${err}`);
  }
  return [];
}

function parseMegaBatchEntityResponse(content: string): ExtractedEntity[] {
  try {
    const jsonStr = extractJsonObject(content);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      const entities: ExtractedEntity[] = (parsed.entities || [])
        .map((e: any) => ({
          name: normalizeEntityName(String(e.name || '')),
          entityType: normalizeEntityType(String(e.type || 'Concept')),
          description: e.description ? String(e.description).trim() : undefined,
          salience: normalizeSalience(e.salience ?? e.importance),
          mentions: typeof e.mentions === 'number' ? Math.max(1, e.mentions) : 1,
        }))
        .filter((e: ExtractedEntity) => isValidEntityName(e.name));

      // Deduplicate by name
      const seenNames = new Set<string>();
      const deduped: ExtractedEntity[] = [];
      for (const entity of entities) {
        const key = entity.name.toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          deduped.push(entity);
        }
      }
      return deduped;
    }
  } catch (err) {
    logger.warn(`[KNOWLEDGE] Failed to parse mega-batch entity response: ${err}`);
  }
  return [];
}

function parseMegaBatchRelationshipResponse(
  content: string,
  allowedEntityNames: string[]
): ExtractedRelationship[] {
  try {
    const jsonStr = extractJsonObject(content);
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      const normalizedAllowed = new Set(
        allowedEntityNames.map(e => normalizeEntityName(e).toLowerCase())
      );
      return (parsed.relationships || [])
        .filter((r: any) => r.source && r.target && r.type)
        .map((r: any) => ({
          source: normalizeEntityName(String(r.source)),
          target: normalizeEntityName(String(r.target)),
          type: String(r.type).trim().toUpperCase().replace(/\s+/g, '_'),
        }))
        .filter((r: ExtractedRelationship) => {
          const srcKey = r.source.toLowerCase();
          const tgtKey = r.target.toLowerCase();
          return (
            srcKey !== tgtKey && normalizedAllowed.has(srcKey) && normalizedAllowed.has(tgtKey)
          );
        });
    }
  } catch (err) {
    logger.warn(`[KNOWLEDGE] Failed to parse mega-batch relationship response: ${err}`);
  }
  return [];
}
