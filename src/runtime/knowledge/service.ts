import { logger } from '../logger.js';
import { CoreKnowledgeModuleName } from '../modules/knowledge.js';
import { Environment, parseAndEvaluateStatement } from '../interpreter.js';
import { escapeString } from './utils.js';
import type { Instance } from '../module.js';
import type { KnowledgeContext } from '../graph/types.js';
import { AppConfig, getKnowledgeGraphConfig } from '../state.js';
import { TextChunker } from '../embeddings/chunker.js';
import { OpenAIEmbeddingProvider } from '../embeddings/openai.js';
import { LanceDBVectorStore } from '../resolvers/vector/lancedb-store.js';
import type { VectorStore } from '../resolvers/vector/types.js';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';

// Maximum number of session messages to retain per session (prevents database bloat)
const MAX_KNOWLEDGE_SESSION_MESSAGES = parseInt(
  process.env.MAX_KNOWLEDGE_SESSION_MESSAGES || '100',
  10
);

const VECTOR_DIMENSION = 1536;

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
 * Determine whether pgvector should be used for local vector storage.
 * pgvector when store is postgres OR vectorStore is explicitly pgvector.
 * LanceDB (file-persisted) otherwise.
 */
function usePgvector(): boolean {
  if (AppConfig?.vectorStore?.type === 'pgvector') return true;
  if (AppConfig?.vectorStore?.type === 'lancedb') return false;
  return AppConfig?.store?.type === 'postgres';
}

interface LocalChunk {
  id: string;
  content: string;
  documentTitle: string;
  chunkIndex: number;
}

/**
 * KnowledgeService — dual-mode: remote client OR local embedding+retrieval.
 *
 * When `knowledgeGraph.serviceUrl` is configured, delegates to the remote
 * knowledge-service (deployed) or agentlang-cli's LocalKnowledgeService.
 *
 * When no serviceUrl is configured (default), performs local document
 * embedding and retrieval using:
 *   - pgvector (when store is postgres) via agentlang.rawQuery()
 *   - LanceDB (persisted to file) for sqlite or other stores
 * No graph — just vector similarity search on document chunks.
 */
export class KnowledgeService {
  private readonly mode: 'remote' | 'local';
  private readonly remoteKnowledgeServiceUrl: string | null;

  // Local mode resources
  private vectorStore: VectorStore | null = null;
  private embeddingProvider: OpenAIEmbeddingProvider | null = null;
  private chunker: TextChunker | null = null;
  private localChunks: Map<string, LocalChunk> = new Map();
  private processedDocuments: Set<string> = new Set();
  private localInitialized = false;

  constructor() {
    const kgConfig = getKnowledgeGraphConfig();

    const configuredServiceUrl = kgConfig?.serviceUrl?.trim();
    this.remoteKnowledgeServiceUrl =
      configuredServiceUrl || process.env.KNOWLEDGE_SERVICE_URL || null;

    if (this.remoteKnowledgeServiceUrl) {
      this.mode = 'remote';
      logger.info(
        `[KNOWLEDGE] Remote mode: ${this.remoteKnowledgeServiceUrl}. ` +
          'All processing delegated to remote service.'
      );
    } else {
      this.mode = 'local';
      const storeType = usePgvector() ? 'pgvector' : 'lancedb (file-persisted)';
      logger.info(
        `[KNOWLEDGE] Local mode: document embedding + retrieval using ${storeType}. ` +
          'No graph — vector similarity search only.'
      );
    }
  }

  isEnabled(): boolean {
    return true; // Always enabled — either remote or local mode
  }

  isRemote(): boolean {
    return this.mode === 'remote';
  }

  // ─── Local mode initialization (lazy) ─────────────────────────────

  private async ensureLocalInit(): Promise<void> {
    if (this.localInitialized) return;

    this.chunker = new TextChunker(1000, 200);
    this.embeddingProvider = new OpenAIEmbeddingProvider({
      model: 'text-embedding-3-small',
    });

    if (!usePgvector()) {
      const dbPath =
        AppConfig?.vectorStore?.type === 'lancedb'
          ? (AppConfig.vectorStore as any).dbname || './data/knowledge-vectors.lance'
          : './data/knowledge-vectors.lance';

      this.vectorStore = new LanceDBVectorStore({
        moduleName: 'knowledge',
        vectorDimension: VECTOR_DIMENSION,
        dbname: dbPath,
      });
      await this.vectorStore.init();
      logger.info(`[KNOWLEDGE] LanceDB vector store initialized at ${dbPath}`);
    } else {
      try {
        const ag = (globalThis as any).agentlang;
        if (ag?.rawQuery) {
          await ag.rawQuery(`
            CREATE TABLE IF NOT EXISTS knowledge_local_chunks (
              id TEXT PRIMARY KEY,
              content TEXT NOT NULL,
              document_title TEXT NOT NULL,
              chunk_index INTEGER NOT NULL,
              embedding vector(${VECTOR_DIMENSION})
            )
          `);
          try {
            await ag.rawQuery(`
              CREATE INDEX IF NOT EXISTS idx_knowledge_local_chunks_embedding
              ON knowledge_local_chunks USING hnsw (embedding vector_cosine_ops)
            `);
          } catch {
            // Index may already exist or pgvector extension not loaded
          }
          logger.info('[KNOWLEDGE] pgvector local chunks table initialized');
        }
      } catch (err) {
        logger.warn(`[KNOWLEDGE] Failed to initialize pgvector table: ${err}`);
      }
    }

    this.localInitialized = true;
  }

  // ─── Local document processing ────────────────────────────────────

  /**
   * Process a document: read content, chunk, embed, and store vectors.
   * Skips if already processed in this session.
   */
  async processLocalDocument(title: string, url: string): Promise<void> {
    if (this.processedDocuments.has(title)) return;

    await this.ensureLocalInit();

    try {
      let content: string;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const resp = await fetch(url);
        if (!resp.ok) {
          logger.warn(
            `[KNOWLEDGE] Failed to fetch document "${title}" from ${url}: ${resp.status}`
          );
          return;
        }
        content = await resp.text();
      } else {
        const filePath = pathResolve(url);
        try {
          content = readFileSync(filePath, 'utf-8');
        } catch (err) {
          logger.warn(`[KNOWLEDGE] Failed to read document "${title}" from ${filePath}: ${err}`);
          return;
        }
      }

      if (!content || content.trim().length === 0) {
        logger.debug(`[KNOWLEDGE] Document "${title}" is empty, skipping`);
        this.processedDocuments.add(title);
        return;
      }

      const chunks = this.chunker!.splitText(content);
      logger.debug(`[KNOWLEDGE] Document "${title}": ${chunks.length} chunks`);

      if (chunks.length === 0) {
        this.processedDocuments.add(title);
        return;
      }

      const embeddings = await this.embeddingProvider!.embedTexts(chunks);

      if (usePgvector()) {
        await this.storePgvectorChunks(title, chunks, embeddings);
      } else {
        await this.storeLanceDBChunks(title, chunks, embeddings);
      }

      this.processedDocuments.add(title);
      logger.info(
        `[KNOWLEDGE] Processed document "${title}": ${chunks.length} chunks embedded and stored`
      );
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Error processing document "${title}": ${err}`);
    }
  }

  private async storePgvectorChunks(
    title: string,
    chunks: string[],
    embeddings: number[][]
  ): Promise<void> {
    const ag = (globalThis as any).agentlang;
    if (!ag?.rawQuery) return;

    for (let i = 0; i < chunks.length; i++) {
      const id = crypto.randomUUID();
      const embeddingStr = `[${embeddings[i].join(',')}]`;
      await ag.rawQuery(
        `INSERT INTO knowledge_local_chunks (id, content, document_title, chunk_index, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (id) DO NOTHING`,
        [id, chunks[i], title, i, embeddingStr]
      );
      this.localChunks.set(id, {
        id,
        content: chunks[i],
        documentTitle: title,
        chunkIndex: i,
      });
    }
  }

  private async storeLanceDBChunks(
    title: string,
    chunks: string[],
    embeddings: number[][]
  ): Promise<void> {
    if (!this.vectorStore) return;

    for (let i = 0; i < chunks.length; i++) {
      const id = crypto.randomUUID();
      await this.vectorStore.addEmbedding({
        id,
        embedding: embeddings[i],
        documentId: title,
      });
      this.localChunks.set(id, {
        id,
        content: chunks[i],
        documentTitle: title,
        chunkIndex: i,
      });
    }
  }

  // ─── Local retrieval ──────────────────────────────────────────────

  async queryLocal(
    query: string,
    documentTitles?: string[],
    limit: number = 10
  ): Promise<KnowledgeContext | null> {
    await this.ensureLocalInit();

    try {
      const queryEmbedding = await this.embeddingProvider!.embedText(query);

      let results: Array<{
        id: string;
        content: string;
        similarity: number;
        documentTitle: string;
      }> = [];

      if (usePgvector()) {
        results = await this.queryPgvector(queryEmbedding, documentTitles, limit);
      } else {
        results = await this.queryLanceDB(queryEmbedding, documentTitles, limit);
      }

      if (results.length === 0) return null;

      const contextString = results.map(r => r.content).join('\n\n---\n\n');

      return {
        entities: [],
        relationships: [],
        instanceData: results.map(r => ({
          instanceId: r.id,
          entityType: 'KnowledgeChunk',
          data: { id: r.id, content: r.content, similarity: r.similarity },
        })),
        contextString,
      };
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Local query error: ${err}`);
      return null;
    }
  }

  private async queryPgvector(
    queryEmbedding: number[],
    documentTitles?: string[],
    limit: number = 10
  ): Promise<Array<{ id: string; content: string; similarity: number; documentTitle: string }>> {
    const ag = (globalThis as any).agentlang;
    if (!ag?.rawQuery) return [];

    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    let sql: string;
    let params: any[];

    if (documentTitles && documentTitles.length > 0) {
      sql = `
        SELECT id, content, document_title,
               1 - (embedding <=> $1::vector) as similarity
        FROM knowledge_local_chunks
        WHERE document_title = ANY($2)
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `;
      params = [embeddingStr, documentTitles, limit];
    } else {
      sql = `
        SELECT id, content, document_title,
               1 - (embedding <=> $1::vector) as similarity
        FROM knowledge_local_chunks
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `;
      params = [embeddingStr, limit];
    }

    const rows = await ag.rawQuery(sql, params);
    return (rows || []).map((r: any) => ({
      id: r.id,
      content: r.content,
      similarity: parseFloat(r.similarity) || 0,
      documentTitle: r.document_title,
    }));
  }

  private async queryLanceDB(
    queryEmbedding: number[],
    documentTitles?: string[],
    limit: number = 10
  ): Promise<Array<{ id: string; content: string; similarity: number; documentTitle: string }>> {
    if (!this.vectorStore) return [];

    const searchResults = await this.vectorStore.search(
      queryEmbedding,
      undefined,
      undefined,
      limit
    );

    const results: Array<{
      id: string;
      content: string;
      similarity: number;
      documentTitle: string;
    }> = [];

    for (const sr of searchResults) {
      const chunk = this.localChunks.get(sr.id);
      if (!chunk) continue;

      if (documentTitles && documentTitles.length > 0) {
        if (!documentTitles.includes(chunk.documentTitle)) continue;
      }

      results.push({
        id: sr.id,
        content: chunk.content,
        similarity: 1 - (sr.distance || 0),
        documentTitle: chunk.documentTitle,
      });
    }

    return results.slice(0, limit);
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

  // ─── Knowledge query (remote or local) ─────────────────────────────

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
    if (this.mode === 'local') {
      return this.queryLocal(query, options?.documentTitles, options?.chunkLimit || 10);
    }

    if (!this.remoteKnowledgeServiceUrl) {
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

  // ─── Document processing ──────────────────────────────────────────

  async processDocuments(
    _agentId: string,
    _documents: string,
    _env: Environment
  ): Promise<{ processed: number; errors: string[] }> {
    // Remote: handled by knowledge-service's uploadDocumentVersion workflow.
    // Local: documents are processed lazily via processLocalDocument in ai.ts.
    return { processed: 0, errors: [] };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.vectorStore) {
      await this.vectorStore.close();
      this.vectorStore = null;
    }
    this.localChunks.clear();
    this.processedDocuments.clear();
    this.localInitialized = false;
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
