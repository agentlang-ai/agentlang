import { isFqName, makeCoreModuleName, makeFqName, splitFqName } from '../util.js';
import { Environment, GlobalEnvironment, parseAndEvaluateStatement } from '../interpreter.js';
import {
  fetchModule,
  Instance,
  instanceToObject,
  isModule,
  makeInstance,
  newInstanceAttributes,
} from '../module.js';
import { provider } from '../agents/registry.js';
import {
  AgentServiceProvider,
  AIResponse,
  assistantMessage,
  humanMessage,
  systemMessage,
} from '../agents/provider.js';
import { BaseMessage } from '@langchain/core/messages';
import { FlowExecInstructions, FlowStep, PlannerInstructions } from '../agents/common.js';
import { PathAttributeNameQuery } from '../defs.js';
import { logger } from '../logger.js';

export const CoreAIModuleName = makeCoreModuleName('ai');
export const AgentEntityName = 'Agent';
export const LlmEntityName = 'LLM';

export default `module ${CoreAIModuleName}

entity ${LlmEntityName} {
    name String @id,
    service String @default("openai"),
    config Map @optional
}

entity ${AgentEntityName} {
    name String @id,
    moduleName String @default("${CoreAIModuleName}"),
    type @enum("chat", "planner", "flow-exec") @default("chat"),
    runWorkflows Boolean @default(true),
    instruction String @optional,
    tools String @optional, // comma-separated list of tool names
    documents String @optional, // comma-separated list of document names
    channels String @optional, // comma-separated list of channel names
    output String @optional, // fq-name of another agent to which the result will be pushed
    role String @optional,
    flows String @optional,
    llm String
}

entity agentChatSession {
    id String @id,
    messages String
}

workflow findAgentChatSession {
  {agentChatSession {id? findAgentChatSession.id}} @as [sess];
  sess
}

workflow saveAgentChatSession {
  {agentChatSession {id saveAgentChatSession.id, messages saveAgentChatSession.messages}, @upsert}
}

entity Document {
  title String @id,
  content String,
  @meta {"fullTextSearch": "*"}
}

event doc {
  title String,
  url String
}
`;

export const AgentFqName = makeFqName(CoreAIModuleName, AgentEntityName);

// const ProviderDb = new Map<string, AgentServiceProvider>();  // Disabled caching to ensure correct provider is always used

export class AgentInstance {
  llm: string = '';
  name: string = '';
  moduleName: string = CoreAIModuleName;
  chatId: string | undefined;
  instruction: string = '';
  type: string = 'chat';
  tools: string | undefined;
  documents: string | undefined;
  channels: string | undefined;
  runWorkflows: boolean = true;
  output: string | undefined;
  role: string | undefined;
  flows: string | undefined;
  private toolsArray: string[] | undefined = undefined;
  private hasModuleTools = false;
  private withSession = true;

  private constructor() {}

  static FromInstance(agentInstance: Instance): AgentInstance {
    const agent: AgentInstance = instanceToObject<AgentInstance>(
      agentInstance,
      new AgentInstance()
    );
    let finalTools: string | undefined = undefined;
    if (agent.tools) finalTools = agent.tools;
    if (agent.channels) {
      if (finalTools) {
        finalTools = `${finalTools},${agent.channels}`;
      } else {
        finalTools = agent.channels;
      }
    }
    if (finalTools) {
      agent.toolsArray = finalTools.split(',');
    }
    if (agent.toolsArray) {
      for (let i = 0; i < agent.toolsArray.length; ++i) {
        const n = agent.toolsArray[i];
        if (isFqName(n)) {
          const parts = splitFqName(n);
          agent.hasModuleTools = isModule(parts.getModuleName());
        } else {
          agent.hasModuleTools = isModule(n);
        }
        if (agent.hasModuleTools) break;
      }
    }
    return agent;
  }

  static FromFlowStep(step: FlowStep, flowAgent: AgentInstance): AgentInstance {
    const fqs = isFqName(step) ? step : `${flowAgent.moduleName}/${step}`;
    const instruction = `Analyse the context and generate the pattern required to invoke ${fqs}.
    Never include references in the pattern. All attribute values must be literals derived from the context.`;
    const inst = makeInstance(
      CoreAIModuleName,
      AgentEntityName,
      newInstanceAttributes()
        .set('llm', flowAgent.llm)
        .set('name', `${step}_agent`)
        .set('moduleName', flowAgent.moduleName)
        .set('instruction', instruction)
        .set('tools', fqs)
        .set('type', 'planner')
    );
    return AgentInstance.FromInstance(inst);
  }

  disableSession(): AgentInstance {
    this.withSession = false;
    return this;
  }

  enableSession(): AgentInstance {
    this.withSession = true;
    return this;
  }

  hasSession(): boolean {
    return this.withSession;
  }

  isPlanner(): boolean {
    return this.hasModuleTools || this.type == 'planner';
  }

  isFlowExecutor(): boolean {
    return this.type == 'flow-exec';
  }

  async invoke(message: string, env: Environment) {
    const p = await findProviderForLLM(this.llm, env);
    const agentName = this.name;
    const chatId = this.chatId || agentName;
    const isplnr = this.isPlanner();
    const isflow = !isplnr && this.isFlowExecutor();
    if (isplnr && this.withSession) {
      this.withSession = false;
    }
    if (isflow) {
      this.withSession = false;
    }
    const sess: Instance | null = this.withSession
      ? await parseHelper(`{findAgentChatSession {id "${chatId}"}}`, env)
      : null;
    let msgs: BaseMessage[] | undefined;
    if (sess) {
      msgs = sess.lookup('messages');
    } else {
      msgs = [systemMessage(this.instruction || '')];
    }
    if (msgs) {
      try {
        const sysMsg = msgs[0];
        if (isplnr || isflow) {
          const s = isplnr ? PlannerInstructions : FlowExecInstructions;
          const newSysMsg = systemMessage(`${s}\n${this.toolsAsString()}\n${this.instruction}`);
          msgs[0] = newSysMsg;
        }
        msgs.push(humanMessage(await this.maybeAddRelevantDocuments(message, env)));
        const externalToolSpecs = this.getExternalToolSpecs();
        const response: AIResponse = await p.invoke(msgs, externalToolSpecs);
        msgs.push(assistantMessage(response.content));
        if (isplnr) {
          msgs[0] = sysMsg;
        }
        if (this.withSession) {
          await parseHelper(
            `{saveAgentChatSession {id "${chatId}", messages ${JSON.stringify(msgs)}}}`,
            env
          );
        }
        env.setLastResult(response.content);
      } catch (err: any) {
        logger.error(`Error while invoking ${agentName} - ${err}`);
        env.setLastResult(undefined);
      }
    } else {
      throw new Error(`failed to initialize messages for agent ${agentName}`);
    }
  }

  private getExternalToolSpecs(): any[] | undefined {
    let result: any[] | undefined = undefined;
    if (this.toolsArray) {
      this.toolsArray.forEach((n: string) => {
        const v = GlobalEnvironment.lookup(n);
        if (v) {
          if (result == undefined) {
            result = new Array<any>();
          }
          result.push(v);
        }
      });
    }
    return result;
  }

  private async maybeAddRelevantDocuments(message: string, env: Environment): Promise<string> {
    if (this.documents && this.documents.length > 0) {
      const s = `${message}. Relevant documents are: ${this.documents}`;
      const result: any[] = await parseHelper(`{${CoreAIModuleName}/Document? "${s}"}`, env);
      if (result && result.length > 0) {
        const docs: Instance[] = [];
        for (let i = 0; i < result.length; ++i) {
          const v: any = result[i];
          const r: Instance[] = await parseHelper(
            `{${CoreAIModuleName}/Document {${PathAttributeNameQuery} "${v.id}"}}`,
            env
          );
          if (r && r.length > 0) {
            docs.push(r[0]);
          }
        }
        if (docs.length > 0) {
          message = message.concat('\nUse the additional information given below:\n').concat(
            docs
              .map((v: Instance) => {
                return v.lookup('content');
              })
              .join('\n')
          );
        }
      }
    }
    return message;
  }

  private static ToolsCache = new Map<string, string>();

  private toolsAsString(): string {
    const cachedTools = AgentInstance.ToolsCache.get(this.name);
    if (cachedTools) {
      return cachedTools;
    }
    if (this.toolsArray) {
      const tooldefs = new Array<string>();
      const slimModules = new Map<string, string[]>();
      this.toolsArray.forEach((n: string) => {
        let moduleName: string | undefined;
        let entryName: string | undefined;
        if (isFqName(n)) {
          const parts = splitFqName(n);
          moduleName = parts.getModuleName();
          entryName = parts.getEntryName();
        } else {
          moduleName = n;
        }
        if (isModule(moduleName)) {
          const m = fetchModule(moduleName);
          if (entryName) {
            const hasmod = slimModules.has(moduleName);
            const defs = hasmod ? slimModules.get(moduleName) : new Array<string>();
            defs?.push(m.getEntry(entryName).toString());
            if (!hasmod && defs) {
              slimModules.set(moduleName, defs);
            }
          } else {
            tooldefs.push(fetchModule(moduleName).toString());
          }
        }
      });
      slimModules.forEach((defs: string[], modName: string) => {
        tooldefs.push(`module ${modName}\n${defs.join('\n')}`);
      });
      const agentTools = tooldefs.join('\n');
      AgentInstance.ToolsCache.set(this.name, agentTools);
      return agentTools;
    } else {
      return '';
    }
  }
}

async function parseHelper(stmt: string, env: Environment): Promise<any> {
  await parseAndEvaluateStatement(stmt, undefined, env);
  return env.getLastResult();
}

export async function findAgentByName(name: string, env: Environment): Promise<AgentInstance> {
  const result = await parseHelper(`{${AgentFqName} {name? "${name}"}}`, env);
  if (result instanceof Array && result.length > 0) {
    const agentInstance: Instance = result[0];
    return AgentInstance.FromInstance(agentInstance);
  } else {
    throw new Error(`Failed to find agent ${name}`);
  }
}

export async function findProviderForLLM(
  llmName: string,
  env: Environment
): Promise<AgentServiceProvider> {
  // Always fetch the LLM to check its current service
  const query = `{${CoreAIModuleName}/${LlmEntityName} {name? "${llmName}"}}`;
  const result: Instance[] = await parseAndEvaluateStatement(query, undefined, env);

  if (result.length > 0) {
    const llm: Instance = result[0];
    let service = llm.lookup('service');

    // If service is not set or is null, use the default
    if (!service || service === '' || service === null || service === undefined) {
      console.warn(`[WARNING] LLM ${llmName} has no service set, defaulting to 'openai'`);
      service = 'openai';
    }

    // Ensure service is lowercase string for consistency
    service = String(service).toLowerCase();

    console.log(`[INFO] Loading provider for LLM '${llmName}' with service '${service}'`);

    // ALWAYS create a new provider - no caching for now to avoid stale providers
    const pclass = provider(service);
    const configValue = llm.lookup('config');
    const providerConfig: Map<string, any> = configValue
      ? configValue instanceof Map
        ? configValue
        : new Map(Object.entries(configValue))
      : new Map();

    console.log(`[INFO] Creating ${pclass.name} for LLM '${llmName}'`);
    const p = new pclass(providerConfig);

    if (p) {
      return p;
    }
  }

  throw new Error(`Failed to load provider for ${llmName}`);
}

export function agentName(agentInstance: Instance): string {
  return agentInstance.lookup('name');
}
