import { ChatAnthropic } from '@langchain/anthropic';
import { AgentServiceProvider, AIResponse, asAIResponse } from '../provider.js';
import { BaseMessage } from '@langchain/core/messages';

export interface AnthropicConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  apiKey?: string;
  clientOptions?: {
    defaultHeaders?: Record<string, string>;
    [key: string]: any;
  };
  enablePromptCaching?: boolean;
  cacheControl?: 'ephemeral';
}

export class AnthropicProvider implements AgentServiceProvider {
  private model: ChatAnthropic;
  private config: AnthropicConfig;

  constructor(config?: Map<string, any>) {
    this.config = this.parseConfig(config);

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.clientOptions) {
      chatConfig.clientOptions = this.config.clientOptions;
    }

    if (this.config.enablePromptCaching) {
      chatConfig.clientOptions = {
        ...chatConfig.clientOptions,
        defaultHeaders: {
          ...chatConfig.clientOptions?.defaultHeaders,
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
      };
    }

    this.model = new ChatAnthropic(chatConfig);
  }

  private parseConfig(config?: Map<string, any>): AnthropicConfig {
    const defaultConfig: AnthropicConfig = {
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.7,
      maxTokens: 4096,
      maxRetries: 2,
      enablePromptCaching: false,
      cacheControl: 'ephemeral',
    };

    if (!config) {
      return defaultConfig;
    }

    return {
      model: config.get('model') || defaultConfig.model,
      temperature: config.get('temperature') ?? defaultConfig.temperature,
      maxTokens: config.get('maxTokens') || config.get('max_tokens') || defaultConfig.maxTokens,
      maxRetries: config.get('maxRetries') || config.get('max_retries') || defaultConfig.maxRetries,
      enablePromptCaching:
        config.get('enablePromptCaching') ||
        config.get('enable_prompt_caching') ||
        defaultConfig.enablePromptCaching,
      cacheControl:
        config.get('cacheControl') || config.get('cache_control') || defaultConfig.cacheControl,
      apiKey: config.get('apiKey') || config.get('api_key') || process.env.ANTHROPIC_API_KEY,
      clientOptions: config.get('clientOptions') || config.get('client_options'),
    };
  }

  async invoke(messages: BaseMessage[]): Promise<AIResponse> {
    let processedMessages = messages;

    if (this.config.enablePromptCaching && messages.length > 0) {
      processedMessages = this.applyCacheControl(messages);
    }

    return asAIResponse(await this.model.invoke(processedMessages));
  }

  private applyCacheControl(messages: BaseMessage[]): BaseMessage[] {
    // For now, return messages as-is since cache control requires specific message formatting
    // that should be handled at the application level according to Anthropic's documentation
    // This method is kept for future implementation when proper message construction is available
    return messages;
  }

  getConfig(): AnthropicConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<AnthropicConfig>): void {
    this.config = { ...this.config, ...newConfig };

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.clientOptions) {
      chatConfig.clientOptions = this.config.clientOptions;
    }

    if (this.config.enablePromptCaching) {
      chatConfig.clientOptions = {
        ...chatConfig.clientOptions,
        defaultHeaders: {
          ...chatConfig.clientOptions?.defaultHeaders,
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
      };
    }

    this.model = new ChatAnthropic(chatConfig);
  }
}
