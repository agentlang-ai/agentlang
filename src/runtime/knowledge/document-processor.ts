import { logger } from '../logger.js';
import { TextChunker } from '../embeddings/chunker.js';
import { EntityExtractor } from './extractor.js';
import { SemanticDeduplicator } from './deduplicator.js';
import { CoreKnowledgeModuleName } from '../modules/knowledge.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import type {
  Document,
  ExtractedEntity,
  ExtractedRelationship,
  GraphEdge,
  GraphNode,
  ProcessingResult,
} from '../graph/types.js';
import type { GraphDatabase } from '../graph/database.js';
import { Environment } from '../interpreter.js';
import { TYPE_PRIORITY, escapeString, shouldPreferType } from './utils.js';
import { findProviderForLLM } from '../modules/ai.js';

const DEFAULT_CHUNK_SIZE = parseInt(process.env.KG_CHUNK_SIZE || '1000', 10);
const DEFAULT_CHUNK_OVERLAP = parseInt(process.env.KG_CHUNK_OVERLAP || '200', 10);
const MAX_DOCUMENT_NODES = parseInt(process.env.KG_MAX_DOCUMENT_NODES || '1000', 10);
const MAX_DOCUMENT_EDGES = parseInt(process.env.KG_MAX_DOCUMENT_EDGES || '2000', 10);
const MAX_MEGA_BATCH_CHARS = parseInt(process.env.KG_MEGA_BATCH_CHARS || '50000', 10);
const MAX_ENTITIES_PER_BATCH = parseInt(process.env.KG_MAX_ENTITIES_PER_BATCH || '50', 10);
const MAX_RELATIONSHIPS_PER_BATCH = parseInt(
  process.env.KG_MAX_RELATIONSHIPS_PER_BATCH || '100',
  10
);

const CORE_ENTITY_LIMIT = parseInt(process.env.KG_CORE_ENTITY_LIMIT || '60', 10);
const CORE_ENTITY_PER_TYPE = parseInt(process.env.KG_CORE_ENTITY_PER_TYPE || '20', 10);
const MIN_ENTITY_MENTIONS = parseInt(process.env.KG_MIN_ENTITY_MENTIONS || '2', 10);
const MIN_ENTITY_SALIENCE = parseFloat(process.env.KG_MIN_ENTITY_SALIENCE || '3');
const EDGE_WEIGHT_CAP = parseInt(process.env.KG_EDGE_WEIGHT_CAP || '10', 10);
const LLM_CONCURRENCY = parseInt(process.env.KG_LLM_CONCURRENCY || '5', 10);

interface EntityCandidate {
  key: string;
  name: string;
  type: string;
  description?: string;
  mentions: number;
  salienceSum: number;
  salienceCount: number;
  bestSalience: number;
  sampleChunk?: string;
}

interface CandidateScore extends EntityCandidate {
  salienceAvg: number;
  score: number;
}

interface RelationshipCandidate {
  key: string;
  source: string;
  target: string;
  sourceKey: string;
  targetKey: string;
  type: string;
  count: number;
}

export class DocumentProcessor {
  private chunker: TextChunker;
  private extractor: EntityExtractor;
  private deduplicator: SemanticDeduplicator;

  constructor(_graphDb: GraphDatabase, deduplicator: SemanticDeduplicator) {
    this.chunker = new TextChunker(DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP);
    this.extractor = new EntityExtractor();
    this.deduplicator = deduplicator;
  }

  async processDocument(
    document: Document,
    containerTag: string,
    userId: string,
    agentId?: string,
    env?: Environment,
    llmName?: string
  ): Promise<ProcessingResult> {
    logger.info(`[KNOWLEDGE] Processing document: ${document.name}`);
    const startTime = Date.now();

    let nodesCreated = 0;
    let nodesMerged = 0;
    let edgesCreated = 0;

    // Phase 1: Chunk & build mega-batches
    const megaBatches: string[] = [];
    let currentBatch = '';
    let chunksProcessed = 0;

    const chunkGenerator = this.chunker.streamChunks(document.content);
    for (const chunk of chunkGenerator) {
      chunksProcessed++;
      if (currentBatch.length + chunk.length > MAX_MEGA_BATCH_CHARS && currentBatch.length > 0) {
        megaBatches.push(currentBatch);
        currentBatch = '';
      }
      currentBatch += (currentBatch.length > 0 ? '\n\n' : '') + chunk;
    }
    if (currentBatch.length > 0) {
      megaBatches.push(currentBatch);
    }

    logger.info(
      `[KNOWLEDGE] Document "${document.name}": ${chunksProcessed} chunks grouped into ${megaBatches.length} mega-batches`
    );

    // Pre-warm the LLM provider cache so parallel workers don't all hit the DB simultaneously
    try {
      await findProviderForLLM(llmName || 'default', env || new Environment());
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Provider pre-warm failed (will retry in workers): ${err}`);
    }

    // Phase 2: Entity extraction (1 LLM call per mega-batch, parallel)
    const candidateEntities = new Map<string, EntityCandidate>();

    const entityResults = await runParallel(
      megaBatches,
      async (batch, i) => {
        logger.info(
          `[KNOWLEDGE] Entity extraction: mega-batch ${i + 1}/${megaBatches.length} (${batch.length} chars)`
        );
        try {
          const entities = await this.extractor.extractEntitiesFromBatch(
            batch,
            env,
            llmName,
            MAX_ENTITIES_PER_BATCH
          );
          logger.info(`[KNOWLEDGE] Extracted ${entities.length} entities from mega-batch ${i + 1}`);
          return { index: i, entities };
        } catch (err) {
          logger.warn(`[KNOWLEDGE] Failed to extract entities from mega-batch ${i + 1}: ${err}`);
          return { index: i, entities: [] as ExtractedEntity[] };
        }
      },
      LLM_CONCURRENCY
    );

    for (const { index, entities } of entityResults) {
      for (const entity of entities) {
        this.recordCandidateEntity(candidateEntities, entity, megaBatches[index].substring(0, 500));
      }
    }

    // Phase 3: Core entity selection (no API calls)
    const coreEntities = selectCoreEntities(
      candidateEntities,
      CORE_ENTITY_LIMIT,
      CORE_ENTITY_PER_TYPE,
      MIN_ENTITY_MENTIONS,
      MIN_ENTITY_SALIENCE,
      MAX_DOCUMENT_NODES
    );

    if (coreEntities.length === 0) {
      logger.info('[KNOWLEDGE] No core entities selected, skipping graph creation');
      return { nodes: [], edges: [], nodesCreated: 0, nodesMerged: 0, edgesCreated: 0 };
    }

    logger.info(`[KNOWLEDGE] Selected ${coreEntities.length} core entities`);

    // Phase 4: Batch node creation (dedup + single batch embedding call)
    const coreNodeMap = new Map<string, GraphNode>();
    const seenNodeIds = new Set<string>();

    const entitiesToCreate = coreEntities.map(e => ({
      name: e.name,
      type: e.type,
      description: e.description,
    }));
    const sourceChunks = new Map<string, string>();
    for (const e of coreEntities) {
      if (e.sampleChunk) sourceChunks.set(e.name.toLowerCase(), e.sampleChunk);
    }

    const nodes = await this.deduplicator.findOrCreateNodesBatch(
      entitiesToCreate,
      containerTag,
      userId,
      'DOCUMENT',
      document.name,
      sourceChunks,
      agentId
    );

    for (let i = 0; i < coreEntities.length; i++) {
      const node = nodes[i];
      coreNodeMap.set(coreEntities[i].key, node);
      if (seenNodeIds.has(node.id)) {
        nodesMerged++;
      } else {
        nodesCreated++;
        seenNodeIds.add(node.id);
      }
    }

    // Phase 5: Relationship extraction (1 LLM call per mega-batch, parallel, restricted to core entities)
    const coreEntityNames = coreEntities.map(e => e.name);
    const candidateRelationships = new Map<string, RelationshipCandidate>();

    const relResults = await runParallel(
      megaBatches,
      async (batch, i) => {
        logger.info(
          `[KNOWLEDGE] Relationship extraction: mega-batch ${i + 1}/${megaBatches.length}`
        );
        try {
          const relationships = await this.extractor.extractRelationshipsFromBatch(
            batch,
            coreEntityNames,
            env,
            llmName,
            MAX_RELATIONSHIPS_PER_BATCH
          );
          logger.info(
            `[KNOWLEDGE] Extracted ${relationships.length} relationships from mega-batch ${i + 1}`
          );
          return relationships;
        } catch (err) {
          logger.warn(
            `[KNOWLEDGE] Failed to extract relationships from mega-batch ${i + 1}: ${err}`
          );
          return [] as ExtractedRelationship[];
        }
      },
      LLM_CONCURRENCY
    );

    for (const relationships of relResults) {
      for (const rel of relationships) {
        this.recordCandidateRelationship(candidateRelationships, rel);
      }
    }

    // Create edges from accumulated relationships
    for (const rel of candidateRelationships.values()) {
      if (edgesCreated >= MAX_DOCUMENT_EDGES) break;
      const edge = await this.createEdgeFromCandidate(
        rel,
        coreNodeMap,
        containerTag,
        userId,
        agentId
      );
      if (edge) {
        edgesCreated++;
      }
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `[KNOWLEDGE] Document "${document.name}" processed in ${elapsed}ms: ` +
        `${nodesCreated} nodes created, ${nodesMerged} merged, ${edgesCreated} edges ` +
        `(${megaBatches.length} mega-batches from ${chunksProcessed} chunks)`
    );

    return { nodes: [], edges: [], nodesCreated, nodesMerged, edgesCreated };
  }

  private recordCandidateEntity(
    candidates: Map<string, EntityCandidate>,
    entity: ExtractedEntity,
    sampleText: string
  ) {
    const key = entity.name.toLowerCase();
    const salience = typeof entity.salience === 'number' ? entity.salience : 3;
    const mentions = Math.max(1, Math.min(entity.mentions ?? 1, 50));
    const existing = candidates.get(key);
    if (existing) {
      existing.mentions += mentions;
      existing.salienceSum += salience;
      existing.salienceCount++;
      if (salience > existing.bestSalience) {
        existing.bestSalience = salience;
        existing.sampleChunk = sampleText;
      }
      if (entity.description) {
        if (!existing.description) {
          existing.description = entity.description;
        } else if (
          entity.description.length > existing.description.length &&
          !existing.description.includes(entity.description)
        ) {
          existing.description = entity.description;
        }
      }
      if (entity.type && shouldPreferType(entity.type, existing.type)) {
        existing.type = entity.type;
      }
      return;
    }

    candidates.set(key, {
      key,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      mentions,
      salienceSum: salience,
      salienceCount: 1,
      bestSalience: salience,
      sampleChunk: sampleText,
    });
  }

  private recordCandidateRelationship(
    candidates: Map<string, RelationshipCandidate>,
    rel: ExtractedRelationship
  ) {
    const sourceKey = rel.source.toLowerCase();
    const targetKey = rel.target.toLowerCase();
    if (sourceKey === targetKey) return;
    const key = `${sourceKey}|${rel.type}|${targetKey}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.count++;
      return;
    }
    candidates.set(key, {
      key,
      source: rel.source,
      target: rel.target,
      sourceKey,
      targetKey,
      type: rel.type,
      count: 1,
    });
  }

  private async createEdgeFromCandidate(
    rel: RelationshipCandidate,
    nodeMap: Map<string, GraphNode>,
    containerTag: string,
    userId: string,
    agentId?: string
  ): Promise<GraphEdge | null> {
    const sourceNode = nodeMap.get(rel.sourceKey);
    const targetNode = nodeMap.get(rel.targetKey);
    if (!sourceNode || !targetNode) return null;
    if (sourceNode.id === targetNode.id) return null;

    const candidateWeight = Math.min(rel.count, EDGE_WEIGHT_CAP);

    // Check for existing edge and update weight instead of creating a duplicate
    try {
      const existing: import('../module.js').Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEdge {` +
          `sourceId? "${sourceNode.id}", ` +
          `targetId? "${targetNode.id}", ` +
          `relType? "${escapeString(rel.type)}"}, ` +
          `@limit 1}`,
        undefined
      );

      if (existing && existing.length > 0) {
        const inst = existing[0];
        const currentWeight = (inst.lookup('weight') as number) || 1.0;
        const newWeight = Math.min(currentWeight + candidateWeight, EDGE_WEIGHT_CAP);
        await parseAndEvaluateStatement(
          `{${CoreKnowledgeModuleName}/KnowledgeEdge {` +
            `id "${inst.lookup('id')}", ` +
            `weight ${newWeight}}, @upsert}`,
          undefined
        );
        return {
          id: inst.lookup('id') as string,
          sourceId: sourceNode.id,
          targetId: targetNode.id,
          relationship: rel.type,
          weight: newWeight,
          sourceType: 'DOCUMENT',
        };
      }
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Edge dedup lookup failed, creating new: ${err}`);
    }

    const edge: GraphEdge = {
      sourceId: sourceNode.id,
      targetId: targetNode.id,
      relationship: rel.type,
      weight: candidateWeight,
      sourceType: 'DOCUMENT',
    };

    try {
      const result = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEdge {` +
          `sourceId "${edge.sourceId}", ` +
          `targetId "${edge.targetId}", ` +
          `relType "${escapeString(edge.relationship)}", ` +
          `weight ${edge.weight}, ` +
          `sourceType "DOCUMENT", ` +
          `containerTag "${escapeString(containerTag)}", ` +
          `userId "${escapeString(userId)}"` +
          (agentId ? `, agentId "${escapeString(agentId)}"` : '') +
          `}}`,
        undefined
      );
      const inst = Array.isArray(result) ? result[0] : result;
      if (inst) {
        edge.id = inst.lookup('id') as string;
      }
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Failed to store edge in entity store: ${err}`);
    }

    return edge;
  }
}

async function runParallel<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function selectCoreEntities(
  candidates: Map<string, EntityCandidate>,
  coreLimit: number,
  perTypeLimit: number,
  minMentions: number,
  minSalience: number,
  maxNodes: number
): CandidateScore[] {
  const scored = Array.from(candidates.values()).map(candidate => {
    const salienceAvg = candidate.salienceSum / Math.max(1, candidate.salienceCount);
    const score = candidate.mentions * 2 + salienceAvg;
    return { ...candidate, salienceAvg, score };
  });

  const shouldInclude = (c: CandidateScore) =>
    c.mentions >= minMentions || c.salienceAvg >= minSalience || c.bestSalience >= minSalience;

  const byType = new Map<string, CandidateScore[]>();
  for (const candidate of scored) {
    if (!byType.has(candidate.type)) byType.set(candidate.type, []);
    byType.get(candidate.type)!.push(candidate);
  }

  const selected = new Map<string, CandidateScore>();

  const sortedTypes = Array.from(byType.entries()).sort((a, b) => {
    return (TYPE_PRIORITY[b[0]] || 0) - (TYPE_PRIORITY[a[0]] || 0);
  });

  for (const [_type, list] of sortedTypes) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    let added = 0;
    for (const candidate of sorted) {
      if (selected.size >= coreLimit || added >= perTypeLimit) break;
      if (!shouldInclude(candidate)) continue;
      selected.set(candidate.key, candidate);
      added++;
    }
  }

  if (selected.size < coreLimit) {
    const remaining = scored.filter(c => !selected.has(c.key)).sort((a, b) => b.score - a.score);
    for (const candidate of remaining) {
      if (selected.size >= coreLimit) break;
      if (!shouldInclude(candidate)) continue;
      selected.set(candidate.key, candidate);
    }
  }

  let results = Array.from(selected.values());
  if (results.length > maxNodes) {
    results = results.sort((a, b) => b.score - a.score).slice(0, maxNodes);
  }
  return results;
}
