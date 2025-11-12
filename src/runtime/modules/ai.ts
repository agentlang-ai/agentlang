import {
  escapeSpecialChars,
  isFqName,
  isString,
  makeCoreModuleName,
  makeFqName,
  nameToPath,
  sleepMilliseconds,
  splitFqName,
} from '../util.js';
import {
  Environment,
  GlobalEnvironment,
  makeEventEvaluator,
  parseAndEvaluateStatement,
} from '../interpreter.js';
import {
  asJSONSchema,
  Decision,
  fetchModule,
  getDecision,
  Instance,
  instanceToObject,
  isAgent,
  isInstanceOfType,
  isModule,
  makeInstance,
  newInstanceAttributes,
  Record,
  Retry,
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
import {
  AgentCondition,
  AgentGlossaryEntry,
  AgentScenario,
  DecisionAgentInstructions,
  FlowExecInstructions,
  getAgentDirectives,
  getAgentGlossary,
  getAgentResponseSchema,
  getAgentScenarios,
  getAgentScratchNames,
  PlannerInstructions,
} from '../agents/common.js';
import { PathAttributeNameQuery } from '../defs.js';
import { logger } from '../logger.js';
import { FlowStep } from '../agents/flows.js';
import Handlebars from 'handlebars';
import { Statement } from '../../language/generated/ast.js';
import { isMonitoringEnabled } from '../state.js';

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
    validate String @optional,
    retry String @optional,
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
  moduleName: string = CoreAIModuleName;
  instruction: string = '';
  type: string = 'chat';
  tools: string | undefined;
  documents: string | undefined;
  channels: string | undefined;
  runWorkflows: boolean = true;
  role: string | undefined;
  flows: string | undefined;
  validate: string | undefined;
  retry: string | undefined;
  private toolsArray: string[] | undefined = undefined;
  private hasModuleTools = false;
  private withSession = true;
  private fqName: string | undefined;
  private decisionExecutor = false;
  private retryObj: Retry | undefined;

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
          const parts = nameToPath(n);
          agent.hasModuleTools = isModule(parts.getModuleName());
        } else {
          agent.hasModuleTools = isModule(n);
        }
        if (agent.hasModuleTools) break;
      }
    }
    if (agent.retry) {
      let n = agent.retry;
      if (!isFqName(n)) {
        n = `${agent.moduleName}/${n}`;
      }
      const parts = splitFqName(n);
      const m = fetchModule(parts[0]);
      agent.retryObj = m.getRetry(parts[1]);
    }
    return agent;
  }

  static FromFlowStep(step: FlowStep, flowAgent: AgentInstance, context: string): AgentInstance {
    const desc = getDecision(step, flowAgent.moduleName);
    if (desc) {
      return AgentInstance.FromDecision(desc, flowAgent, context);
    }
    const fqs = isFqName(step) ? step : `${flowAgent.moduleName}/${step}`;
    const isagent = isAgent(fqs);
    const i0 = `Analyse the context and generate the pattern required to invoke ${fqs}.
    Never include references in the pattern. All attribute values must be literals derived from the context.`;
    const instruction = isagent
      ? `${i0} ${fqs} is an agent, so generate the message as a text instruction, if possible.`
      : i0;
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
    return AgentInstance.FromInstance(inst).disableSession();
  }

  static FromDecision(desc: Decision, flowAgent: AgentInstance, context: string): AgentInstance {
    const instruction = `${DecisionAgentInstructions}\n${context}\n\n${desc.joinedCases()}`;
    const inst = makeInstance(
      CoreAIModuleName,
      AgentEntityName,
      newInstanceAttributes()
        .set('llm', flowAgent.llm)
        .set('name', `${desc.name}_agent`)
        .set('moduleName', flowAgent.moduleName)
        .set('instruction', instruction)
    );
    return AgentInstance.FromInstance(inst).disableSession().markAsDecisionExecutor();
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

  markAsDecisionExecutor(): AgentInstance {
    this.decisionExecutor = true;
    return this;
  }

  isDecisionExecutor(): boolean {
    return this.decisionExecutor;
  }

  private directivesAsString(fqName: string): string {
    const conds = getAgentDirectives(fqName);
    if (conds) {
      const ss = new Array<string>();
      ss.push(
        '\nUse the following guidelines to take more accurate decisions in relevant scenarios.\n'
      );
      conds.forEach((ac: AgentCondition) => {
        if (ac.ifPattern) {
          ss.push(ac.if);
        } else {
          ss.push(`if ${ac.if}, then ${ac.then}`);
        }
      });
      return `${ss.join('\n')}\n`;
    }
    return '';
  }

  private getFullInstructions(env: Environment): string {
    const fqName = this.getFqName();
    const ins = this.role ? `${this.role}\n${this.instruction || ''}` : this.instruction || '';
    let finalInstruction = `${ins} ${this.directivesAsString(fqName)}`;
    const gls = getAgentGlossary(fqName);
    if (gls) {
      const glss = new Array<string>();
      gls.forEach((age: AgentGlossaryEntry) => {
        glss.push(
          `${age.name}: ${age.meaning}. ${age.synonyms ? `These words are synonyms for ${age.name}: ${age.synonyms}` : ''}`
        );
      });
      finalInstruction = `${finalInstruction}\nThe following glossary will be helpful for understanding user requests.
      ${glss.join('\n')}\n`;
    }
    const scenarios = getAgentScenarios(fqName);
    if (scenarios) {
      const scs = new Array<string>();
      scenarios.forEach((sc: AgentScenario) => {
        try {
          const aiResp = processScenarioResponse(sc.ai);
          scs.push(`User: ${sc.user}\nAI: ${aiResp}\n`);
        } catch (error: any) {
          logger.error(`Unable to process scenario ${fqName}: ${error.message}`);
        }
      });
      finalInstruction = `${finalInstruction}\nHere are some example user requests and the corresponding responses you are supposed to produce:\n${scs.join('\n')}`;
    }
    const responseSchema = getAgentResponseSchema(fqName);
    if (responseSchema) {
      finalInstruction = `${finalInstruction}\nReturn your response in the following JSON schema:\n${asJSONSchema(responseSchema)}
Only return a pure JSON object with no extra text, annotations etc.`;
    }
    const spad = env.getScratchPad();
    if (spad !== undefined) {
      if (finalInstruction.indexOf('{{') > 0) {
        return AgentInstance.maybeRewriteTemplatePatterns(spad, finalInstruction);
      } else {
        const ctx = JSON.stringify(spad);
        return `${finalInstruction}\nSome additional context:\n${ctx}`;
      }
    } else {
      return finalInstruction;
    }
  }

  private static maybeRewriteTemplatePatterns(scratchPad: any, instruction: string): string {
    const templ = Handlebars.compile(instruction);
    return templ(scratchPad);
  }

  maybeValidateJsonResponse(response: string | undefined): object | undefined {
    if (response) {
      const responseSchema = getAgentResponseSchema(this.getFqName());
      if (responseSchema) {
        const attrs = JSON.parse(response);
        const parts = nameToPath(responseSchema);
        const moduleName = parts.getModuleName();
        const entryName = parts.getEntryName();
        const attrsMap = new Map(Object.entries(attrs));
        const scm = fetchModule(moduleName).getRecord(entryName).schema;
        const recAttrs = new Map<string, any>();
        attrsMap.forEach((v: any, k: string) => {
          if (scm.has(k)) {
            recAttrs.set(k, v);
          }
        });
        makeInstance(moduleName, entryName, recAttrs);
        return attrs;
      }
    }
    return undefined;
  }

  getFqName(): string {
    if (this.fqName === undefined) {
      this.fqName = makeFqName(this.moduleName, this.name);
    }
    return this.fqName;
  }

  markAsFlowExecutor(): AgentInstance {
    this.type = 'flow-exec';
    return this;
  }

  getScratchNames(): Set<string> | undefined {
    return getAgentScratchNames(this.getFqName());
  }

  maybeAddScratchData(env: Environment): AgentInstance {
    const obj: any = env.getLastResult();
    if (obj === null || obj === undefined) return this;
    let r: Instance | Instance[] | undefined = undefined;
    if (
      obj instanceof Instance ||
      (obj instanceof Array && obj.length > 0 && obj[0] instanceof Instance)
    ) {
      r = obj;
    } else {
      env.addToScratchPad(this.name, obj);
      return this;
    }
    const scratchNames = this.getScratchNames();
    let data: any = undefined;
    let n = '';
    if (r instanceof Array) {
      data = r.map((inst: Instance) => {
        return extractScratchData(scratchNames, inst);
      });
      n = r[0].getFqName();
    } else {
      data = extractScratchData(scratchNames, r);
      n = r.getFqName();
    }
    if (data) env.addToScratchPad(n, data);
    return this;
  }

  async invoke(message: string, env: Environment) {
    const p = await findProviderForLLM(this.llm, env);
    const agentName = this.name;
    const chatId = env.getAgentChatId() || agentName;
    let isplnr = this.isPlanner();
    const isflow = !isplnr && this.isFlowExecutor();
    if (isplnr && this.withSession) {
      this.withSession = false;
    }
    if (isflow) {
      this.withSession = false;
    }
    if (!this.withSession && env.isAgentModeSet()) {
      this.withSession = true;
      if (env.isInAgentChatMode()) {
        isplnr = false;
      }
    }
    const monitoringEnabled = isMonitoringEnabled();
    const sess: Instance | null = this.withSession ? await findAgentChatSession(chatId, env) : null;
    let msgs: BaseMessage[] | undefined;
    let cachedMsg: string | undefined = undefined;
    if (sess) {
      msgs = sess.lookup('messages');
    } else {
      cachedMsg = this.getFullInstructions(env);
      msgs = [systemMessage(cachedMsg || '')];
    }
    if (msgs) {
      try {
        const sysMsg = msgs[0];
        if (isplnr || isflow) {
          const s = isplnr ? PlannerInstructions : FlowExecInstructions;
          const ts = this.toolsAsString();
          const msg = `${s}\n${ts}\n${cachedMsg || this.getFullInstructions(env)}`;
          const newSysMsg = systemMessage(msg);
          msgs[0] = newSysMsg;
        }
        msgs.push(humanMessage(await this.maybeAddRelevantDocuments(message, env)));
        const externalToolSpecs = this.getExternalToolSpecs();
        const msgsContent = msgs
          .slice(1)
          .map((bm: BaseMessage) => {
            return bm.content;
          })
          .join('\n');
        if (monitoringEnabled) {
          env.setMonitorEntryLlmPrompt(msgsContent);
          if (this.isPlanner()) {
            env.flagMonitorEntryAsPlanner();
          }
          if (this.isFlowExecutor()) {
            env.flagMonitorEntryAsFlowStep();
          }
          if (this.isDecisionExecutor()) {
            env.flagMonitorEntryAsDecision();
          }
        }
        logger.debug(
          `Invoking LLM ${this.llm} via agent ${this.fqName} with messages:\n${msgsContent}`
        );
        let response: AIResponse = await p.invoke(msgs, externalToolSpecs);
        const v = this.getValidationEvent();
        if (v) {
          response = await this.handleValidation(response, v, msgs, p);
        }
        msgs.push(assistantMessage(response.content));
        if (isplnr) {
          msgs[0] = sysMsg;
        }
        if (this.withSession) {
          await saveAgentChatSession(chatId, msgs, env);
        }
        if (monitoringEnabled) env.setMonitorEntryLlmResponse(response.content);
        env.setLastResult(response.content);
      } catch (err: any) {
        logger.error(`Error while invoking ${agentName} - ${err}`);
        if (monitoringEnabled) env.setMonitorEntryError(`${err}`);
        env.setLastResult(undefined);
      }
    } else {
      throw new Error(`failed to initialize messages for agent ${agentName}`);
    }
  }

  private async invokeValidator(
    response: AIResponse,
    validationEventName: string
  ): Promise<Instance> {
    let isstr = true;
    try {
      const c = JSON.parse(response.content);
      isstr = isString(c);
    } catch (reason: any) {
      logger.debug(`invokeValidator json/parse - ${reason}`);
    }
    const d = isstr ? `"${escapeSpecialChars(response.content)}"` : response.content;
    const r: Instance | Instance[] = await parseAndEvaluateStatement(
      `{${validationEventName} {data ${d}}}`
    );
    if (r instanceof Array) {
      const i = r.find((inst: Instance) => {
        return isInstanceOfType(inst, 'agentlang/ValidationResult');
      });
      if (i) {
        return i;
      } else {
        throw new Error('Validation failed to produce result');
      }
    } else {
      if (!isInstanceOfType(r, 'agentlang/ValidationResult')) {
        throw new Error('Invalid validation result');
      }
      return r;
    }
  }

  private async handleValidation(
    response: AIResponse,
    validationEventName: string,
    msgs: BaseMessage[],
    provider: AgentServiceProvider
  ): Promise<AIResponse> {
    let r: Instance = await this.invokeValidator(response, validationEventName);
    const status = r.lookup('status');
    if (status === 'ok') {
      return response;
    } else {
      if (this.retryObj) {
        let resp = response;
        let attempt = 0;
        let delay = this.retryObj.getNextDelayMs(attempt);
        while (delay) {
          msgs.push(assistantMessage(resp.content));
          const vs = JSON.stringify(r.asSerializableObject());
          msgs.push(
            humanMessage(
              `Validation for your last response failed with this result: \n${vs}\n\nFix the errors.`
            )
          );
          await sleepMilliseconds(delay);
          resp = await provider.invoke(msgs, undefined);
          r = await this.invokeValidator(resp, validationEventName);
          if (r.lookup('status') === 'ok') {
            return resp;
          }
          delay = this.retryObj.getNextDelayMs(++attempt);
        }
        throw new Error(
          `Agent ${this.name} failed to generate a valid response after ${attempt} attempts`
        );
      } else {
        return response;
      }
    }
  }

  private getValidationEvent(): string | undefined {
    if (this.validate) {
      if (isFqName(this.validate)) {
        return this.validate;
      } else {
        return `${this.moduleName}/${this.validate}`;
      }
    }
    return undefined;
  }

  private getExternalToolSpecs(): any[] | undefined {
    let result: any[] | undefined = undefined;
    if (this.toolsArray) {
      this.toolsArray.forEach((n: string) => {
        const v = GlobalEnvironment.lookup(n);
        if (v) {
          if (result === undefined) {
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
          const parts = nameToPath(n);
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
            const entry = m.getEntry(entryName);
            const s =
              entry instanceof Record ? (entry as Record).toString_(true) : entry.toString();
            defs?.push(s);
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

function extractScratchData(scratchNames: Set<string> | undefined, inst: Instance): any {
  const data: any = {};
  inst.attributes.forEach((v: any, k: string) => {
    if (scratchNames) {
      if (scratchNames.has(k)) {
        data[k] = v;
      }
    } else {
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
  if (p === undefined) {
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

function processScenarioResponse(resp: string): string {
  const r = resp.trimStart();
  if (r.startsWith('[') || r.startsWith('{')) {
    return resp;
  }
  if (isFqName(r)) {
    const parts = splitFqName(r);
    const m = fetchModule(parts[0]);
    const wf = m.getWorkflowForEvent(parts[1]);
    if (wf) {
      const ss = wf.statements.map((stmt: Statement) => {
        return stmt.$cstNode?.text;
      });
      return `[${ss.join(';\n')}]`;
    } else {
      return resp;
    }
  }
  return resp;
}

export function trimGeneratedCode(code: string | undefined): string {
  if (code !== undefined) {
    let s = code.trim();
    if (s.startsWith('```')) {
      const idx = s.indexOf('\n');
      s = s.substring(idx).trimStart();
    }
    if (s.endsWith('```')) {
      s = s.substring(0, s.length - 3);
    }
    return s;
  } else {
    return '';
  }
}
