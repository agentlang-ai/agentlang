export interface VectorRecord {
  id: string;
  embedding: number[];
  tenantId?: string;
  agentId?: string;
  documentId?: string;
  metadata?: Record<string, any>;
}

export interface SearchResult {
  id: string;
  distance: number;
  tenantId?: string;
  agentId?: string;
  documentId?: string;
  metadata?: Record<string, any>;
}

export interface VectorStore {
  init(): Promise<void>;
  addEmbedding(record: VectorRecord): Promise<void>;
  addEmbeddings(records: VectorRecord[]): Promise<void>;
  search(
    embedding: number[],
    tenantId?: string,
    agentId?: string,
    limit?: number
  ): Promise<SearchResult[]>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface VectorStoreConfig {
  dbname?: string;
  moduleName: string;
  vectorDimension: number;
  inMemory?: boolean;
}
