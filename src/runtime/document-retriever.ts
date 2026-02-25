import { logger } from './logger.js';
import { AppConfig } from './state.js';
import { TextChunker } from './embeddings/chunker.js';
import { OpenAIEmbeddingProvider } from './embeddings/openai.js';
import { LanceDBVectorStore } from './resolvers/vector/lancedb-store.js';
import type { VectorStore } from './resolvers/vector/types.js';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve as pathResolve } from 'path';

const VECTOR_DIMENSION = 1536;

interface LocalChunk {
  id: string;
  content: string;
  documentTitle: string;
  chunkIndex: number;
}

function usePgvector(): boolean {
  if (AppConfig?.vectorStore?.type === 'pgvector') return true;
  if (AppConfig?.vectorStore?.type === 'lancedb') return false;
  return AppConfig?.store?.type === 'postgres';
}

/**
 * Local document retriever — embeds documents into pgvector or LanceDB
 * and retrieves relevant chunks via vector similarity search.
 */
class DocumentRetriever {
  private vectorStore: VectorStore | null = null;
  private embeddingProvider: OpenAIEmbeddingProvider | null = null;
  private chunker: TextChunker | null = null;
  private localChunks: Map<string, LocalChunk> = new Map();
  private processedDocuments: Set<string> = new Set();
  private initialized = false;

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;

    this.chunker = new TextChunker(1000, 200);
    this.embeddingProvider = new OpenAIEmbeddingProvider({
      model: 'text-embedding-3-small',
    });

    if (!usePgvector()) {
      const dbPath =
        AppConfig?.vectorStore?.type === 'lancedb'
          ? (AppConfig.vectorStore as any).dbname || './data/document-vectors.lance'
          : './data/document-vectors.lance';

      this.vectorStore = new LanceDBVectorStore({
        moduleName: 'documents',
        vectorDimension: VECTOR_DIMENSION,
        dbname: dbPath,
      });
      await this.vectorStore.init();
      logger.info(`[DOCUMENT-RETRIEVER] LanceDB vector store initialized at ${dbPath}`);
    } else {
      try {
        const ag = (globalThis as any).agentlang;
        if (ag?.rawQuery) {
          await ag.rawQuery(`
            CREATE TABLE IF NOT EXISTS document_local_chunks (
              id TEXT PRIMARY KEY,
              content TEXT NOT NULL,
              document_title TEXT NOT NULL,
              chunk_index INTEGER NOT NULL,
              embedding vector(${VECTOR_DIMENSION})
            )
          `);
          try {
            await ag.rawQuery(`
              CREATE INDEX IF NOT EXISTS idx_document_local_chunks_embedding
              ON document_local_chunks USING hnsw (embedding vector_cosine_ops)
            `);
          } catch {
            // Index may already exist or pgvector extension not loaded
          }
          logger.info('[DOCUMENT-RETRIEVER] pgvector local chunks table initialized');
        }
      } catch (err) {
        logger.warn(`[DOCUMENT-RETRIEVER] Failed to initialize pgvector table: ${err}`);
      }
    }

    this.initialized = true;
  }

  async processDocument(title: string, url: string): Promise<void> {
    if (this.processedDocuments.has(title)) return;

    await this.ensureInit();

    try {
      let content: string;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const resp = await fetch(url);
        if (!resp.ok) {
          logger.warn(
            `[DOCUMENT-RETRIEVER] Failed to fetch "${title}" from ${url}: ${resp.status}`
          );
          return;
        }
        content = await resp.text();
      } else {
        const filePath = pathResolve(url);
        try {
          content = readFileSync(filePath, 'utf-8');
        } catch (err) {
          logger.warn(`[DOCUMENT-RETRIEVER] Failed to read "${title}" from ${filePath}: ${err}`);
          return;
        }
      }

      if (!content || content.trim().length === 0) {
        logger.debug(`[DOCUMENT-RETRIEVER] Document "${title}" is empty, skipping`);
        this.processedDocuments.add(title);
        return;
      }

      const chunks = this.chunker!.splitText(content);
      logger.debug(`[DOCUMENT-RETRIEVER] Document "${title}": ${chunks.length} chunks`);

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
        `[DOCUMENT-RETRIEVER] Processed "${title}": ${chunks.length} chunks embedded and stored`
      );
    } catch (err) {
      logger.warn(`[DOCUMENT-RETRIEVER] Error processing "${title}": ${err}`);
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
        `INSERT INTO document_local_chunks (id, content, document_title, chunk_index, embedding)
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

  async query(queryText: string, documentTitles?: string[], limit: number = 10): Promise<string> {
    await this.ensureInit();

    try {
      const results = usePgvector()
        ? await this.queryPgvector(queryText, documentTitles, limit)
        : await this.queryLanceDB(queryText, documentTitles, limit);

      if (results.length === 0) return '';

      return results.map(r => r.content).join('\n\n---\n\n');
    } catch (err) {
      logger.debug(`[DOCUMENT-RETRIEVER] Query failed: ${err}`);
      return '';
    }
  }

  private async queryPgvector(
    queryText: string,
    documentTitles?: string[],
    limit: number = 10
  ): Promise<Array<{ id: string; content: string; similarity: number }>> {
    const ag = (globalThis as any).agentlang;
    if (!ag?.rawQuery) return [];

    const queryEmbedding = await this.embeddingProvider!.embedText(queryText);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    let sql: string;
    let params: any[];

    if (documentTitles && documentTitles.length > 0) {
      const placeholders = documentTitles.map((_, i) => `$${i + 2}`).join(', ');
      sql = `SELECT id, content, document_title, 1 - (embedding <=> $1::vector) AS similarity
             FROM document_local_chunks
             WHERE document_title IN (${placeholders})
             ORDER BY embedding <=> $1::vector
             LIMIT ${limit}`;
      params = [embeddingStr, ...documentTitles];
    } else {
      sql = `SELECT id, content, document_title, 1 - (embedding <=> $1::vector) AS similarity
             FROM document_local_chunks
             ORDER BY embedding <=> $1::vector
             LIMIT ${limit}`;
      params = [embeddingStr];
    }

    const rows: any[] = await ag.rawQuery(sql, params);
    return (rows || []).map((r: any) => ({
      id: r.id,
      content: r.content,
      similarity: parseFloat(r.similarity) || 0,
    }));
  }

  private async queryLanceDB(
    queryText: string,
    documentTitles?: string[],
    limit: number = 10
  ): Promise<Array<{ id: string; content: string; similarity: number }>> {
    if (!this.vectorStore) return [];

    const queryEmbedding = await this.embeddingProvider!.embedText(queryText);
    const searchResults = await this.vectorStore.search(
      queryEmbedding,
      undefined,
      undefined,
      limit
    );

    const results: Array<{ id: string; content: string; similarity: number }> = [];

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
      });
    }

    return results.slice(0, limit);
  }

  async close(): Promise<void> {
    if (this.vectorStore) {
      await this.vectorStore.close();
      this.vectorStore = null;
    }
    this.localChunks.clear();
    this.processedDocuments.clear();
    this.initialized = false;
  }
}

let retrieverInstance: DocumentRetriever | null = null;

export function getDocumentRetriever(): DocumentRetriever {
  if (!retrieverInstance) {
    retrieverInstance = new DocumentRetriever();
  }
  return retrieverInstance;
}

export function resetDocumentRetriever(): void {
  if (retrieverInstance) {
    retrieverInstance.close().catch(() => {});
    retrieverInstance = null;
  }
}
