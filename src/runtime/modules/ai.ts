import { isFqName, makeCoreModuleName, makeFqName, splitFqName } from '../util.js';
import {
  Environment,
  GlobalEnvironment,
  makeEventEvaluator,
  parseAndEvaluateStatement,
} from '../interpreter.js';
import {
  asJSONSchema,
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
import { FlowExecInstructions, PlannerInstructions } from '../agents/common.js';
import { PathAttributeNameQuery } from '../defs.js';
import { logger } from '../logger.js';
import { FlowStep } from '../agents/flows.js';

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

const ProviderDb = new Map<string, AgentServiceProvider>();

export type AgentCondition = {
  cond: string;
  then: string;
};

const AgentDirectives = new Map<string, AgentCondition[]>();

export function registerAgentDirectives(
  moduleName: string,
  agentName: string,
  conds: AgentCondition[]
) {
  AgentDirectives.set(makeFqName(moduleName, agentName), conds);
}

export type AgentScenario = {
  user: string;
  ai: string;
};

const AgentScenarios = new Map<string, AgentScenario[]>();

export function registerAgentScenarios(
  moduleName: string,
  agentName: string,
  scenarios: AgentScenario[]
) {
  AgentScenarios.set(makeFqName(moduleName, agentName), scenarios);
}

export type AgentGlossaryEntry = {
  name: string;
  meaning: string;
  synonyms: string | undefined;
};

const AgentGlossary = new Map<string, AgentGlossaryEntry[]>();

export function registerAgentGlossary(
  moduleName: string,
  agentName: string,
  glossary: AgentGlossaryEntry[]
) {
  AgentGlossary.set(makeFqName(moduleName, agentName), glossary);
}

const AgentResponseSchema = new Map<string, string>();

export function registerAgentResponseSchema(
  moduleName: string,
  agentName: string,
  responseSchema: string
) {
  AgentResponseSchema.set(makeFqName(moduleName, agentName), responseSchema);
}

const AgentScratchNames = new Map<string, Set<string>>();

export function registerAgentScratchNames(
  moduleName: string,
  agentName: string,
  scratch: string[]
) {
  AgentScratchNames.set(makeFqName(moduleName, agentName), new Set(scratch));
}

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
  role: string | undefined;
  flows: string | undefined;
  private toolsArray: string[] | undefined = undefined;
  private hasModuleTools = false;
  private withSession = true;
  private fqName: string | undefined;

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

  private directivesAsString(fqName: string): string {
    const conds = AgentDirectives.get(fqName);
    if (conds) {
      const ss = new Array<string>();
      ss.push(
        '\nUse the following guidelines to take more accurate decisions in relevant scenarios.\n'
      );
      conds.forEach((ac: AgentCondition) => {
        ss.push(`if ${ac.cond}, then ${ac.then}`);
      });
      return `${ss.join('\n')}\n`;
    }
    return '';
  }

  private cachedInstruction: string | undefined = undefined;

  private getFullInstructions(): string {
    if (this.cachedInstruction) {
      return this.cachedInstruction;
    }
    const fqName = this.getFqName();
    this.cachedInstruction = `${this.instruction || ''} ${this.directivesAsString(fqName)}`;
    const gls = AgentGlossary.get(fqName);
    if (gls) {
      const glss = new Array<string>();
      gls.forEach((age: AgentGlossaryEntry) => {
        glss.push(
          `${age.name}: ${age.meaning}. ${age.synonyms ? `These words are synonyms for ${age.name}: ${age.synonyms}` : ''}`
        );
      });
      this.cachedInstruction = `${this.cachedInstruction}\nThe following glossary will be helpful for understanding user requests.
      ${glss.join('\n')}\n`;
    }
    const scenarios = AgentScenarios.get(fqName);
    if (scenarios) {
      const scs = new Array<string>();
      scenarios.forEach((sc: AgentScenario) => {
        scs.push(`User: ${sc.user}\nAI: ${sc.ai}\n`);
      });
      this.cachedInstruction = `${this.cachedInstruction}\nHere are some example user requests and the corresponding responses you are supposed to produce:\n${scs.join('\n')}`;
    }
    const responseSchema = AgentResponseSchema.get(fqName);
    if (responseSchema) {
      this.cachedInstruction = `${this.cachedInstruction}\nReturn your response in the following JSON schema:\n${asJSONSchema(responseSchema)}
Only return a pure JSON object with no extra text, annotations etc.`;
    }
    return this.cachedInstruction;
  }

  maybeValidateJsonResponse(response: string | undefined): object | undefined {
    if (response) {
      const responseSchema = AgentResponseSchema.get(this.getFqName());
      if (responseSchema) {
        const attrs = JSON.parse(response);
        const parts = splitFqName(responseSchema);
        makeInstance(parts.getModuleName(), parts.getEntryName(), new Map(Object.entries(attrs)));
        return attrs;
      }
    }
    return undefined;
  }

  getFqName(): string {
    if (this.fqName == undefined) {
      this.fqName = makeFqName(this.moduleName, this.name);
    }
    return this.fqName;
  }

  markAsFlowExecutor(): AgentInstance {
    this.type = 'flow-exec';
    return this;
  }

  getScratchNames(): Set<string> | undefined {
    return AgentScratchNames.get(this.getFqName());
  }

  maybeAddScratchData(env: Environment): AgentInstance {
    const scratchNames = this.getScratchNames();
    let data: any = undefined;
    try {
      if (scratchNames != undefined && scratchNames.size > 0) {
        const r: Instance | Instance[] = env.getLastResult();
        if (r instanceof Array) {
          data = r.map((inst: Instance) => {
            return extractScratchData(scratchNames, inst);
          });
        } else {
          data = extractScratchData(scratchNames, r);
        }
        if (data) env.addToScratchPad(this.name, data);
      }
    } catch (reason: any) {
      logger.error(`Failed to update scratchpad for agent ${this.name} - ${reason}`);
    }
    return this;
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
    const sess: Instance | null = this.withSession ? await findAgentChatSession(chatId, env) : null;
    let msgs: BaseMessage[] | undefined;
    if (sess) {
      msgs = sess.lookup('messages');
    } else {
      msgs = [systemMessage(this.getFullInstructions() || '')];
    }
    if (msgs) {
      try {
        const sysMsg = msgs[0];
        if (isplnr || isflow) {
          const s = isplnr ? PlannerInstructions : FlowExecInstructions;
          const newSysMsg = systemMessage(
            `${s}\n${this.toolsAsString()}\n${this.getFullInstructions()}`
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

function extractScratchData(scratchNames: Set<string>, inst: Instance): any {
  const data: any = {};
  inst.attributes.forEach((v: any, k: string) => {
    if (scratchNames.has(k)) {
      data[k] = v;
    }
  });
  return data;
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
