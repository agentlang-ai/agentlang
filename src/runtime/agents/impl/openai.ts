import { ChatOpenAI } from '@langchain/openai';
import { AgentServiceProvider, AIResponse, asAIResponse } from '../provider.js';
import { BaseMessage } from '@langchain/core/messages';
import { getLocalEnv } from '../../auth/defs.js';

export interface OpenAIConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxRetries?: number;
  apiKey?: string;
  configuration?: {
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
    [key: string]: any;
  };
  streamUsage?: boolean;
  logprobs?: boolean;
  topLogprobs?: number;
}

export class OpenAIProvider implements AgentServiceProvider {
  private model: ChatOpenAI;
  private config: OpenAIConfig;

  constructor(config?: Map<string, any>) {
    this.config = this.parseConfig(config);

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      topP: this.config.topP,
      frequencyPenalty: this.config.frequencyPenalty,
      presencePenalty: this.config.presencePenalty,
      maxRetries: this.config.maxRetries,
      streamUsage: this.config.streamUsage,
      logprobs: this.config.logprobs,
      topLogprobs: this.config.topLogprobs,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.configuration) {
      chatConfig.configuration = this.config.configuration;
    }

    this.model = new ChatOpenAI(chatConfig);
  }

  private parseConfig(config?: Map<string, any>): OpenAIConfig {
    const defaultConfig: OpenAIConfig = {
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 4096,
      topP: 1.0,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxRetries: 2,
      streamUsage: true,
      logprobs: false,
    };

    if (!config) {
      return {
        ...defaultConfig,
        apiKey: process.env.AGENTLANG_OPENAI_KEY || getLocalEnv('AGENTLANG_OPENAI_KEY'),
      };
    }

    const apiKey =
      config.get('apiKey') ||
      config.get('api_key') ||
      process.env.AGENTLANG_OPENAI_KEY ||
      getLocalEnv('AGENTLANG_OPENAI_KEY');

    return {
      model: config.get('model') || defaultConfig.model,
      temperature: config.get('temperature') ?? defaultConfig.temperature,
      maxTokens: config.get('maxTokens') || config.get('max_tokens') || defaultConfig.maxTokens,
      topP: config.get('topP') || config.get('top_p') || defaultConfig.topP,
      frequencyPenalty:
        config.get('frequencyPenalty') ||
        config.get('frequency_penalty') ||
        defaultConfig.frequencyPenalty,
      presencePenalty:
        config.get('presencePenalty') ||
        config.get('presence_penalty') ||
        defaultConfig.presencePenalty,
      maxRetries: config.get('maxRetries') || config.get('max_retries') || defaultConfig.maxRetries,
      streamUsage:
        config.get('streamUsage') || config.get('stream_usage') || defaultConfig.streamUsage,
      logprobs: config.get('logprobs') ?? defaultConfig.logprobs,
      topLogprobs: config.get('topLogprobs') || config.get('top_logprobs'),
      apiKey,
      configuration: config.get('configuration'),
    };
  }

  async invoke(messages: BaseMessage[], externalToolSpecs: any[] | undefined): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error(
        'OpenAI API key is required. Set AGENTLANG_OPENAI_KEY environment variable or use setLocalEnv("AGENTLANG_OPENAI_KEY", key) or provide apiKey in config.'
      );
    }
    if (externalToolSpecs) {
      const m = this.model.bindTools(externalToolSpecs);
      const r = await m.invoke(messages);
      return asAIResponse(r);
    }
    return asAIResponse(await this.model.invoke(messages));
  }

  getConfig(): OpenAIConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<OpenAIConfig>): void {
    this.config = { ...this.config, ...newConfig };

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      topP: this.config.topP,
      frequencyPenalty: this.config.frequencyPenalty,
      presencePenalty: this.config.presencePenalty,
      maxRetries: this.config.maxRetries,
      streamUsage: this.config.streamUsage,
      logprobs: this.config.logprobs,
      topLogprobs: this.config.topLogprobs,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.configuration) {
      chatConfig.configuration = this.config.configuration;
    }

    this.model = new ChatOpenAI(chatConfig);
  }
}
