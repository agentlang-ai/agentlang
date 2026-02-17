import { Embeddings } from '@langchain/core/embeddings';
import { logger } from '../logger.js';

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
    logger.info(`[EMBEDDING-PROVIDER] embedText called (${text.length} chars)`);
    const startTime = Date.now();
    const result = await this.embeddings.embedQuery(text);
    const duration = Date.now() - startTime;
    logger.info(
      `[EMBEDDING-PROVIDER] embedText completed in ${duration}ms (${result.length} dimensions)`
    );
    return result;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await this.embedText(texts[0])];
    logger.info(`[EMBEDDING-PROVIDER] embedTexts called (${texts.length} texts)`);
    const startTime = Date.now();
    const results = await this.embeddings.embedDocuments(texts);
    const duration = Date.now() - startTime;
    logger.info(
      `[EMBEDDING-PROVIDER] embedTexts completed in ${duration}ms (${texts.length} texts, ${results[0]?.length || 0} dimensions)`
    );
    return results;
  }

  getConfig(): EmbeddingProviderConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<EmbeddingProviderConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.embeddings = this.createEmbeddings();
  }
}
