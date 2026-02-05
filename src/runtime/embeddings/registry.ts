import { OpenAIEmbeddingProvider } from './openai.js';

const EmbeddingProviders = new Map().set('openai', OpenAIEmbeddingProvider);

export function embeddingProvider(service: string): any {
  const requestedService = service.toLowerCase();
  const provider = EmbeddingProviders.get(requestedService);
  if (provider) {
    return provider;
  } else {
    throw new Error(`No embedding provider found for ${service}`);
  }
}

export function getDefaultEmbeddingProvider(): string {
  return 'openai';
}
