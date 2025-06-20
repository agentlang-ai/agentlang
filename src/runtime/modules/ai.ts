import { makeFqName } from '../util.js';
import { Environment, parseAndEvaluateStatement } from '../interpreter.js';
import { CoreAIModuleName, Instance } from '../module.js';
import { provider } from '../agents/registry.js';
import { AgentServiceProvider } from '../agents/provider.js';

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
}`;

export const AgentFqName = makeFqName(CoreAIModuleName, 'agent');

const ProviderDb = new Map<string, AgentServiceProvider>();

export async function findProviderForLLM(
  llmName: string,
  env: Environment
): Promise<AgentServiceProvider> {
  let p: AgentServiceProvider | undefined = ProviderDb.get(llmName);
  if (p == undefined) {
    const result: Instance[] = await parseAndEvaluateStatement(
      `{${CoreAIModuleName}/llm {name? ${llmName}}}`,
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
