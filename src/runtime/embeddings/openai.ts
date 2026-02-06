import { OpenAIEmbeddings } from '@langchain/openai';
import { EmbeddingProvider, EmbeddingProviderConfig } from './provider.js';
import { getLocalEnv } from '../auth/defs.js';

export interface OpenAIEmbeddingConfig extends EmbeddingProviderConfig {
  model?: string;
  dimensions?: number;
  maxRetries?: number;
}

export class OpenAIEmbeddingProvider extends EmbeddingProvider {
  private openaiConfig: OpenAIEmbeddingConfig;

  constructor(config?: EmbeddingProviderConfig) {
    super(config || {});
    this.openaiConfig = (this.config as OpenAIEmbeddingConfig) || {};
  }

  protected createEmbeddings(): OpenAIEmbeddings {
    const config: any = {
      apiKey: this.resolveApiKey(),
    };

    if (this.openaiConfig.model) {
      config.model = this.openaiConfig.model;
    }

    if (this.openaiConfig.dimensions) {
      config.dimensions = this.openaiConfig.dimensions;
    }

    if (this.openaiConfig.maxRetries !== undefined) {
      config.maxRetries = this.openaiConfig.maxRetries;
    }

    return new OpenAIEmbeddings(config);
  }

  protected resolveApiKey(): string {
    if (this.openaiConfig.apiKey) {
      return this.openaiConfig.apiKey;
    }
    return process.env.AGENTLANG_OPENAI_KEY || getLocalEnv('AGENTLANG_OPENAI_KEY') || '';
  }

  getProviderName(): string {
    return 'openai';
  }
}
