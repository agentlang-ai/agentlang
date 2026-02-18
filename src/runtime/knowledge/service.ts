import { logger } from '../logger.js';
import type { GraphDatabase } from '../graph/database.js';
import { Neo4jDatabase } from '../graph/neo4j.js';
import { SemanticDeduplicator } from './deduplicator.js';
import { DocumentProcessor } from './document-processor.js';
import { ConversationProcessor } from './conversation-processor.js';
import { ContextBuilder } from './context-builder.js';
import { EntityExtractor, type ExtractedFact } from './extractor.js';
import { CoreKnowledgeModuleName } from '../modules/knowledge.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import { escapeString } from './utils.js';
import type { Instance } from '../module.js';
import type { Document, KnowledgeContext, ProcessingResult, SourceType } from '../graph/types.js';
import type { Environment } from '../interpreter.js';

// Maximum number of session messages to retain per session (prevents database bloat)
const MAX_KNOWLEDGE_SESSION_MESSAGES = parseInt(
  process.env.MAX_KNOWLEDGE_SESSION_MESSAGES || '100',
  10
);

export interface KnowledgeSessionContext {
  sessionId: string;
  userId: string;
  agentId: string;
  containerTag: string;
}

let knowledgeServiceInstance: KnowledgeService | null = null;

export class KnowledgeService {
  private graphDb: GraphDatabase;
  private deduplicator: SemanticDeduplicator;
  private documentProcessor: DocumentProcessor;
  private conversationProcessor: ConversationProcessor;
  private contextBuilder: ContextBuilder;
  private extractor: EntityExtractor;
  private processingDocuments: Set<string> = new Set();
  private processedAgents: Set<string> = new Set();
  private readonly enabled: boolean;

  constructor(graphDb?: GraphDatabase, embeddingConfig?: any) {
    this.graphDb = graphDb || new Neo4jDatabase();

    // Ensure embedding config has API key from environment
    const resolvedEmbeddingConfig = embeddingConfig || {
      provider: process.env.AGENTLANG_EMBEDDING_PROVIDER || 'openai',
      model: process.env.AGENTLANG_EMBEDDING_MODEL || 'text-embedding-3-small',
      apiKey: process.env.AGENTLANG_OPENAI_KEY || process.env.OPENAI_API_KEY,
      chunkSize: process.env.AGENTLANG_EMBEDDING_CHUNKSIZE
        ? parseInt(process.env.AGENTLANG_EMBEDDING_CHUNKSIZE, 10)
        : 1000,
      chunkOverlap: process.env.AGENTLANG_EMBEDDING_CHUNKOVERLAP
        ? parseInt(process.env.AGENTLANG_EMBEDDING_CHUNKOVERLAP, 10)
        : 200,
    };

    const hasApiKey = !!(
      resolvedEmbeddingConfig.apiKey ||
      process.env.AGENTLANG_OPENAI_KEY ||
      process.env.OPENAI_API_KEY
    );

    if (!hasApiKey) {
      logger.warn(
        '[KNOWLEDGE] No embedding API key configured (AGENTLANG_OPENAI_KEY or OPENAI_API_KEY). ' +
          'Knowledge base features are disabled. Set an API key to enable knowledge graph extraction, ' +
          'deduplication, and context retrieval.'
      );
      this.enabled = false;
    } else {
      this.enabled = true;
    }

    this.deduplicator = new SemanticDeduplicator(resolvedEmbeddingConfig);
    this.documentProcessor = new DocumentProcessor(this.graphDb, this.deduplicator);
    this.conversationProcessor = new ConversationProcessor(this.deduplicator);
    this.contextBuilder = new ContextBuilder(this.graphDb, resolvedEmbeddingConfig);
    this.extractor = new EntityExtractor();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async init(): Promise<void> {
    try {
      await this.graphDb.connect();
      logger.info('[KNOWLEDGE] Graph database connected');

      // On startup, always sync existing entity data into Neo4j so the graph
      // stays consistent even after a restart or Neo4j container recreation.
      await this.syncAllContainersToNeo4j();
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Graph database not available, running without graph DB: ${err}`);
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.graphDb.disconnect();
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Error disconnecting graph DB: ${err}`);
    }
  }

  // --- Session Management ---

  async getOrCreateSession(
    agentId: string,
    userId: string,
    agentFqName: string
  ): Promise<KnowledgeSessionContext> {
    if (!this.enabled) {
      throw new Error('Knowledge base is disabled: no embedding API key configured');
    }

    const containerTag = `${agentFqName}:${userId}`;

    try {
      const result = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSession {
          agentId? "${escapeString(agentId)}",
          userId? "${escapeString(userId)}",
          __tenant__? "${escapeString(containerTag)}"}}`,
        undefined
      );

      if (result && result.length > 0) {
        const session = result[0];
        return {
          sessionId: session.lookup('id'),
          userId: session.lookup('userId'),
          agentId: session.lookup('agentId'),
          containerTag: session.lookup('__tenant__'),
        };
      }

      logger.info(`[KNOWLEDGE] Creating new session for agentId=${agentId}, userId=${userId}`);
      const sessionStatement = `{${CoreKnowledgeModuleName}/KnowledgeSession {
          agentId "${escapeString(agentId)}",
          userId "${escapeString(userId)}",
          __tenant__ "${escapeString(containerTag)}",
          messages "[]",
          createdAt now(),
          lastActivity now()}}`;
      logger.info(`[KNOWLEDGE] Executing: ${sessionStatement}`);

      try {
        await parseAndEvaluateStatement(sessionStatement, undefined);
        logger.info(`[KNOWLEDGE] Session creation executed, now querying...`);
      } catch (parseErr) {
        logger.error(`[KNOWLEDGE] Failed to parse/create session: ${parseErr}`);
        throw parseErr;
      }

      // Query for the created session
      const queryResult = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSession {
          agentId? "${escapeString(agentId)}",
          userId? "${escapeString(userId)}",
          __tenant__? "${escapeString(containerTag)}"}}`,
        undefined
      );

      if (queryResult && queryResult.length > 0) {
        const session = queryResult[0];
        logger.info(`[KNOWLEDGE] Session found after creation: ${session.lookup('id')}`);
        return {
          sessionId: session.lookup('id'),
          userId: session.lookup('userId'),
          agentId: session.lookup('agentId'),
          containerTag: session.lookup('__tenant__'),
        };
      }

      throw new Error('Failed to create knowledge session - session not found after creation');
    } catch (err) {
      logger.error(`[KNOWLEDGE] Failed to get or create session: ${err}`);
      throw err;
    }
  }

  // --- Document Processing ---

  private static readonly EMPTY_RESULT: ProcessingResult = {
    nodes: [],
    edges: [],
    nodesCreated: 0,
    nodesMerged: 0,
    edgesCreated: 0,
  };

  async processDocument(
    document: Document,
    containerTag: string,
    userId: string,
    agentId?: string,
    env?: Environment,
    llmName?: string
  ): Promise<ProcessingResult> {
    if (!this.enabled) return KnowledgeService.EMPTY_RESULT;
    return this.documentProcessor.processDocument(
      document,
      containerTag,
      userId,
      containerTag, // tenantId
      agentId,
      env,
      llmName
    );
  }

  async processDocuments(
    documents: Document[],
    containerTag: string,
    userId: string,
    agentId?: string,
    env?: Environment,
    llmName?: string
  ): Promise<ProcessingResult> {
    if (!this.enabled) return KnowledgeService.EMPTY_RESULT;
    logger.info(`[KNOWLEDGE] processDocuments called with ${documents.length} documents`);
    const combined: ProcessingResult = {
      nodes: [],
      edges: [],
      nodesCreated: 0,
      nodesMerged: 0,
      edgesCreated: 0,
    };

    for (const doc of documents) {
      logger.info(`[KNOWLEDGE] Processing document: ${doc.name} (${doc.content.length} chars)`);
      const result = await this.processDocument(doc, containerTag, userId, agentId, env, llmName);
      logger.info(
        `[KNOWLEDGE] Document ${doc.name} processed: ${result.nodesCreated} nodes, ${result.edgesCreated} edges`
      );
      combined.nodes.push(...result.nodes);
      combined.edges.push(...result.edges);
      combined.nodesCreated += result.nodesCreated;
      combined.nodesMerged += result.nodesMerged;
      combined.edgesCreated += result.edgesCreated;
    }

    logger.info(
      `[KNOWLEDGE] All documents processed: ${combined.nodesCreated} nodes, ${combined.edgesCreated} edges total`
    );
    return combined;
  }

  // --- Context Retrieval ---

  async buildContext(
    query: string,
    containerTag: string,
    userId: string,
    agentId?: string
  ): Promise<KnowledgeContext> {
    if (!this.enabled) {
      return { entities: [], relationships: [], instanceData: [], contextString: '' };
    }
    const extraTags = await this.resolveDocumentContainerTags(agentId, containerTag, userId);
    return this.contextBuilder.buildContext(query, containerTag, userId, containerTag, extraTags);
  }

  buildContextString(context: KnowledgeContext): string {
    return context.contextString;
  }

  // --- Conversation Processing ---

  async processConversationTurn(
    userMessage: string,
    assistantResponse: string,
    session: KnowledgeSessionContext,
    env?: Environment,
    llmName?: string
  ): Promise<void> {
    if (!this.enabled) return;

    // Store conversation as session messages
    await this.storeSessionMessage(session.sessionId, 'user', userMessage);
    await this.storeSessionMessage(session.sessionId, 'assistant', assistantResponse);

    // Update session activity
    try {
      await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSession {
          id "${session.sessionId}",
          lastActivity now()}, @upsert}`,
        undefined
      );
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Failed to update session activity: ${err}`);
    }

    // Process conversation: entity extraction includes turn_type classification
    try {
      const entityResult = await this.conversationProcessor.processMessage(
        userMessage,
        assistantResponse,
        session.containerTag,
        session.userId,
        session.sessionId,
        session.agentId,
        env,
        llmName
      );

      // Only extract facts when graph was actually updated (non-query turns)
      let factsCount = 0;
      if (entityResult.nodesCreated > 0 || entityResult.nodesMerged > 0) {
        try {
          const facts = await this.extractor.extractFacts(
            userMessage,
            assistantResponse,
            env,
            llmName
          );
          if (facts.length > 0) {
            await this.storeFacts(facts, session);
            factsCount = facts.length;
          }
        } catch (err) {
          logger.debug(`[KNOWLEDGE] Fact extraction failed: ${err}`);
        }
      }

      logger.debug(
        `[KNOWLEDGE] Conversation turn: ${entityResult.nodesCreated} created, ${entityResult.nodesMerged} merged, ${factsCount} facts`
      );
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Failed to process conversation turn: ${err}`);
    }
  }

  // --- Agent Document Processing ---

  async maybeProcessAgentDocuments(
    session: KnowledgeSessionContext,
    documentTitles: string[],
    env?: Environment,
    llmName?: string
  ): Promise<void> {
    if (!this.enabled) return;
    logger.info(
      `[KNOWLEDGE] maybeProcessAgentDocuments called for session ${session.sessionId} with documents: ${documentTitles.join(', ')}`
    );
    if (documentTitles.length === 0) {
      logger.info('[KNOWLEDGE] No document titles provided, skipping');
      return;
    }

    // Check if documents are already being processed first (fast check, no DB query)
    // This prevents race conditions between concurrent requests
    const processingKey = `${session.agentId}:${documentTitles.join(',')}`;
    if (this.processingDocuments.has(processingKey)) {
      logger.info(`[KNOWLEDGE] Documents already being processed: ${documentTitles.join(', ')}`);
      return;
    }

    // Check if documents are already processed for this agent
    // We verify by checking if any DOCUMENT nodes exist for this agent
    try {
      // First check if any knowledge nodes exist for this agent's documents
      const nodeResult = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {agentId? "${session.agentId}", sourceType? "DOCUMENT"}} @limit 1`,
        undefined
      );
      if (nodeResult && nodeResult.length > 0) {
        logger.info(
          `[KNOWLEDGE] Knowledge nodes already exist for agent ${session.agentId}, skipping document processing`
        );
        this.processedAgents.add(session.agentId);
        // Mark current session as processed
        await parseAndEvaluateStatement(
          `{${CoreKnowledgeModuleName}/KnowledgeSession {
            id "${session.sessionId}",
            documentsProcessed true}, @upsert}`,
          undefined
        );
        return; // Already processed
      }

      // Also check the documentsProcessed flag on any session for this agent
      const sessionResult = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSession {agentId? "${session.agentId}", documentsProcessed true}} @limit 1`,
        undefined
      );
      if (sessionResult && sessionResult.length > 0) {
        logger.info(
          `[KNOWLEDGE] Session marked as processed for agent ${session.agentId}, skipping`
        );
        this.processedAgents.add(session.agentId);
        return;
      }
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Error checking document processing status: ${err}`);
    }

    // Only after DB checks fail, check in-memory cache
    if (this.processedAgents.has(session.agentId)) {
      logger.info(
        `[KNOWLEDGE] Documents already processed in this process for agent ${session.agentId}, skipping`
      );
      return;
    }

    // Mark as processing BEFORE any async work to prevent race conditions
    this.processingDocuments.add(processingKey);

    logger.info(
      `[KNOWLEDGE] Processing ${documentTitles.length} agent documents into knowledge graph`
    );

    try {
      // Fetch documents from agentlang.ai/Document entity
      const aiModuleName = 'agentlang.ai';
      const allDocs = await parseAndEvaluateStatement(`{${aiModuleName}/Document? {}}`, undefined);

      if (!allDocs || allDocs.length === 0) {
        logger.debug('[KNOWLEDGE] No documents found in Document store');
        return;
      }

      const matchingDocs: Document[] = [];
      for (const doc of allDocs) {
        const title = doc.lookup('title') as string;
        if (title && documentTitles.some(t => t.trim() === title.trim())) {
          const content = doc.lookup('content') as string;
          if (content) {
            matchingDocs.push({ name: title, content });
          }
        }
      }

      if (matchingDocs.length === 0) {
        logger.debug('[KNOWLEDGE] No matching documents found for knowledge graph processing');
        return;
      }

      const docContainerTag = computeSharedContainerTag(session.containerTag, session.userId);
      const result = await this.processDocuments(
        matchingDocs,
        docContainerTag,
        session.userId,
        session.agentId,
        env,
        llmName
      );

      logger.info(
        `[KNOWLEDGE] Documents processed: ${result.nodesCreated} nodes created, ` +
          `${result.nodesMerged} merged, ${result.edgesCreated} edges`
      );

      // Sync to Neo4j after document processing
      await this.syncToNeo4j(docContainerTag);

      this.processedAgents.add(session.agentId);

      // Mark documents as processed
      await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSession {
          id "${session.sessionId}",
          documentsProcessed true}, @upsert}`,
        undefined
      );
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Failed to process agent documents: ${err}`);
    } finally {
      // Always remove processing flag when done
      this.processingDocuments.delete(processingKey);
    }
  }

  // --- Neo4j Sync ---

  /**
   * Sync knowledge data from Agentlang store to Neo4j graph database.
   * Uses MERGE (upsert) so it is safe to call on every startup without
   * clearing existing data — nodes/edges are created or updated in place.
   */
  async syncToNeo4j(containerTag: string): Promise<void> {
    if (!this.graphDb.isConnected()) {
      logger.debug('[KNOWLEDGE] Neo4j not connected, skipping sync');
      return;
    }

    try {
      // Clear existing data for this container to ensure sync is idempotent
      logger.debug(`[KNOWLEDGE] Clearing existing Neo4j data for container: ${containerTag}`);
      await this.graphDb.clearContainer(containerTag);

      const nodeResults: Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {          __tenant__? "${escapeString(containerTag)}", isLatest? true}}`,
        undefined
      );

      if (!nodeResults || nodeResults.length === 0) {
        logger.info('[KNOWLEDGE] No nodes to sync to Neo4j');
        return;
      }

      let nodesSynced = 0;
      for (const inst of nodeResults) {
        try {
          const node = {
            id: inst.lookup('id') as string,
            name: inst.lookup('name') as string,
            entityType: inst.lookup('entityType') as string,
            description: inst.lookup('description') as string | undefined,
            sourceType: (inst.lookup('sourceType') as any) || 'DERIVED',
            sourceId: inst.lookup('sourceId') as string | undefined,
            sourceChunk: inst.lookup('sourceChunk') as string | undefined,
            instanceId: inst.lookup('instanceId') as string | undefined,
            instanceType: inst.lookup('instanceType') as string | undefined,
            __tenant__: inst.lookup('__tenant__') as string,
            userId: inst.lookup('userId') as string,
            agentId: inst.lookup('agentId') as string | undefined,
            confidence: (inst.lookup('confidence') as number) || 1.0,
            createdAt: new Date(),
            updatedAt: new Date(),
            isLatest: true,
          };
          await this.graphDb.upsertNode(node);
          nodesSynced++;
        } catch (err) {
          logger.error(`[KNOWLEDGE] Failed to sync node to Neo4j: ${err}`);
        }
      }

      const edgeResults: Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEdge {__tenant__? "${escapeString(containerTag)}"}}`,
        undefined
      );

      let edgesSynced = 0;
      if (edgeResults && edgeResults.length > 0) {
        for (const inst of edgeResults) {
          try {
            const edge = {
              id: inst.lookup('id') as string,
              sourceId: inst.lookup('sourceId') as string,
              targetId: inst.lookup('targetId') as string,
              relationship: inst.lookup('relType') as string,
              weight: (inst.lookup('weight') as number) || 1.0,
              sourceType: inst.lookup('sourceType') as SourceType | undefined,
            };
            await this.graphDb.upsertEdge(edge);
            edgesSynced++;
          } catch (err) {
            logger.debug(`[KNOWLEDGE] Failed to sync edge to Neo4j: ${err}`);
          }
        }
      }

      logger.info(`[KNOWLEDGE] Neo4j sync complete: ${nodesSynced} nodes, ${edgesSynced} edges`);
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Neo4j sync failed: ${err}`);
    }
  }

  /**
   * Discover all containerTags that have knowledge data and sync each to Neo4j.
   * Called on startup so Neo4j always reflects the authoritative entity store.
   */
  private async syncAllContainersToNeo4j(): Promise<void> {
    if (!this.graphDb.isConnected()) return;

    try {
      const allNodes: Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {isLatest? true}}`,
        undefined
      );

      if (!allNodes || allNodes.length === 0) {
        logger.info('[KNOWLEDGE] No existing knowledge data to sync to Neo4j');
        return;
      }

      const containerTags = new Set<string>();
      for (const inst of allNodes) {
        const tag = inst.lookup('__tenant__') as string;
        if (tag) containerTags.add(tag);
      }

      logger.info(
        `[KNOWLEDGE] Syncing ${allNodes.length} nodes across ${containerTags.size} container(s) to Neo4j`
      );

      for (const tag of containerTags) {
        await this.syncToNeo4j(tag);
      }
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Startup Neo4j sync failed: ${err}`);
    }
  }

  // --- Node Management ---

  /**
   * Supersede a node with new information. Marks the old node
   * as isLatest=false and creates a replacement.
   * Use when user provides contradictory/updated information.
   */
  async supersedeNode(
    existingNodeId: string,
    replacement: { name: string; entityType: string; description?: string },
    session: KnowledgeSessionContext
  ): Promise<void> {
    await this.deduplicator.supersedeNode(
      existingNodeId,
      replacement,
      session.containerTag,
      session.userId,
      'CONVERSATION',
      session.sessionId,
      undefined,
      session.agentId
    );
  }

  /**
   * Remove a node entirely from the knowledge graph.
   */
  async removeNode(nodeId: string): Promise<void> {
    await this.deduplicator.removeNode(nodeId);
  }

  // --- Instance Linking ---

  async linkNodeToInstance(
    nodeId: string,
    instanceId: string,
    instanceType: string
  ): Promise<void> {
    try {
      await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {
          id "${nodeId}",
          instanceId "${instanceId}",
          instanceType "${instanceType}"}, @upsert}`,
        undefined
      );

      if (this.graphDb.isConnected()) {
        await this.graphDb.updateNode(nodeId, { instanceId, instanceType });
      }
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Failed to link node to instance: ${err}`);
    }
  }

  // --- Private Helpers ---

  private async storeSessionMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    try {
      await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/SessionMessage {
          role "${role}",
          content "${escapeString(content)}",
          sessionId "${sessionId}"}}`,
        undefined
      );
      // Clean up old messages to prevent database bloat
      await this.cleanupOldSessionMessages(sessionId);
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Failed to store session message: ${err}`);
    }
  }

  private async cleanupOldSessionMessages(sessionId: string): Promise<void> {
    try {
      // Delete old messages keeping only the most recent MAX_KNOWLEDGE_SESSION_MESSAGES
      await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/SessionMessage {
          sessionId "${sessionId}"},
          @delete {
            @sort {"createdAt": "asc"},
            @offset ${MAX_KNOWLEDGE_SESSION_MESSAGES},
            @limit 1000
          }}`,
        undefined
      );
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Failed to cleanup old session messages: ${err}`);
    }
  }

  private async storeFacts(
    facts: ExtractedFact[],
    session: KnowledgeSessionContext
  ): Promise<void> {
    for (const fact of facts) {
      try {
        await this.deduplicator.findOrCreateNode(
          { name: fact.content, entityType: 'Fact', description: fact.category },
          session.containerTag,
          session.userId,
          session.containerTag,
          'CONVERSATION',
          session.sessionId,
          undefined,
          session.agentId
        );
      } catch (err) {
        logger.debug(`[KNOWLEDGE] Failed to store fact: ${err}`);
      }
    }
  }

  private async resolveDocumentContainerTags(
    agentId: string | undefined,
    containerTag: string,
    userId: string
  ): Promise<string[]> {
    const tags = new Set<string>();
    const sharedTag = computeSharedContainerTag(containerTag, userId);
    if (sharedTag) {
      tags.add(sharedTag);
    }

    if (!agentId) {
      return Array.from(tags);
    }

    try {
      const results: Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {agentId? "${agentId}", sourceType? "DOCUMENT"}} @limit 10`,
        undefined
      );
      if (results && results.length > 0) {
        for (const inst of results) {
          const tag = inst.lookup('__tenant__') as string | undefined;
          if (tag) tags.add(tag);
        }
      }
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Failed to resolve document container tags: ${err}`);
    }

    return Array.from(tags);
  }
}

function computeSharedContainerTag(containerTag: string, userId: string): string {
  if (containerTag.endsWith(':shared')) {
    return containerTag;
  }
  const suffix = `:${userId}`;
  if (containerTag.endsWith(suffix)) {
    return `${containerTag.slice(0, -suffix.length)}:shared`;
  }
  return `${containerTag}:shared`;
}

export function getKnowledgeService(): KnowledgeService {
  if (!knowledgeServiceInstance) {
    knowledgeServiceInstance = new KnowledgeService();
  }
  return knowledgeServiceInstance;
}

export function resetKnowledgeService(): void {
  if (knowledgeServiceInstance) {
    knowledgeServiceInstance.shutdown().catch(() => {});
    knowledgeServiceInstance = null;
  }
}
