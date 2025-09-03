import { OpenAIProvider } from './impl/openai.js';
import { AnthropicProvider } from './impl/anthropic.js';

const Providers = new Map().set('openai', OpenAIProvider).set('anthropic', AnthropicProvider);

export function provider(service: string) {
  const requestedService = service.toLowerCase();
  let p = Providers.get(requestedService);

  if (p) {
    // Check if the requested provider has its API key available
    if (isProviderAvailable(requestedService)) {
      return p;
    } else {
      // Try to find an alternative available provider
      const availableService = getAvailableProvider();
      if (availableService && availableService !== requestedService) {
        p = Providers.get(availableService);
        if (p) return p;
      }
      const errorMessage = `${service} provider requested but ${service.toUpperCase()}_API_KEY not found. Available providers: ${getAvailableProviders().join(', ') || 'none'}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  } else {
    throw new Error(`No provider found for ${service}`);
  }
}

function isProviderAvailable(service: string): boolean {
  switch (service) {
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    case 'anthropic':
      return !!process.env.ANTHROPIC_API_KEY;
    default:
      return false;
  }
}

function getAvailableProvider(): string | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return 'anthropic';
  }
  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }
  return null;
}

function getAvailableProviders(): string[] {
  const available: string[] = [];
  if (process.env.ANTHROPIC_API_KEY) available.push('anthropic');
  if (process.env.OPENAI_API_KEY) available.push('openai');
  return available;
}
