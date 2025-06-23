import { OpenAIProvider } from './impl/openai.js';

const Providers = new Map().set('openai', OpenAIProvider);

export function provider(service: string) {
  const p = Providers.get(service.toLowerCase());
  if (p) return p;
  else throw new Error(`No provider found for ${service}`);
}
