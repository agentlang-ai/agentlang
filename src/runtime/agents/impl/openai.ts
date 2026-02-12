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

  /**
   * Enable prompt caching to reuse context across API calls.
   * OpenAI supports context caching for frequently used content.
   * Reduces costs and latency for repeated prompts.
   */
  enablePromptCaching?: boolean;

  /**
   * Cache control type for prompt caching.
   * Currently supports 'ephemeral' for temporary caching.
   */
  cacheControl?: 'ephemeral';

  /**
   * Seed for reproducible outputs.
   * Ensures consistent responses for the same input.
   */
  seed?: number;

  /**
   * Enable JSON mode for structured outputs.
   * Forces the model to output valid JSON.
   */
  jsonMode?: boolean;

  /**
   * Stop sequences to stop generation.
   */
  stopSequences?: string[];
}

export class OpenAIProvider implements AgentServiceProvider {
  private model: ChatOpenAI;
  private config: OpenAIConfig;

  /**
   * Check if the model supports JSON mode (response_format with json_object).
   * Only gpt-4o and newer models are supported. Older models (gpt-4-turbo, gpt-3.5-turbo, etc.) are not supported.
   */
  private static supportsJsonMode(model: string): boolean {
    const normalizedModel = model.toLowerCase().trim();

    // Supported models: gpt-4o family, gpt-4.5+, gpt-5+, o1, o3
    const supportedPatterns = [
      /^gpt-4o/, // gpt-4o, gpt-4o-mini, gpt-4o-2024, etc.
      /^gpt-4[.]\d/, // gpt-4.5, gpt-4.1, etc.
      /^gpt-5/, // gpt-5.2, gpt-5.3, gpt-5.2-codex, etc.
      /^o1/, // o1-preview, o1-mini, etc.
      /^o3/, // o3-mini, etc.
    ];

    return supportedPatterns.some(pattern => pattern.test(normalizedModel));
  }

  constructor(config?: Map<string, any>) {
    this.config = this.parseConfig(config);

    // Validate JSON mode support - throw error for unsupported models
    if (this.config.jsonMode && !OpenAIProvider.supportsJsonMode(this.config.model || '')) {
      throw new Error(
        `OpenAI configuration error: jsonMode is enabled but model '${this.config.model}' does not support JSON mode. ` +
          'JSON mode requires gpt-4o or newer models (gpt-4o, gpt-4.5+, gpt-5+, o1, o3). ' +
          'Please use a compatible model or disable jsonMode.'
      );
    }

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
      seed: this.config.seed,
      stop: this.config.stopSequences,
      response_format: this.config.jsonMode ? { type: 'json_object' } : undefined,
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
      model: 'gpt-5.2',
      temperature: 0.1,
      maxTokens: 4096,
      topP: 1.0,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxRetries: 2,
      streamUsage: true,
      logprobs: false,
      enablePromptCaching: true,
      cacheControl: 'ephemeral',
      jsonMode: false,
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
      enablePromptCaching: (() => {
        const value = config.get('enablePromptCaching') || config.get('enable_prompt_caching');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.enablePromptCaching;
      })(),
      cacheControl:
        config.get('cacheControl') || config.get('cache_control') || defaultConfig.cacheControl,
      seed: config.get('seed'),
      jsonMode: (() => {
        const value = config.get('jsonMode') || config.get('json_mode');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.jsonMode;
      })(),
      stopSequences: config.get('stopSequences') || config.get('stop_sequences'),
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

    let processedMessages = messages;

    if (this.config.enablePromptCaching && messages.length > 0) {
      processedMessages = this.applyCacheControl(messages);
    }

    if (externalToolSpecs) {
      const m = this.model.bindTools(externalToolSpecs);
      const r = await m.invoke(processedMessages);
      return asAIResponse(r);
    }
    return asAIResponse(await this.model.invoke(processedMessages));
  }

  /**
   * Apply cache control to messages for prompt caching optimization.
   * Applies caching to system messages with substantial content.
   */
  private applyCacheControl(messages: BaseMessage[]): BaseMessage[] {
    if (messages.length === 0) return messages;

    const processedMessages = [...messages];

    for (let i = processedMessages.length - 1; i >= 0; i--) {
      const message = processedMessages[i];
      if ((message as any)._getType() === 'system') {
        const content = message.content;
        if (typeof content === 'string' && content.length > 1000) {
          // Create a shallow copy of the message to avoid modifying the original
          const messageCopy = Object.create(Object.getPrototypeOf(message));
          Object.assign(messageCopy, message);
          (messageCopy as any).additional_kwargs = {
            ...((message as any).additional_kwargs || {}),
            cache_control: { type: this.config.cacheControl || 'ephemeral' },
          };
          processedMessages[i] = messageCopy;
        }
        break;
      }
    }

    return processedMessages;
  }

  getConfig(): OpenAIConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<OpenAIConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Validate JSON mode support - throw error for unsupported models
    if (this.config.jsonMode && !OpenAIProvider.supportsJsonMode(this.config.model || '')) {
      throw new Error(
        `OpenAI configuration error: jsonMode is enabled but model '${this.config.model}' does not support JSON mode. ` +
          'JSON mode requires gpt-4o or newer models (gpt-4o, gpt-4.5+, gpt-5+, o1, o3). ' +
          'Please use a compatible model or disable jsonMode.'
      );
    }

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
      seed: this.config.seed,
      stop: this.config.stopSequences,
      response_format: this.config.jsonMode ? { type: 'json_object' } : undefined,
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
