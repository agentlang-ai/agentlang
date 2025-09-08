import { OpenAIProvider } from './impl/openai.js';
import { AnthropicProvider } from './impl/anthropic.js';

const Providers = new Map().set('openai', OpenAIProvider).set('anthropic', AnthropicProvider);

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
  return 'openai';
}
