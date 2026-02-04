import { Embeddings } from '@langchain/core/embeddings';

export interface EmbeddingProviderConfig {
  chunkSize?: number;
  chunkOverlap?: number;
  apiKey?: string;
  model?: string;
  [key: string]: any;
}

export abstract class EmbeddingProvider {
  protected config: EmbeddingProviderConfig;
  protected embeddings: Embeddings;

  constructor(config: EmbeddingProviderConfig = {}) {
    this.config = config;
    this.embeddings = this.createEmbeddings();
  }

  protected abstract createEmbeddings(): Embeddings;
  protected abstract resolveApiKey(): string;

  abstract getProviderName(): string;

  async embedText(text: string): Promise<number[]> {
    return await this.embeddings.embedQuery(text);
  }

  getConfig(): EmbeddingProviderConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<EmbeddingProviderConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.embeddings = this.createEmbeddings();
  }
}
