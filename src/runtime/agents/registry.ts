import { OpenAIProvider } from './impl/openai.js';
import { AnthropicProvider } from './impl/anthropic.js';

const Providers = new Map().set('openai', OpenAIProvider).set('anthropic', AnthropicProvider);

export function provider(service: string) {
    const requestedService = service.toLowerCase();
    let p = Providers.get(requestedService);
    console.log('The value of p is: ', p);
    // Due to an underlying bug, this always picks up OpenAIProvider even if env value is set.
    return AnthropicProvider;
}
