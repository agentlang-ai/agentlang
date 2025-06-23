import { makeCoreModuleName, makeFqName } from '../util.js';
import { Environment, makeEventEvaluator, parseAndEvaluateStatement } from '../interpreter.js';
import { Instance } from '../module.js';
import { provider } from '../agents/registry.js';
import { AgentServiceProvider } from '../agents/provider.js';

export const CoreAIModuleName = makeCoreModuleName('ai');

export default `module ${CoreAIModuleName}

entity llm {
    name String @id,
    service String @default("openai"),
    config Map @optional
}

entity agent {
    name String @id,
    type @oneof("chat", "planner") @default("chat"),
    instruction String @optional,
    tools String[] @optional,
    documents String[] @optional,
    llm String
}

entity agentChatSession {
    id String @id,
    messages String[]
}

worflow findAgentChatSession {
  {agentChatSession {id? findAgentChatSession.id}} as [sess];
  sess
}

worflow saveAgentChatSession {
  upsert {agentChatSession {id saveAgentChatSession.id, messages saveAgentChatSession.messages}}
}
`;

export const AgentFqName = makeFqName(CoreAIModuleName, 'agent');

const ProviderDb = new Map<string, AgentServiceProvider>();

export async function findProviderForLLM(
  llmName: string,
  env: Environment
): Promise<AgentServiceProvider> {
  let p: AgentServiceProvider | undefined = ProviderDb.get(llmName);
  if (p == undefined) {
    const result: Instance[] = await parseAndEvaluateStatement(
      `{${CoreAIModuleName}/llm {name? "${llmName}"}}`,
      undefined,
      env
    );
    if (result.length > 0) {
      const llm: Instance = result[0];
      const service = llm.lookup('service');
      const pclass = provider(service);
      const providerConfig: Map<string, any> =
        llm.lookup('config') || new Map().set('service', service);
      p = new pclass(providerConfig);
      if (p) ProviderDb.set(llmName, p);
    }
  }
  if (p) {
    return p;
  } else {
    throw new Error(`Failed to load provider for ${llmName}`);
  }
}

const evalEvent = makeEventEvaluator(CoreAIModuleName)

export async function findAgentChatSession(chatId: string, env: Environment): Promise<Instance | undefined> {
  const result: Instance | undefined = await evalEvent("findAgentChatSession", { id: chatId }, env);
  if (result) {
    result.attributes.set('messages', JSON.parse(result.lookup('messages')))
  }
  return result
}

export async function saveAgentChatSession(chatId: string, messages: any[], env: Environment) {
  await evalEvent('saveAgentChatSession', { id: chatId, messages: JSON.stringify(messages) }, env)
}
