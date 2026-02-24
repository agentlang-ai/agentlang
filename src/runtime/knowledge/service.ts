import { logger } from '../logger.js';
import { CoreKnowledgeModuleName } from '../modules/knowledge.js';
import { parseAndEvaluateStatement, Environment } from '../interpreter.js';
import { escapeString } from './utils.js';
import type { KnowledgeContext, ProcessingResult, SourceType } from '../graph/types.js';
import { isKnowledgeGraphEnabled, getKnowledgeGraphConfig } from '../state.js';

// Maximum number of session messages to retain per session (prevents database bloat)
const MAX_KNOWLEDGE_SESSION_MESSAGES = parseInt(
  process.env.MAX_KNOWLEDGE_SESSION_MESSAGES || '100',
  10
);

export interface KnowledgeSessionContext {
  sessionId: string;
  agentId: string;
}

let knowledgeServiceInstance: KnowledgeService | null = null;

function normalizeKnowledgeQueryPayload(payload: any): any {
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (first && typeof first === 'object' && first.KnowledgeQuery) {
    return first.KnowledgeQuery;
  }
  return first;
}

/**
 * KnowledgeService — thin client that delegates all knowledge operations
 * to a remote knowledge-service instance.
 *
 * When knowledgeGraph.enabled is true and knowledgeGraph.serviceUrl is set,
 * all embedding, chunking, graph storage, and retrieval is handled remotely.
 */
export class KnowledgeService {
  private readonly enabled: boolean;
  private readonly remoteKnowledgeServiceUrl: string | null;

  constructor() {
    const configEnabled = isKnowledgeGraphEnabled();
    const kgConfig = getKnowledgeGraphConfig();

    const configuredServiceUrl = kgConfig?.serviceUrl?.trim();
    this.remoteKnowledgeServiceUrl =
      configuredServiceUrl || process.env.KNOWLEDGE_SERVICE_URL || null;

    if (!configEnabled) {
      logger.info(
        '[KNOWLEDGE] Knowledge graph is disabled in config. Set knowledgeGraph.enabled to true to enable.'
      );
      this.enabled = false;
    } else if (!this.remoteKnowledgeServiceUrl) {
      logger.warn(
        '[KNOWLEDGE] Knowledge graph enabled but no serviceUrl configured. ' +
          'Set knowledgeGraph.serviceUrl or KNOWLEDGE_SERVICE_URL env var.'
      );
      this.enabled = false;
    } else {
      logger.info(
        `[KNOWLEDGE] Remote knowledge-service configured: ${this.remoteKnowledgeServiceUrl}`
      );
      this.enabled = true;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getServiceUrl(): string | null {
    return this.remoteKnowledgeServiceUrl;
  }

  async init(): Promise<void> {
    if (!this.enabled) return;
    logger.info(
      `[KNOWLEDGE] Knowledge service initialized (remote: ${this.remoteKnowledgeServiceUrl})`
    );
  }

  async shutdown(): Promise<void> {
    // No local resources to clean up in remote-only mode
  }

  // --- Session Management ---

  async getOrCreateSession(agentFqName: string): Promise<KnowledgeSessionContext> {
    if (!this.enabled) {
      throw new Error('Knowledge service is disabled');
    }

    const agentId = agentFqName;

    try {
      const result = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSession {
          agentId? "${escapeString(agentId)}",
          
          agentId? "${escapeString(agentId)}"}}`,
        undefined
      );

      if (result && result.length > 0) {
        const session = result[0];
        return {
          sessionId: session.lookup('id'),
          agentId: session.lookup('agentId'),
        };
      }

      logger.info(`[KNOWLEDGE] Creating new session for agentId=${agentId}`);
      const sessionStatement = `{${CoreKnowledgeModuleName}/KnowledgeSession {
          agentId "${escapeString(agentId)}",
          
          agentId "${escapeString(agentId)}",
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
          
          agentId? "${escapeString(agentId)}"}}`,
        undefined
      );

      if (queryResult && queryResult.length > 0) {
        const session = queryResult[0];
        logger.info(`[KNOWLEDGE] Session found after creation: ${session.lookup('id')}`);
        return {
          sessionId: session.lookup('id'),
          agentId: session.lookup('agentId'),
        };
      }

      throw new Error('Failed to create knowledge session - session not found after creation');
    } catch (err) {
      logger.error(`[KNOWLEDGE] Failed to get or create session: ${err}`);
      throw err;
    }
  }

  // --- Document Processing (delegated to knowledge-service) ---

  private static readonly EMPTY_RESULT: ProcessingResult = {
    nodes: [],
    edges: [],
    nodesCreated: 0,
    nodesMerged: 0,
    edgesCreated: 0,
  };

  async processDocuments(
    _documents: any[],
    _containerTag: string,
    _agentId?: string,
    _env?: Environment,
    _llmName?: string
  ): Promise<ProcessingResult> {
    // All document processing is handled by knowledge-service.
    if (this.enabled) {
      logger.debug(
        '[KNOWLEDGE] Document processing is handled by remote knowledge-service. ' +
          'Upload documents via the knowledge-service upload API.'
      );
    }
    return KnowledgeService.EMPTY_RESULT;
  }

  // --- Context Retrieval (queries knowledge-service) ---

  async buildContext(
    query: string,
    containerTag: string,
    _agentId?: string
  ): Promise<KnowledgeContext> {
    const emptyContext: KnowledgeContext = {
      entities: [],
      relationships: [],
      instanceData: [],
      contextString: '',
    };

    if (!this.enabled || !this.remoteKnowledgeServiceUrl) {
      return emptyContext;
    }

    try {
      let response = await fetch(`${this.remoteKnowledgeServiceUrl}/api/knowledge/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          containerTags: [containerTag],
        }),
      });

      let data: any;
      if (response.ok) {
        data = await response.json();
      } else {
        // Fallback to Agentlang-native endpoint when /api adapter is unavailable.
        response = await fetch(
          `${this.remoteKnowledgeServiceUrl}/knowledge.core/ApiKnowledgeQuery`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              queryText: query,
              containerTagsJson: JSON.stringify([containerTag]),
              optionsJson: JSON.stringify({
                includeChunks: true,
                includeEntities: true,
                includeEdges: true,
              }),
            }),
          }
        );
        if (!response.ok) {
          throw new Error(`knowledge-service query failed (${response.status})`);
        }
        data = normalizeKnowledgeQueryPayload(await response.json());
        data = {
          chunks: JSON.parse(data?.chunks || '[]'),
          entities: JSON.parse(data?.entities || '[]'),
          edges: JSON.parse(data?.edges || '[]'),
          contextString: data?.contextString || '',
        };
      }

      const entities = Array.isArray(data.entities)
        ? data.entities.map((entity: any) => ({
            id: entity.id,
            name: entity.name,
            entityType: entity.entityType || 'UNKNOWN',
            description: entity.description,
            sourceType: 'DOCUMENT' as SourceType,
            sourceId: undefined,
            sourceChunk: undefined,
            instanceId: undefined,
            instanceType: undefined,
            agentId: containerTag,
            confidence: Number(entity.confidence ?? 1),
            createdAt: new Date(),
            updatedAt: new Date(),
            isLatest: true,
          }))
        : [];
      const relationships = Array.isArray(data.edges)
        ? data.edges.map((edge: any) => ({
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            relationship: edge.relType || edge.relationship || 'RELATED_TO',
            weight: Number(edge.weight ?? 1),
          }))
        : [];
      return {
        entities,
        relationships,
        instanceData: [],
        contextString: data.contextString || '',
      };
    } catch (err) {
      logger.error(`[KNOWLEDGE] Remote knowledge-service query failed: ${err}`);
      return emptyContext;
    }
  }

  buildContextString(context: KnowledgeContext): string {
    return context.contextString;
  }

  // --- Conversation Processing (delegated to knowledge-service) ---

  async processConversationTurn(
    _userMessage: string,
    _assistantResponse: string,
    session: KnowledgeSessionContext,
    _env?: Environment,
    _llmName?: string
  ): Promise<void> {
    if (!this.enabled) return;

    // Store conversation locally for session continuity
    await this.storeSessionMessage(session.sessionId, 'user', _userMessage);
    await this.storeSessionMessage(session.sessionId, 'assistant', _assistantResponse);

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

    // Entity extraction and graph updates are handled by knowledge-service
    // when documents are ingested through its pipeline.
  }

  // --- Agent Document Processing (delegated to knowledge-service) ---

  async maybeProcessAgentDocuments(
    _session: KnowledgeSessionContext,
    _documentTitles: string[],
    _env?: Environment,
    _llmName?: string
  ): Promise<void> {
    // All document ingestion is handled by knowledge-service.
    if (this.enabled) {
      logger.debug(
        '[KNOWLEDGE] Agent document processing is handled by remote knowledge-service.'
      );
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
      await this.cleanupOldSessionMessages(sessionId);
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Failed to store session message: ${err}`);
    }
  }

  private async cleanupOldSessionMessages(sessionId: string): Promise<void> {
    try {
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
