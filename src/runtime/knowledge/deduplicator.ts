import { logger } from '../logger.js';
import type { ExtractedEntity, GraphNode, SourceType } from '../graph/types.js';
import { EmbeddingService } from '../resolvers/sqldb/impl.js';
import { CoreKnowledgeModuleName } from '../modules/knowledge.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import type { Instance } from '../module.js';
import {
  escapeString,
  instanceToGraphNode,
  isTypeCompatible,
  nameSimilarity,
  normalizeForMatch,
  shouldPreferType,
} from './utils.js';

// Disable embeddings if no API key is configured (fallback to exact matching only)
const EMBEDDINGS_ENABLED = process.env.KG_DISABLE_EMBEDDINGS !== 'true';
const SIMILARITY_THRESHOLD = parseFloat(process.env.KG_DEDUP_SIMILARITY_THRESHOLD || '0.85');
const MAX_SIMILAR_CANDIDATES = parseInt(process.env.KG_DEDUP_MAX_CANDIDATES || '5', 10);

export class SemanticDeduplicator {
  private embeddingService: EmbeddingService | null = null;
  private embeddingConfig: any;

  constructor(embeddingConfig?: any) {
    this.embeddingConfig = embeddingConfig;
  }

  /**
   * Normalize node name for consistent deduplication
   */
  private normalizeNodeName(name: string): string {
    // Trim whitespace
    let normalized = name.trim();

    // Collapse multiple spaces
    normalized = normalized.replace(/\s+/g, ' ');

    // Remove leading/trailing punctuation
    normalized = normalized.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');

    // Remove trailing possessive ("Alice's" -> "Alice")
    normalized = normalized.replace(/['’]s$/i, '');

    // Preserve acronyms (all-uppercase tokens >1 char)
    // Title case other words for consistency
    normalized = normalized
      .split(' ')
      .map(token => {
        if (token.length > 1 && token === token.toUpperCase()) {
          return token; // Preserve acronyms like NASA, API, GPT
        }
        return token.toLowerCase().replace(/^\w/, c => c.toUpperCase());
      })
      .join(' ');

    return normalized;
  }

  private getEmbeddingService(): EmbeddingService | null {
    if (!EMBEDDINGS_ENABLED) {
      return null;
    }
    if (!this.embeddingService) {
      // Check if we have an API key configured
      const hasApiKey =
        this.embeddingConfig?.apiKey ||
        process.env.AGENTLANG_OPENAI_KEY ||
        process.env.OPENAI_API_KEY;
      if (!hasApiKey) {
        logger.warn(
          '[KNOWLEDGE] No embedding API key configured, falling back to exact name matching'
        );
        return null;
      }
      this.embeddingService = new EmbeddingService(this.embeddingConfig);
    }
    return this.embeddingService;
  }

  /**
   * Find or create a node with incremental processing:
   * 1. Check for exact name match first (fast, no API call)
   * 2. If no match, generate embedding and store it
   * 3. Create new node with the embedding
   *
   * Note: Full vector similarity search requires DbContext which is not
   * available here. The vector search happens at query time via context-builder.
   */
  async findOrCreateNode(
    entity: ExtractedEntity,
    containerTag: string,
    tenantId: string,
    sourceType: SourceType,
    sourceId?: string,
    sourceChunk?: string,
    agentId?: string
  ): Promise<GraphNode> {
    // Normalize the entity name
    const normalizedName = this.normalizeNodeName(entity.name);
    entity.name = normalizedName; // Use normalized name

    // Step 1: Check for exact name match (fast, no memory overhead)
    const existingNode = await this.findNodeByExactName(normalizedName, containerTag, tenantId);

    if (existingNode) {
      logger.debug(`[KNOWLEDGE] Found existing node "${existingNode.name}" for "${entity.name}"`);
      return await this.mergeNode(existingNode, entity);
    }

    // Step 1b: Semantic similarity search (vector search + string similarity)
    const similarNode = await this.findSimilarNode(entity, containerTag, tenantId);
    if (similarNode) {
      logger.debug(`[KNOWLEDGE] Found similar node "${similarNode.name}" for "${entity.name}"`);
      return await this.mergeNode(similarNode, entity);
    }

    // Step 2: Generate embedding for the new entity (incremental)
    // Generate ONE embedding at a time, store it, release memory
    let embedding: number[] | null = null;

    const embeddingService = this.getEmbeddingService();
    if (embeddingService) {
      try {
        const embeddingText =
          `${entity.name} ${entity.entityType} ${entity.description || ''}`.trim();
        embedding = await embeddingService.embedText(embeddingText);
        logger.debug(
          `[KNOWLEDGE] Generated embedding for "${entity.name}" (${embedding.length} dimensions)`
        );
      } catch (err) {
        logger.warn(`[KNOWLEDGE] Embedding generation failed for "${entity.name}": ${err}`);
        // Continue without embedding - will use fullTextSearch instead
      }
    }

    // Step 3: Create new node (embedding will be stored by the resolver)
    return await this.createNewNode(
      entity,
      containerTag,
      sourceType,
      sourceId,
      sourceChunk,
      agentId,
      embedding
    );
  }

  /**
   * Batch version of findOrCreateNode.
   * Deduplicates each entity individually, then generates embeddings
   * for all truly new entities in a single batch API call.
   */
  async findOrCreateNodesBatch(
    entities: ExtractedEntity[],
    containerTag: string,
    tenantId: string,
    sourceType: SourceType,
    sourceId?: string,
    sourceChunks?: Map<string, string>,
    agentId?: string
  ): Promise<GraphNode[]> {
    if (entities.length === 0) return [];

    const results: GraphNode[] = [];
    const needsEmbedding: { entity: ExtractedEntity; index: number; sourceChunk?: string }[] = [];

    // Step 1: Dedup check each entity (DB queries only, no embedding API calls)
    for (let i = 0; i < entities.length; i++) {
      const entity = { ...entities[i] };
      entity.name = this.normalizeNodeName(entity.name);

      // Check exact name match
      const existingNode = await this.findNodeByExactName(entity.name, containerTag, tenantId);
      if (existingNode) {
        logger.debug(`[KNOWLEDGE] Batch: found existing node "${existingNode.name}"`);
        results.push(await this.mergeNode(existingNode, entity));
        continue;
      }

      // Check similarity match
      const similarNode = await this.findSimilarNode(entity, containerTag, tenantId);
      if (similarNode) {
        logger.debug(`[KNOWLEDGE] Batch: found similar node "${similarNode.name}"`);
        results.push(await this.mergeNode(similarNode, entity));
        continue;
      }

      // This entity is truly new — needs embedding + creation
      const chunk = sourceChunks?.get(entity.name.toLowerCase());
      needsEmbedding.push({ entity, index: i, sourceChunk: chunk });
      results.push(null as any); // placeholder, will be filled below
    }

    if (needsEmbedding.length === 0) {
      logger.info(`[KNOWLEDGE] Batch: all ${entities.length} entities matched existing nodes`);
      return results;
    }

    // Step 2: Batch embed all new entities in ONE API call
    let embeddings: number[][] = [];
    const embeddingService = this.getEmbeddingService();
    if (embeddingService) {
      try {
        const textsToEmbed = needsEmbedding.map(item =>
          `${item.entity.name} ${item.entity.entityType} ${item.entity.description || ''}`.trim()
        );
        logger.info(
          `[KNOWLEDGE] Batch: generating embeddings for ${textsToEmbed.length} new entities in 1 API call`
        );
        embeddings = await embeddingService.embedTexts(textsToEmbed);
        logger.info(
          `[KNOWLEDGE] Batch: embeddings generated (${embeddings.length} × ${embeddings[0]?.length || 0}d)`
        );
      } catch (err) {
        logger.warn(`[KNOWLEDGE] Batch embedding failed, continuing without embeddings: ${err}`);
        embeddings = needsEmbedding.map(() => []);
      }
    }

    // Step 3: Create all new nodes with their precomputed embeddings
    for (let i = 0; i < needsEmbedding.length; i++) {
      const { entity, index, sourceChunk } = needsEmbedding[i];
      const embedding = embeddings[i] || null;
      const node = await this.createNewNode(
        entity,
        containerTag,
        sourceType,
        sourceId,
        sourceChunk,
        agentId,
        embedding
      );
      results[index] = node;
    }

    logger.info(
      `[KNOWLEDGE] Batch: ${entities.length} entities processed — ` +
        `${entities.length - needsEmbedding.length} matched, ${needsEmbedding.length} created`
    );

    return results;
  }

  /**
   * Find node by exact name match (case-insensitive)
   * Uses database query with name filter - O(1) with index
   */
  private async findNodeByExactName(
    normalizedName: string,
    containerTag: string,
    tenantId: string
  ): Promise<GraphNode | null> {
    try {
      // Query directly by name instead of scanning recent nodes
      // This is much more efficient and prevents duplicates
      const result: Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {name? "${escapeString(normalizedName)}", containerTag? "${escapeString(containerTag)}", __tenant__? "${escapeString(tenantId)}", isLatest? true}}`,
        undefined
      );

      if (!result || result.length === 0) return null;

      // Return the first match (should only be one since we query by exact name)
      return instanceToGraphNode(result[0]);
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Name search failed: ${err}`);
      return null;
    }
  }

  private async findSimilarNode(
    entity: ExtractedEntity,
    containerTag: string,
    tenantId: string
  ): Promise<GraphNode | null> {
    try {
      // Search using entity name only — do NOT pollute with type/description
      // which degrades full-text search quality
      const result: Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {` +
          `containerTag? "${escapeString(containerTag)}", ` +
          `__tenant__? "${escapeString(tenantId)}", ` +
          `isLatest? true, ` +
          `name? "${escapeString(entity.name)}"}, ` +
          `@limit ${MAX_SIMILAR_CANDIDATES}}`,
        undefined
      );

      if (!result || result.length === 0) return null;

      const queryName = normalizeForMatch(entity.name);
      let bestMatch: { node: GraphNode; score: number } | null = null;

      for (const inst of result) {
        const candidate = instanceToGraphNode(inst);
        const candidateName = normalizeForMatch(candidate.name);
        const nameScore = nameSimilarity(queryName, candidateName);
        const typeCompatible = isTypeCompatible(entity.entityType, candidate.entityType);
        const score = typeCompatible ? nameScore : nameScore * 0.7;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { node: candidate, score };
        }
      }

      if (bestMatch && bestMatch.score >= SIMILARITY_THRESHOLD) {
        return bestMatch.node;
      }
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Similarity search failed: ${err}`);
    }
    return null;
  }

  private async mergeNode(existing: GraphNode, entity: ExtractedEntity): Promise<GraphNode> {
    const updates: Partial<GraphNode> = {};

    // Update description based on LLM-classified update_type
    if (entity.description) {
      if (!existing.description) {
        updates.description = entity.description;
      } else if (entity.update_type === 'update') {
        // LLM flagged this as corrected/changed info — replace with newer
        updates.description = entity.description;
      } else if (entity.update_type === 'supplement') {
        // LLM flagged this as additional info about a different aspect — combine
        if (!existing.description.includes(entity.description)) {
          const combined = `${existing.description}; ${entity.description}`;
          updates.description =
            combined.length <= 500 ? combined : combined.substring(0, 497) + '...';
        }
      } else if (
        entity.description.length > existing.description.length &&
        !existing.description.includes(entity.description)
      ) {
        // Fallback for entities without update_type: keep longer description
        updates.description = entity.description;
      }
    }

    // Boost confidence when the same entity is seen again (max 1.0)
    const newConfidence = Math.min(1.0, (existing.confidence || 0.8) + 0.05);
    if (newConfidence !== existing.confidence) {
      updates.confidence = newConfidence;
    }

    if (entity.entityType && shouldPreferType(entity.entityType, existing.entityType)) {
      updates.entityType = entity.entityType;
    }

    if (Object.keys(updates).length > 0) {
      try {
        const setClauses: string[] = [];
        if (updates.description) {
          setClauses.push(`description "${escapeString(updates.description)}"`);
        }
        if (updates.confidence !== undefined) {
          setClauses.push(`confidence ${updates.confidence}`);
        }
        if (setClauses.length > 0) {
          await parseAndEvaluateStatement(
            `{${CoreKnowledgeModuleName}/KnowledgeEntity {id "${existing.id}", ${setClauses.join(', ')}}, @upsert}`,
            undefined
          );
        }
      } catch (err) {
        logger.warn(`[KNOWLEDGE] Failed to merge node: ${err}`);
      }
    }
    return { ...existing, ...updates };
  }

  async supersedeNode(
    existingId: string,
    replacement: ExtractedEntity,
    containerTag: string,
    sourceType: SourceType,
    sourceId?: string,
    sourceChunk?: string,
    agentId?: string
  ): Promise<GraphNode> {
    try {
      await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {id "${existingId}", isLatest false}, @upsert}`,
        undefined
      );
      logger.info(`[KNOWLEDGE] Superseded node ${existingId.substring(0, 8)}... with new info`);
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Failed to mark node as superseded: ${err}`);
    }

    // Generate embedding for replacement
    let embedding: number[] | null = null;
    const embeddingService2 = this.getEmbeddingService();
    if (embeddingService2) {
      try {
        const embeddingText =
          `${replacement.name} ${replacement.entityType} ${replacement.description || ''}`.trim();
        embedding = await embeddingService2.embedText(embeddingText);
      } catch (err) {
        logger.debug(`[KNOWLEDGE] Embedding generation failed for replacement: ${err}`);
      }
    }

    return await this.createNewNode(
      replacement,
      containerTag,
      sourceType,
      sourceId,
      sourceChunk,
      agentId,
      embedding
    );
  }

  async removeNode(nodeId: string): Promise<void> {
    try {
      await parseAndEvaluateStatement(
        `purge {${CoreKnowledgeModuleName}/KnowledgeEntity {id? "${nodeId}"}}`,
        undefined
      );
      // Also remove edges referencing this node
      try {
        await parseAndEvaluateStatement(
          `purge {${CoreKnowledgeModuleName}/KnowledgeEdge {sourceId? "${nodeId}"}}`,
          undefined
        );
        await parseAndEvaluateStatement(
          `purge {${CoreKnowledgeModuleName}/KnowledgeEdge {targetId? "${nodeId}"}}`,
          undefined
        );
      } catch {
        // Edge cleanup is best-effort
      }
      logger.info(`[KNOWLEDGE] Removed node ${nodeId.substring(0, 8)}...`);
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Failed to remove node: ${err}`);
    }
  }

  private async createNewNode(
    entity: ExtractedEntity,
    containerTag: string,
    sourceType: SourceType,
    sourceId?: string,
    sourceChunk?: string,
    agentId?: string,
    embedding?: number[] | null
  ): Promise<GraphNode> {
    // Create in Agentlang first to get a UUID
    let query =
      `{${CoreKnowledgeModuleName}/KnowledgeEntity {` +
      `name "${escapeString(entity.name)}", ` +
      `entityType "${escapeString(entity.entityType)}", ` +
      `sourceType "${sourceType}", ` +
      `__tenant__ "${containerTag}", ` +
      `isLatest true, ` +
      `confidence 1.0`;

    if (entity.description) {
      query += `, description "${escapeString(entity.description)}"`;
    }
    if (sourceId) {
      query += `, sourceId "${escapeString(sourceId)}"`;
    }
    if (sourceChunk) {
      query += `, sourceChunk "${escapeString(sourceChunk.substring(0, 500))}"`;
    }
    if (agentId) {
      query += `, agentId "${escapeString(agentId)}"`;
    }
    if (embedding && embedding.length > 0) {
      query += `, embedding "${escapeString(JSON.stringify(embedding))}"`;
    }
    query += `}}`;

    logger.info(`[KNOWLEDGE] Creating node with query: ${query.substring(0, 100)}...`);
    const result = await parseAndEvaluateStatement(query, undefined);
    logger.info(`[KNOWLEDGE] Node creation result: ${result ? 'success' : 'null'}`);

    const inst = Array.isArray(result) ? result[0] : result;
    if (!inst) {
      logger.error(`[KNOWLEDGE] Failed to create node - no instance returned`);
      throw new Error('Failed to create node');
    }

    const node = instanceToGraphNode(inst);
    logger.info(`[KNOWLEDGE] Node created: ${node.id} (${node.name})`);

    if (embedding && embedding.length > 0) {
      logger.debug(
        `[KNOWLEDGE] Node ${node.id.substring(0, 8)}... created with embedding (${embedding.length}d)`
      );
    }

    return node;
  }
}
