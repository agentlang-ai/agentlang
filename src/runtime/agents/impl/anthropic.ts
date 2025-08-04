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
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 8192,
      maxRetries: 2,
      enablePromptCaching: false,
      cacheControl: 'ephemeral',
    };

    if (!config) {
      return {
        ...defaultConfig,
        apiKey: process.env.ANTHROPIC_API_KEY,
      };
    }

    const apiKey = config.get('apiKey') || config.get('api_key') || process.env.ANTHROPIC_API_KEY;

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
      apiKey,
      clientOptions: config.get('clientOptions') || config.get('client_options'),
    };
  }

  async invoke(messages: BaseMessage[]): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error(
        'Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or provide apiKey in config.'
      );
    }

    let processedMessages = messages;

    if (this.config.enablePromptCaching && messages.length > 0) {
      processedMessages = this.applyCacheControl(messages);
    }

    return asAIResponse(await this.model.invoke(processedMessages));
  }

  private applyCacheControl(messages: BaseMessage[]): BaseMessage[] {
    // Apply cache control to the last system message if present
    // This follows Anthropic's recommendation to cache long context at the end of system messages
    if (messages.length === 0) return messages;

    const processedMessages = [...messages];

    // Find the last system message and apply cache control
    for (let i = processedMessages.length - 1; i >= 0; i--) {
      const message = processedMessages[i];
      if (message._getType() === 'system') {
        // Apply cache control to system message content
        const content = message.content;
        if (typeof content === 'string' && content.length > 1000) {
          // Only cache if content is substantial (>1000 chars as a heuristic)
          (message as any).additional_kwargs = {
            ...((message as any).additional_kwargs || {}),
            cache_control: { type: 'ephemeral' },
          };
        }
        break;
      }
    }

    return processedMessages;
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
