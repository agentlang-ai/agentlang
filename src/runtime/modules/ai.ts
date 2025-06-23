import { makeCoreModuleName, makeFqName } from '../util.js';
import { Environment, makeEventEvaluator, parseAndEvaluateStatement } from '../interpreter.js';
import { Instance } from '../module.js';
import { provider } from '../agents/registry.js';
import {
  AgentServiceProvider,
  assistantMessage,
  humanMessage,
  systemMessage,
} from '../agents/provider.js';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';

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
    messages String
}

workflow findAgentChatSession {
  {agentChatSession {id? findAgentChatSession.id}} as [sess];
  sess
}

workflow saveAgentChatSession {
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

const evalEvent = makeEventEvaluator(CoreAIModuleName);

type GenericMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function asBaseMessages(gms: GenericMessage[]): BaseMessage[] {
  return gms.map((gm: GenericMessage): BaseMessage => {
    switch (gm.role) {
      case 'user': {
        return humanMessage(gm.content);
      }
      case 'assistant': {
        return assistantMessage(gm.content);
      }
      default: {
        return systemMessage(gm.content);
      }
    }
  });
}

function asGenericMessages(bms: BaseMessage[]): GenericMessage[] {
  return bms.map((bm: BaseMessage): GenericMessage => {
    if (bm instanceof HumanMessage) {
      return { role: 'user', content: bm.text };
    } else if (bm instanceof AIMessage) {
      return { role: 'assistant', content: bm.text };
    } else {
      return { role: 'system', content: bm.text };
    }
  });
}

export async function findAgentChatSession(
  chatId: string,
  env: Environment
): Promise<Instance | null> {
  const result: Instance | null = await evalEvent('findAgentChatSession', { id: chatId }, env);
  if (result) {
    result.attributes.set('messages', asBaseMessages(JSON.parse(result.lookup('messages'))));
  }
  return result;
}

export async function saveAgentChatSession(chatId: string, messages: any[], env: Environment) {
  await evalEvent(
    'saveAgentChatSession',
    { id: chatId, messages: JSON.stringify(asGenericMessages(messages)) },
    env
  );
}
