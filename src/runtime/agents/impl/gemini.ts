import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { AgentServiceProvider, AIResponse, asAIResponse } from '../provider.js';
import { BaseMessage } from '@langchain/core/messages';
import { getLocalEnv } from '../../auth/defs.js';

export interface GeminiConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  maxRetries?: number;
  apiKey?: string;
  baseUrl?: string;
  streaming?: boolean;

  /**
   * Enable prompt caching to reuse context across API calls.
   * Gemini supports context caching for frequently used content.
   * @see https://ai.google.dev/gemini-api/docs/caching
   */
  enablePromptCaching?: boolean;

  /**
   * Cache control type for prompt caching.
   */
  cacheControl?: 'ephemeral';

  /**
   * Cache TTL in seconds (default: 3600 = 1 hour)
   */
  cacheTtlSeconds?: number;

  /**
   * Enable structured output mode for JSON responses.
   */
  enableStructuredOutput?: boolean;

  /**
   * JSON schema for structured output when enableStructuredOutput is true.
   */
  responseSchema?: object;
}

export class GeminiProvider implements AgentServiceProvider {
  private model: ChatGoogleGenerativeAI;
  private config: GeminiConfig;

  constructor(config?: Map<string, any>) {
    this.config = this.parseConfig(config);

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
      topP: this.config.topP,
      topK: this.config.topK,
      maxRetries: this.config.maxRetries,
      streaming: this.config.streaming,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.baseUrl) {
      chatConfig.baseUrl = this.config.baseUrl;
    }

    this.model = new ChatGoogleGenerativeAI(chatConfig);
  }

  private parseConfig(config?: Map<string, any>): GeminiConfig {
    const defaultConfig: GeminiConfig = {
      model: 'gemini-2.5-flash',
      temperature: 0.7,
      maxTokens: 8192,
      topP: 0.95,
      topK: 40,
      maxRetries: 2,
      streaming: false,
      enablePromptCaching: true,
      cacheControl: 'ephemeral',
      cacheTtlSeconds: 3600,
      enableStructuredOutput: false,
    };

    if (!config) {
      return {
        ...defaultConfig,
        apiKey: process.env.AGENTLANG_GEMINI_KEY || getLocalEnv('AGENTLANG_GEMINI_KEY'),
      };
    }

    const apiKey =
      config.get('apiKey') ||
      config.get('api_key') ||
      process.env.AGENTLANG_GEMINI_KEY ||
      getLocalEnv('AGENTLANG_GEMINI_KEY');

    return {
      model: config.get('model') || defaultConfig.model,
      temperature: config.get('temperature') ?? defaultConfig.temperature,
      maxTokens: config.get('maxTokens') || config.get('max_tokens') || defaultConfig.maxTokens,
      topP: config.get('topP') || config.get('top_p') || defaultConfig.topP,
      topK: config.get('topK') || config.get('top_k') || defaultConfig.topK,
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
      cacheTtlSeconds:
        config.get('cacheTtlSeconds') ||
        config.get('cache_ttl_seconds') ||
        config.get('cache_ttl') ||
        defaultConfig.cacheTtlSeconds,
      enableStructuredOutput: (() => {
        const value =
          config.get('enableStructuredOutput') ||
          config.get('enable_structured_output') ||
          config.get('structuredOutput');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.enableStructuredOutput;
      })(),
      responseSchema: config.get('responseSchema') || config.get('response_schema'),
      apiKey,
      baseUrl: config.get('baseUrl') || config.get('base_url'),
    };
  }

  async invoke(messages: BaseMessage[], externalToolSpecs: any[] | undefined): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error(
        'Gemini API key is required. Set AGENTLANG_GEMINI_KEY environment variable or use setLocalEnv("AGENTLANG_GEMINI_KEY", key) or provide apiKey in config.'
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

  getConfig(): GeminiConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<GeminiConfig>): void {
    this.config = { ...this.config, ...newConfig };

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
      topP: this.config.topP,
      topK: this.config.topK,
      maxRetries: this.config.maxRetries,
      streaming: this.config.streaming,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.baseUrl) {
      chatConfig.baseUrl = this.config.baseUrl;
    }

    this.model = new ChatGoogleGenerativeAI(chatConfig);
  }
}
