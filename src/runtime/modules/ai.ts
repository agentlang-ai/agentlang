import { isFqName, makeCoreModuleName, makeFqName, splitFqName } from '../util.js';
import {
  Environment,
  GlobalEnvironment,
  makeEventEvaluator,
  parseAndEvaluateStatement,
} from '../interpreter.js';
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
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import { PlannerInstructions } from '../agents/common.js';
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
    type @enum("chat", "planner") @default("chat"),
    runWorkflows Boolean @default(true),
    instruction String @optional,
    tools String @optional, // comma-separated list of tool names
    documents String @optional, // comma-separated list of document names
    channels String @optional, // comma-separated list of channel names
    output String @optional, // fq-name of another agent to which the result will be pushed
    role String @optional,
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

const ProviderDb = new Map<string, AgentServiceProvider>();

export class AgentInstance {
  llm: string = '';
  name: string = '';
  chatId: string | undefined;
  instruction: string = '';
  type: string = 'chat';
  tools: string | undefined;
  documents: string | undefined;
  channels: string | undefined;
  runWorkflows: boolean = true;
  output: string | undefined;
  role: string | undefined;
  private toolsArray: string[] | undefined = undefined;
  private hasModuleTools = false;
  private withSession = true

  private constructor() { }

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

  static FromFlowStep(step: FlowStep, rootAgent: AgentInstance): AgentInstance {
    const attrs = newInstanceAttributes()
      .set('name', `${rootAgent.name}-${crypto.randomUUID()}`)
      .set('llm', rootAgent.llm);
    if (step.tools) {
      attrs.set('tools', step.tools);
    }
    if (step.channels) {
      attrs.set('channels', step.channels);
    }
    let ins = step.instruction;
    if (!ins) {
      if (step.condition && step.then && step.else) {
        ins = `If ${step.condition} then return '${step.then} otherwise return '${step.else}`;
      }
    }
    if (!ins) {
      throw new Error(`Cannot create instruction from step ${step.step}`);
    }
    attrs.set('instruction', ins);
    const inst = makeInstance(CoreAIModuleName, AgentEntityName, attrs);
    return AgentInstance.FromInstance(inst);
  }

  disableSession(): AgentInstance {
    this.withSession = false
    return this
  }

  enableSession(): AgentInstance {
    this.withSession = true
    return this
  }

  hasSession(): boolean {
    return this.withSession
  }

  isPlanner(): boolean {
    return this.hasModuleTools || this.type == 'planner';
  }

  async invoke(message: string, env: Environment) {
    const p = await findProviderForLLM(this.llm, env);
    const agentName = this.name;
    const chatId = this.chatId || agentName;
    const isplnr = this.isPlanner();
    if (isplnr && this.withSession) {
      this.withSession = false
    }
    const sess: Instance | null = this.withSession ? await findAgentChatSession(chatId, env) : null;
    let msgs: BaseMessage[] | undefined;
    if (sess) {
      msgs = sess.lookup('messages');
    } else {
      msgs = [systemMessage(this.instruction)];
    }
    if (msgs) {
      try {
        const sysMsg = msgs[0];
        if (isplnr) {
          const newSysMsg = systemMessage(
            `${PlannerInstructions}\n${this.toolsAsString()}\n${this.instruction}`
          );
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
          await saveAgentChatSession(chatId, msgs, env);
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
  let p: AgentServiceProvider | undefined = ProviderDb.get(llmName);
  if (p == undefined) {
    const result: Instance[] = await parseAndEvaluateStatement(
      `{${CoreAIModuleName}/${LlmEntityName} {name? "${llmName}"}}`,
      undefined,
      env
    );
    if (result.length > 0) {
      const llm: Instance = result[0];
      const service = llm.lookup('service');
      const pclass = provider(service);
      const configValue = llm.lookup('config');
      const providerConfig: Map<string, any> = configValue
        ? configValue instanceof Map
          ? configValue
          : new Map(Object.entries(configValue))
        : new Map().set('service', service);
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

export function agentName(agentInstance: Instance): string {
  return agentInstance.lookup('name');
}

export type FlowStep = any;
export type FlowSpec = Array<FlowStep>;
const AgentFlows = new Map<string, FlowSpec>();

export function registerAgentFlow(agentName: string, flow: FlowSpec): string {
  AgentFlows.set(agentName, flow);
  return agentName;
}

export function getAgentFlow(agentName: string): FlowSpec | undefined {
  return AgentFlows.get(agentName);
}

export function isStepConditional(step: FlowStep): boolean {
  if (step.condition) {
    return true;
  }
  return false;
}

export class FlowIterator {
  private offset: number = 0;
  private flow: FlowSpec;

  constructor(flow: FlowSpec) {
    this.flow = flow;
  }

  static From(flow: FlowSpec): FlowIterator {
    return new FlowIterator(flow);
  }

  hasNext(): boolean {
    return this.offset < this.flow.length;
  }

  getStep(): FlowStep {
    return this.flow[this.offset];
  }

  next(): FlowIterator {
    ++this.offset;
    return this;
  }

  getOffset(): number {
    return this.offset
  }

  setOffset(offset: number): FlowIterator {
    this.offset = offset;
    return this
  }

  moveToStep(step: string): boolean {
    this.offset = 0;
    for (let i = 0; i < this.flow.length; ++i) {
      if (this.flow[i].step == step) {
        this.offset = i;
        return true;
      }
    }
    return false;
  }
}
