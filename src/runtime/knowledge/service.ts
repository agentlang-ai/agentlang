import { logger } from '../logger.js';
import { CoreKnowledgeModuleName } from '../modules/knowledge.js';
import { parseAndEvaluateStatement, Environment } from '../interpreter.js';
import { escapeString } from './utils.js';
import type { Instance } from '../module.js';
import type { KnowledgeContext } from '../graph/types.js';
import { getKnowledgeGraphConfig } from '../state.js';
import crypto from 'crypto';

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
 * KnowledgeService — thin remote client.
 *
 * All embedding, chunking, graph storage, and retrieval is handled by the
 * remote knowledge-service (deployed) or agentlang-cli's LocalKnowledgeService
 * (local dev). This class only manages session context and delegates queries.
 */
export class KnowledgeService {
  private readonly enabled: boolean;
  private readonly remoteKnowledgeServiceUrl: string | null;

  constructor() {
    const kgConfig = getKnowledgeGraphConfig();

    const configuredServiceUrl = kgConfig?.serviceUrl?.trim();
    this.remoteKnowledgeServiceUrl =
      configuredServiceUrl || process.env.KNOWLEDGE_SERVICE_URL || null;

    if (!this.remoteKnowledgeServiceUrl) {
      logger.debug(
        '[KNOWLEDGE] No knowledgeGraph.serviceUrl configured. ' +
          'Set knowledgeGraph.serviceUrl or KNOWLEDGE_SERVICE_URL to enable.'
      );
      this.enabled = false;
    } else {
      this.enabled = true;
      logger.info(
        `[KNOWLEDGE] Remote knowledge-service mode: ${this.remoteKnowledgeServiceUrl}. ` +
          'All processing delegated to remote service.'
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ─── Session management ────────────────────────────────────────────

  async createSession(
    sessionId: string,
    agentId: string,
    env: Environment
  ): Promise<KnowledgeSessionContext> {
    const ctx: KnowledgeSessionContext = { sessionId, agentId };

    try {
      const existingResult: any[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSession? {sessionId "${escapeString(sessionId)}" agentId "${escapeString(agentId)}"}}`,
        undefined,
        env
      );

      if (!existingResult || existingResult.length === 0) {
        await parseAndEvaluateStatement(
          `{${CoreKnowledgeModuleName}/KnowledgeSession {sessionId "${escapeString(sessionId)}" agentId "${escapeString(agentId)}"}}`,
          undefined,
          env
        );
      }
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Error creating session: ${err}`);
    }

    return ctx;
  }

  async addSessionMessage(
    ctx: KnowledgeSessionContext,
    role: string,
    content: string,
    env: Environment
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const countResult: any[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSessionMessage? {sessionId "${escapeString(ctx.sessionId)}"}}`,
        undefined,
        env
      );

      if (countResult && countResult.length >= MAX_KNOWLEDGE_SESSION_MESSAGES) {
        const oldest = countResult[0];
        const oldestId =
          oldest instanceof Object && 'lookup' in oldest
            ? (oldest as Instance).lookup('id')
            : (oldest as any).id;
        if (oldestId) {
          await parseAndEvaluateStatement(
            `{:delete ${CoreKnowledgeModuleName}/KnowledgeSessionMessage "${oldestId}"}`,
            undefined,
            env
          );
        }
      }

      const messageId = crypto.randomUUID();
      await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSessionMessage {id "${messageId}" sessionId "${escapeString(ctx.sessionId)}" role "${escapeString(role)}" content "${escapeString(content)}"}}`,
        undefined,
        env
      );
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Error adding session message: ${err}`);
    }
  }

  async getSessionMessages(
    ctx: KnowledgeSessionContext,
    env: Environment
  ): Promise<Array<{ role: string; content: string }>> {
    if (!this.enabled) return [];

    try {
      const result: any[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeSessionMessage? {sessionId "${escapeString(ctx.sessionId)}"}}`,
        undefined,
        env
      );

      if (result && result.length > 0) {
        return result.map((msg: any) => {
          if (msg instanceof Object && 'lookup' in msg) {
            const inst = msg as Instance;
            return {
              role: inst.lookup('role') as string,
              content: inst.lookup('content') as string,
            };
          }
          return { role: msg.role, content: msg.content };
        });
      }
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Error getting session messages: ${err}`);
    }

    return [];
  }

  // ─── Knowledge query (remote) ──────────────────────────────────────

  async queryKnowledge(
    query: string,
    containerTags: string[],
    options?: {
      chunkLimit?: number;
      entityLimit?: number;
      includeChunks?: boolean;
      includeEntities?: boolean;
      includeEdges?: boolean;
      documentTitles?: string[];
      documentRefs?: string[];
    }
  ): Promise<KnowledgeContext | null> {
    if (!this.enabled || !this.remoteKnowledgeServiceUrl) {
      return null;
    }

    try {
      let response = await fetch(`${this.remoteKnowledgeServiceUrl}/api/knowledge/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          containerTags,
          ...options,
        }),
      });

      if (!response.ok) {
        // Fallback to Agentlang-native endpoint when /api adapter is unavailable.
        response = await fetch(
          `${this.remoteKnowledgeServiceUrl}/knowledge.core/ApiKnowledgeQuery`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              queryText: query,
              containerTagsJson: JSON.stringify(containerTags),
              documentTitlesJson: JSON.stringify(options?.documentTitles || []),
              documentRefsJson: JSON.stringify(options?.documentRefs || []),
              optionsJson: JSON.stringify({
                includeChunks: options?.includeChunks ?? true,
                includeEntities: options?.includeEntities ?? true,
                includeEdges: options?.includeEdges ?? true,
                chunkLimit: options?.chunkLimit,
                entityLimit: options?.entityLimit,
              }),
            }),
          }
        );
      }

      if (response.ok) {
        const rawPayload: any = await response.json();
        const payload = normalizeKnowledgeQueryPayload(rawPayload);
        return {
          entities: (payload?.entities || []).map((e: any) => ({
            id: e.id || '',
            name: e.name || '',
            type: e.entityType || e.type || '',
            properties: e,
          })),
          relationships: (payload?.edges || []).map((e: any) => ({
            source: e.sourceId || '',
            target: e.targetId || '',
            type: e.relationType || e.type || '',
            weight: e.weight || 1,
          })),
          instanceData: (payload?.chunks || []).map((c: any) => ({
            instanceId: c.id || '',
            entityType: 'KnowledgeChunk',
            data: c,
          })),
          contextString: payload?.contextString || '',
        };
      }

      logger.debug(
        `[KNOWLEDGE] Remote query failed with status ${response.status}: ${response.statusText}`
      );
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Remote knowledge-service query error: ${err}`);
    }

    return null;
  }

  // ─── Document processing (no-op — delegated to remote service) ─────

  async processDocuments(
    _agentId: string,
    _documents: string,
    _env: Environment
  ): Promise<{ processed: number; errors: string[] }> {
    // Document ingestion is handled by knowledge-service's uploadDocumentVersion workflow.
    return { processed: 0, errors: [] };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  async close(): Promise<void> {
    logger.info('[KNOWLEDGE] KnowledgeService closed.');
  }
}

// ─── Singleton access ──────────────────────────────────────────────

export function getKnowledgeService(): KnowledgeService {
  if (!knowledgeServiceInstance) {
    knowledgeServiceInstance = new KnowledgeService();
  }
  return knowledgeServiceInstance;
}

export function resetKnowledgeService(): void {
  if (knowledgeServiceInstance) {
    knowledgeServiceInstance.close().catch(() => {});
    knowledgeServiceInstance = null;
  }
}
