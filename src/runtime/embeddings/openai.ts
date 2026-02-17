import { OpenAIEmbeddings } from '@langchain/openai';
import { EmbeddingProvider, EmbeddingProviderConfig } from './provider.js';
import { getLocalEnv } from '../auth/defs.js';
import { logger } from '../logger.js';

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
    logger.debug(
      `[OPENAI-EMBEDDING] Provider created with model: ${this.openaiConfig.model || 'default'}`
    );
  }

  protected createEmbeddings(): OpenAIEmbeddings {
    const config: any = {
      apiKey: this.resolveApiKey(),
    };

    // Use this.config directly since this.openaiConfig is not initialized yet
    // during parent constructor (super() calls createEmbeddings before child init)
    const openaiConfig = (this.config as OpenAIEmbeddingConfig) || {};

    if (openaiConfig.model) {
      config.model = openaiConfig.model;
    }

    if (openaiConfig.dimensions) {
      config.dimensions = openaiConfig.dimensions;
    }

    if (openaiConfig.maxRetries !== undefined) {
      config.maxRetries = openaiConfig.maxRetries;
    }

    return new OpenAIEmbeddings(config);
  }

  protected resolveApiKey(): string {
    // Use this.config directly since this.openaiConfig may not be initialized yet
    // during constructor (createEmbeddings is called during super())
    const config = this.openaiConfig || (this.config as OpenAIEmbeddingConfig) || {};
    if (config.apiKey) {
      const keyPreview =
        config.apiKey.substring(0, 10) + '...' + config.apiKey.substring(config.apiKey.length - 4);
      logger.debug(`[OPENAI-EMBEDDING] API key found in config: ${keyPreview}`);
      return config.apiKey;
    }
    const envKey = process.env.AGENTLANG_OPENAI_KEY || getLocalEnv('AGENTLANG_OPENAI_KEY');
    if (envKey) {
      const keyPreview = envKey.substring(0, 10) + '...' + envKey.substring(envKey.length - 4);
      logger.debug(`[OPENAI-EMBEDDING] API key found in environment: ${keyPreview}`);
      return envKey;
    }
    logger.warn(
      `[OPENAI-EMBEDDING] No API key found! Set AGENTLANG_OPENAI_KEY environment variable.`
    );
    return '';
  }

  getProviderName(): string {
    return 'openai';
  }
}
