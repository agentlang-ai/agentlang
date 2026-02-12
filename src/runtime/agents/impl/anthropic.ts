import { ChatAnthropic } from '@langchain/anthropic';
import { AgentServiceProvider, AIResponse, asAIResponse } from '../provider.js';
import { BaseMessage } from '@langchain/core/messages';
import { getLocalEnv } from '../../auth/defs.js';

export interface AnthropicConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  apiKey?: string;
  stream?: boolean;
  clientOptions?: {
    defaultHeaders?: Record<string, string>;
    [key: string]: any;
  };

  /**
   * Enable prompt caching to reuse context across API calls.
   * This reduces latency and costs by caching static portions of prompts.
   * Cache has a 5-minute lifetime by default, refreshed on each use.
   * Minimum cacheable length: 1024 tokens for Claude 3.5+, 2048 for Haiku.
   * Beta header: prompt-caching-2024-07-31
   * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   */
  enablePromptCaching?: boolean;

  /**
   * Cache control type for prompt caching.
   * Currently only 'ephemeral' is supported with 5-minute TTL.
   * Can be extended to 1-hour with extended-cache-ttl-2025-04-11 beta.
   */
  cacheControl?: 'ephemeral';

  /**
   * Enable extended thinking mode for Claude to show its reasoning process.
   * When enabled, responses include thinking blocks showing Claude's thought process.
   * Requires minimum budgetTokens of 1024 and counts towards maxTokens.
   * NOTE: When thinking is enabled, temperature cannot be customized and will use default.
   * Useful for complex reasoning, problem-solving, and transparency.
   * @see https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
   */
  enableThinking?: boolean;

  /**
   * Token budget for thinking mode (minimum 1024).
   * Determines how many tokens Claude can use for internal reasoning.
   * Larger budgets enable more thorough analysis for complex problems.
   * Must be less than maxTokens.
   */
  budgetTokens?: number;

  /**
   * Enable extended output to generate up to 128,000 tokens in a single response.
   * Useful for long-form content, detailed reports, extensive code generation.
   * Beta header: output-128k-2025-02-19
   * Note: Use streaming to avoid timeouts with long outputs.
   */
  enableExtendedOutput?: boolean;

  /**
   * Enable interleaved thinking to see Claude's reasoning in real-time during streaming.
   * When combined with extended thinking, thinking blocks are streamed alongside content.
   * Provides transparency into Claude's problem-solving process as it happens.
   * Beta header: interleaved-thinking-2025-05-14
   */
  enableInterleavedThinking?: boolean;

  /**
   * Enable fine-grained tool streaming for more responsive tool use.
   * Streams partial JSON updates and character-by-character tool parameters.
   * Improves UI responsiveness when Claude invokes tools.
   * Beta header: fine-grained-tool-streaming-2025-05-14
   */
  enableFineGrainedToolStreaming?: boolean;
}

export class AnthropicProvider implements AgentServiceProvider {
  private model: ChatAnthropic;
  private config: AnthropicConfig;

  constructor(config?: Map<string, any>) {
    this.config = this.parseConfig(config);

    // Validate extended output requirements - streaming is required for 128k outputs to avoid timeouts
    if (this.config.enableExtendedOutput && !this.config.stream) {
      throw new Error(
        'Anthropic configuration error: enableExtendedOutput requires stream to be true. ' +
          'Extended output mode generates up to 128k tokens and streaming is required to avoid timeouts. ' +
          'Please set stream: true in your configuration or disable enableExtendedOutput.'
      );
    }

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries,
      streaming: this.config.stream,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.clientOptions) {
      chatConfig.clientOptions = this.config.clientOptions;
    }

    // Configure beta headers based on enabled features
    const betaFeatures: string[] = [];

    // Prompt caching: Reuse static content across API calls
    // Reduces costs by 90% for cached content, improves latency
    if (this.config.enablePromptCaching) {
      betaFeatures.push('prompt-caching-2024-07-31');
    }

    // Extended output: Generate up to 128k tokens (vs standard 8k)
    // Essential for long-form content generation
    if (this.config.enableExtendedOutput) {
      betaFeatures.push('output-128k-2025-02-19');
    }

    // Interleaved thinking: Stream thinking blocks alongside regular content
    // Shows Claude's reasoning process in real-time during streaming
    if (this.config.enableInterleavedThinking) {
      betaFeatures.push('interleaved-thinking-2025-05-14');
    }

    // Fine-grained tool streaming: Stream partial tool parameters
    // Provides character-by-character updates for better UX
    if (this.config.enableFineGrainedToolStreaming) {
      betaFeatures.push('fine-grained-tool-streaming-2025-05-14');
    }

    if (betaFeatures.length > 0) {
      chatConfig.clientOptions = {
        ...chatConfig.clientOptions,
        defaultHeaders: {
          ...chatConfig.clientOptions?.defaultHeaders,
          'anthropic-beta': betaFeatures.join(','),
        },
      };
    }

    // Configure thinking mode if enabled
    // Thinking mode should be passed to constructor, not invoke method
    if (this.config.enableThinking) {
      // Validate budget tokens (minimum 1024 required by API)
      const budgetTokens = Math.max(1024, this.config.budgetTokens || 1024);

      // Ensure budget tokens don't exceed max tokens
      // This prevents API errors and ensures proper token allocation
      if (budgetTokens >= (this.config.maxTokens || 8192)) {
        throw new Error(
          `budgetTokens (${budgetTokens}) must be less than maxTokens (${this.config.maxTokens || 8192})`
        );
      }

      // When thinking is enabled, temperature must not be customized
      // Anthropic requires using default temperature with thinking mode
      delete chatConfig.temperature;

      chatConfig.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens,
      };
    }

    this.model = new ChatAnthropic(chatConfig);
  }

  private parseConfig(config?: Map<string, any>): AnthropicConfig {
    const defaultConfig: AnthropicConfig = {
      model: 'claude-sonnet-4-5',
      temperature: 0.7,
      maxTokens: 8192,
      maxRetries: 2,
      stream: false,
      enablePromptCaching: true,
      cacheControl: 'ephemeral',
      enableThinking: false,
      budgetTokens: 1024,
      enableExtendedOutput: false,
      enableInterleavedThinking: false,
      enableFineGrainedToolStreaming: false,
    };

    if (!config) {
      return {
        ...defaultConfig,
        apiKey: process.env.AGENTLANG_ANTHROPIC_KEY || getLocalEnv('AGENTLANG_ANTHROPIC_KEY'),
      };
    }

    const apiKey =
      config.get('apiKey') ||
      config.get('api_key') ||
      process.env.AGENTLANG_ANTHROPIC_KEY ||
      getLocalEnv('AGENTLANG_ANTHROPIC_KEY');

    return {
      model: config.get('model') || defaultConfig.model,
      temperature: config.get('temperature') ?? defaultConfig.temperature,
      maxTokens: config.get('maxTokens') || config.get('max_tokens') || defaultConfig.maxTokens,
      maxRetries: config.get('maxRetries') || config.get('max_retries') || defaultConfig.maxRetries,
      stream: (() => {
        const value = config.get('stream');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.stream;
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
      enableThinking: (() => {
        const value =
          config.get('enableThinking') || config.get('enable_thinking') || config.get('thinking');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.enableThinking;
      })(),
      budgetTokens:
        config.get('budgetTokens') ||
        config.get('budget_tokens') ||
        config.get('thinking_budget') ||
        defaultConfig.budgetTokens,
      enableExtendedOutput: (() => {
        const value =
          config.get('enableExtendedOutput') ||
          config.get('enable_extended_output') ||
          config.get('extendedOutput');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.enableExtendedOutput;
      })(),
      enableInterleavedThinking: (() => {
        const value =
          config.get('enableInterleavedThinking') ||
          config.get('enable_interleaved_thinking') ||
          config.get('interleavedThinking');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.enableInterleavedThinking;
      })(),
      enableFineGrainedToolStreaming: (() => {
        const value =
          config.get('enableFineGrainedToolStreaming') ||
          config.get('enable_fine_grained_tool_streaming') ||
          config.get('fineGrainedToolStreaming');
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultConfig.enableFineGrainedToolStreaming;
      })(),
      apiKey,
      clientOptions: config.get('clientOptions') || config.get('client_options'),
    };
  }

  async invoke(
    messages: BaseMessage[],
    _externalToolSpecs: any[] | undefined
  ): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error(
        'Anthropic API key is required. Set AGENTLANG_ANTHROPIC_KEY environment variable or use setLocalEnv("AGENTLANG_ANTHROPIC_KEY", key) or provide apiKey in config.'
      );
    }

    let processedMessages = messages;

    if (this.config.enablePromptCaching && messages.length > 0) {
      processedMessages = this.applyCacheControl(messages);
    }

    // Thinking configuration is now handled in the constructor
    // No need to pass additional options to invoke
    return asAIResponse(await this.model.invoke(processedMessages));
  }

  /**
   * Apply cache control to messages for prompt caching optimization.
   * Caches system messages with substantial content (>1000 chars) to reduce costs.
   * Cache hits cost 90% less than regular input tokens.
   */
  private applyCacheControl(messages: BaseMessage[]): BaseMessage[] {
    // Apply cache control to the last system message if present
    // This follows Anthropic's recommendation to cache long context at the end of system messages
    if (messages.length === 0) return messages;

    const processedMessages = [...messages];

    // Find the last system message and apply cache control
    for (let i = processedMessages.length - 1; i >= 0; i--) {
      const message = processedMessages[i];
      if ((message as any)._getType() === 'system') {
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

    // Validate extended output requirements - streaming is required for 128k outputs to avoid timeouts
    if (this.config.enableExtendedOutput && !this.config.stream) {
      throw new Error(
        'Anthropic configuration error: enableExtendedOutput requires stream to be true. ' +
          'Extended output mode generates up to 128k tokens and streaming is required to avoid timeouts. ' +
          'Please set stream: true in your configuration or disable enableExtendedOutput.'
      );
    }

    const chatConfig: any = {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      maxRetries: this.config.maxRetries,
      streaming: this.config.stream,
    };

    if (this.config.apiKey) {
      chatConfig.apiKey = this.config.apiKey;
    }

    if (this.config.clientOptions) {
      chatConfig.clientOptions = this.config.clientOptions;
    }

    // Configure beta headers based on enabled features
    const betaFeatures: string[] = [];

    // Prompt caching: Reuse static content across API calls
    // Reduces costs by 90% for cached content, improves latency
    if (this.config.enablePromptCaching) {
      betaFeatures.push('prompt-caching-2024-07-31');
    }

    // Extended output: Generate up to 128k tokens (vs standard 8k)
    // Essential for long-form content generation
    if (this.config.enableExtendedOutput) {
      betaFeatures.push('output-128k-2025-02-19');
    }

    // Interleaved thinking: Stream thinking blocks alongside regular content
    // Shows Claude's reasoning process in real-time during streaming
    if (this.config.enableInterleavedThinking) {
      betaFeatures.push('interleaved-thinking-2025-05-14');
    }

    // Fine-grained tool streaming: Stream partial tool parameters
    // Provides character-by-character updates for better UX
    if (this.config.enableFineGrainedToolStreaming) {
      betaFeatures.push('fine-grained-tool-streaming-2025-05-14');
    }

    if (betaFeatures.length > 0) {
      chatConfig.clientOptions = {
        ...chatConfig.clientOptions,
        defaultHeaders: {
          ...chatConfig.clientOptions?.defaultHeaders,
          'anthropic-beta': betaFeatures.join(','),
        },
      };
    }

    // Configure thinking mode if enabled
    // Thinking mode should be passed to constructor, not invoke method
    if (this.config.enableThinking) {
      // Validate budget tokens (minimum 1024 required by API)
      const budgetTokens = Math.max(1024, this.config.budgetTokens || 1024);

      // Ensure budget tokens don't exceed max tokens
      // This prevents API errors and ensures proper token allocation
      if (budgetTokens >= (this.config.maxTokens || 8192)) {
        throw new Error(
          `budgetTokens (${budgetTokens}) must be less than maxTokens (${this.config.maxTokens || 8192})`
        );
      }

      // When thinking is enabled, temperature must not be customized
      // Anthropic requires using default temperature with thinking mode
      delete chatConfig.temperature;

      // Add thinking configuration to the ChatAnthropic constructor
      chatConfig.thinking = {
        type: 'enabled',
        budget_tokens: budgetTokens,
      };
    }

    this.model = new ChatAnthropic(chatConfig);
  }
}
