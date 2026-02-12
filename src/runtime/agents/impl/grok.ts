import { ChatXAI } from '@langchain/xai';
import { AgentServiceProvider, AIResponse, asAIResponse } from '../provider.js';
import { BaseMessage } from '@langchain/core/messages';
import { getLocalEnv } from '../../auth/defs.js';

export interface GrokConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  maxRetries?: number;
  apiKey?: string;
  streaming?: boolean;

  /**
   * Enable prompt caching to reuse context across API calls.
   * Grok supports prompt caching for improved performance.
   */
  enablePromptCaching?: boolean;

  /**
   * Cache control type for prompt caching.
   */
  cacheControl?: 'ephemeral';

  /**
   * Enable JSON mode for structured outputs.
   * Forces the model to output valid JSON.
   */
  jsonMode?: boolean;

  /**
   * Stop sequences for the model to stop generation.
   */
  stopSequences?: string[];

  /**
   * Seed for reproducible sampling.
   */
  seed?: number;

  /**
   * Tool choice configuration for function calling.
   */
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

export class GrokProvider implements AgentServiceProvider {
  private model: ChatXAI;
  private config: GrokConfig;

  constructor(config?: Map<string, any>) {
    this.config = this.parseConfig(config);

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      topP: this.config.topP,
      maxRetries: this.config.maxRetries,
      streaming: this.config.streaming,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.stopSequences) {
      chatConfig.stop = this.config.stopSequences;
    }

    if (this.config.seed !== undefined) {
      chatConfig.seed = this.config.seed;
    }

    if (this.config.jsonMode) {
      chatConfig.responseFormat = { type: 'json_object' };
    }

    this.model = new ChatXAI(chatConfig);
  }

  private parseConfig(config?: Map<string, any>): GrokConfig {
    const defaultConfig: GrokConfig = {
      model: 'grok-4.1-fast',
      temperature: 0.7,
      maxTokens: 4096,
      topP: 0.9,
      maxRetries: 2,
      streaming: false,
      enablePromptCaching: true,
      cacheControl: 'ephemeral',
      jsonMode: false,
    };

    if (!config) {
      return {
        ...defaultConfig,
        apiKey: process.env.AGENTLANG_XAI_KEY || getLocalEnv('AGENTLANG_XAI_KEY'),
      };
    }

    const apiKey =
      config.get('apiKey') ||
      config.get('api_key') ||
      process.env.AGENTLANG_XAI_KEY ||
      getLocalEnv('AGENTLANG_XAI_KEY');

    return {
      model: config.get('model') || defaultConfig.model,
      temperature: config.get('temperature') ?? defaultConfig.temperature,
      maxTokens: config.get('maxTokens') || config.get('max_tokens') || defaultConfig.maxTokens,
      topP: config.get('topP') || config.get('top_p') || defaultConfig.topP,
      maxRetries: config.get('maxRetries') || config.get('max_retries') || defaultConfig.maxRetries,
      streaming: (() => {
        const value = config.get('streaming') || config.get('stream');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.streaming;
      })(),
      enablePromptCaching: (() => {
        const value = config.get('enablePromptCaching') || config.get('enable_prompt_caching');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.enablePromptCaching;
      })(),
      cacheControl:
        config.get('cacheControl') || config.get('cache_control') || defaultConfig.cacheControl,
      jsonMode: (() => {
        const value = config.get('jsonMode') || config.get('json_mode');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.jsonMode;
      })(),
      stopSequences: config.get('stopSequences') || config.get('stop_sequences'),
      seed: config.get('seed'),
      toolChoice: config.get('toolChoice') || config.get('tool_choice'),
      apiKey,
    };
  }

  async invoke(messages: BaseMessage[], externalToolSpecs: any[] | undefined): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error(
        'xAI API key is required. Set AGENTLANG_XAI_KEY environment variable or use setLocalEnv("AGENTLANG_XAI_KEY", key) or provide apiKey in config.'
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
          (message as any).additional_kwargs = {
            ...((message as any).additional_kwargs || {}),
            cache_control: { type: this.config.cacheControl || 'ephemeral' },
          };
        }
        break;
      }
    }

    return processedMessages;
  }

  getConfig(): GrokConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<GrokConfig>): void {
    this.config = { ...this.config, ...newConfig };

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      topP: this.config.topP,
      maxRetries: this.config.maxRetries,
      streaming: this.config.streaming,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.stopSequences) {
      chatConfig.stop = this.config.stopSequences;
    }

    if (this.config.seed !== undefined) {
      chatConfig.seed = this.config.seed;
    }

    if (this.config.jsonMode) {
      chatConfig.responseFormat = { type: 'json_object' };
    }

    this.model = new ChatXAI(chatConfig);
  }
}
