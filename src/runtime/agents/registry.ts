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
  // This is the DEFAULT service, not based on available API keys
  return 'openai';
}

// Agents imported from registry
const RemoteAgents = new Map<string, any>();

function remoteAgentName(remoteAgentSpec: any): string | undefined {
  return remoteAgentSpec.agentFqName;
}

export function importRemoteAgent(remoteAgentSpec: any): string | undefined {
  const n = remoteAgentName(remoteAgentSpec);
  if (n) {
    RemoteAgents.set(n, remoteAgentSpec);
    return n;
  }
  return undefined;
}

export function getRemoteAgent(agentFqName: string): any {
  return RemoteAgents.get(agentFqName);
}

function getRemoteAgentUrl(remoteAgentSpec: any): string | undefined {
  return remoteAgentSpec.supportedInterface?.url;
}

export async function invokeRemoteAgentWithMessage(
  remoteAgentSpec: any,
  message: string
): Promise<any> {
  return await invokeRemoteAgentWithObject(remoteAgentSpec, { message });
}

export async function invokeRemoteAgentWithObject(remoteAgentSpec: any, data: any): Promise<any> {
  const url = getRemoteAgentUrl(remoteAgentSpec);
  if (url) {
    const defaultHdr = { 'Content-Type': 'application/json' };
    const response = await fetch(url, {
      method: 'POST',
      headers: defaultHdr,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to invoke remote agent ${remoteAgentName(remoteAgentSpec)} - ${response.status}, ${response.statusText}`
      );
    }

    return await response.json();
  } else {
    throw new Error(`No URL registered for ${remoteAgentName(remoteAgentSpec)}`);
  }
}
