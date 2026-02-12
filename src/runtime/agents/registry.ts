import { OpenAIProvider } from './impl/openai.js';
import { AnthropicProvider } from './impl/anthropic.js';
import { GeminiProvider } from './impl/gemini.js';
import { GrokProvider } from './impl/grok.js';

const Providers = new Map()
  .set('openai', OpenAIProvider)
  .set('anthropic', AnthropicProvider)
  .set('gemini', GeminiProvider)
  .set('google', GeminiProvider)
  .set('grok', GrokProvider)
  .set('xai', GrokProvider);

export function provider(service: string) {
  const requestedService = service.toLowerCase();
  const p = Providers.get(requestedService);

  if (p) {
    // Return the requested provider - let it handle API key validation
    return p;
  } else {
    throw new Error(`No provider found for ${service}`);
  }
}

export function getDefaultLLMService(): string {
  // Always default to OpenAI when no service is explicitly specified
  // This is the DEFAULT service, not based on available API keys
  return 'openai';
}
