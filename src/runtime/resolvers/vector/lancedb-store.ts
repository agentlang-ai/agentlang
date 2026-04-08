import * as lancedb from '@lancedb/lancedb';
import { Schema, Field, Float32, Utf8, FixedSizeList } from 'apache-arrow';
import { logger } from '../../logger.js';
import { VectorStore, VectorRecord, SearchResult, VectorStoreConfig } from './types.js';

export class LanceDBVectorStore implements VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private config: VectorStoreConfig;

  constructor(config: VectorStoreConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    try {
      const dbPath = this.config.inMemory
        ? 'memory://'
        : this.config.dbname || `./data/vector-store/${this.config.moduleName}.lance`;

      this.db = await lancedb.connect(dbPath);

      const tableName = 'embeddings';
      const tableNames = await this.db.tableNames();

      if (tableNames.includes(tableName)) {
        this.table = await this.db.openTable(tableName);
        logger.info(`LanceDB table ${tableName} opened`);
      } else {
        const schema = new Schema([
          new Field('id', new Utf8(), false),
          new Field(
            'embedding',
            new FixedSizeList(this.config.vectorDimension, new Field('item', new Float32())),
            false
          ),
          new Field('tenantId', new Utf8(), true),
          new Field('agentId', new Utf8(), true),
          new Field('documentId', new Utf8(), true),
        ]);

        this.table = await this.db.createEmptyTable(tableName, schema);
        logger.info(`LanceDB table ${tableName} created`);
      }
    } catch (error) {
      logger.error('Failed to initialize LanceDB vector store:', error);
      throw error;
    }
  }

  async addEmbedding(record: VectorRecord): Promise<void> {
    if (!this.table) {
      throw new Error('Vector store not initialized. Call init() first.');
    }

    try {
      await this.table.add([
        {
          id: record.id,
          embedding: record.embedding,
          tenantId: record.tenantId || null,
          agentId: record.agentId || null,
          documentId: record.documentId || null,
        },
      ]);
    } catch (error) {
      logger.error(`Failed to add embedding ${record.id}:`, error);
      throw error;
    }
  }

  async addEmbeddings(records: VectorRecord[]): Promise<void> {
    if (!this.table) {
      throw new Error('Vector store not initialized. Call init() first.');
    }

    try {
      const data = records.map(record => ({
        id: record.id,
        embedding: record.embedding,
        tenantId: record.tenantId || null,
        agentId: record.agentId || null,
        documentId: record.documentId || null,
      }));

      await this.table.add(data);
    } catch (error) {
      logger.error(`Failed to add ${records.length} embeddings:`, error);
      throw error;
    }
  }

  async search(
    embedding: number[],
    tenantId?: string,
    agentId?: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    if (!this.table) {
      throw new Error('Vector store not initialized. Call init() first.');
    }

    try {
      let query = this.table.vectorSearch(embedding).limit(limit);

      // Build filter conditions for agent-level isolation
      const filters: string[] = [];

      if (tenantId) {
        // Use parameterized filtering to prevent SQL injection
        const escapedTenantId = tenantId.replace(/'/g, "''");
        filters.push(`tenantId = '${escapedTenantId}'`);
      }

      if (agentId) {
        // Add agent-level filtering for strict agent isolation
        const escapedAgentId = agentId.replace(/'/g, "''");
        filters.push(`agentId = '${escapedAgentId}'`);
      }

      if (filters.length > 0) {
        query = query.where(filters.join(' AND '));
      }

      const results = await query.toArray();

      return results.map((row: any) => ({
        id: row.id,
        distance: row._distance || 0,
        tenantId: row.tenantId,
        agentId: row.agentId,
        documentId: row.documentId,
      }));
    } catch (error) {
      logger.error('Failed to search embeddings:', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    if (!this.table) {
      throw new Error('Vector store not initialized. Call init() first.');
    }

    try {
      await this.table.delete(`id = '${id}'`);
    } catch (error) {
      logger.error(`Failed to delete embedding ${id}:`, error);
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    if (!this.table) {
      throw new Error('Vector store not initialized. Call init() first.');
    }

    try {
      const results = await this.table.query().where(`id = '${id}'`).limit(1).toArray();
      return results.length > 0;
    } catch (error) {
      logger.error(`Failed to check existence of ${id}:`, error);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.table) {
        // LanceDB tables don't have explicit close method
        this.table = null;
      }
      if (this.db) {
        // Note: LanceDB connection doesn't have explicit close method
        this.db = null;
      }
      logger.info('LanceDB vector store closed');
    } catch (error) {
      logger.error('Failed to close LanceDB vector store:', error);
      throw error;
    }
  }
}

export function createLanceDBStore(config: VectorStoreConfig): VectorStore {
  return new LanceDBVectorStore(config);
}
