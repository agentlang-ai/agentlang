import {
  escapeSpecialChars,
  isFqName,
  isString,
  makeCoreModuleName,
  makeFqName,
  nameToPath,
  restoreSpecialChars,
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
  AgentEvaluator,
  asJSONSchema,
  Decision,
  fetchModule,
  getDecision,
  getGlobalRetry,
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
import { getRemoteAgent, invokeRemoteAgentWithMessage, provider } from '../agents/registry.js';
import {
  AgentServiceProvider,
  AIResponse,
  assistantMessage,
  humanMessage,
  systemMessage,
} from '../agents/provider.js';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  AgentCondition,
  AgentGlossaryEntry,
  AgentScenario,
  AgentSummary as AgentLearningResult,
  DecisionAgentInstructions,
  EvalInstructions,
  FlowExecInstructions,
  getAgentDirectives,
  getAgentGlossary,
  getAgentResponseSchema,
  getAgentScenarios,
  getAgentScratchNames,
  LearningAgentInstructions as LearnerAgentInstructions,
  newAgentDirective,
  newAgentGlossaryEntry,
  newAgentScenario,
  PlannerInstructions,
} from '../agents/common.js';
import { PathAttributeNameQuery } from '../defs.js';
import { logger } from '../logger.js';
import { FlowStep } from '../agents/flows.js';
import Handlebars from 'handlebars';
import { Statement } from '../../language/generated/ast.js';
import { isMonitoringEnabled, TtlCache } from '../state.js';

export const CoreAIModuleName = makeCoreModuleName('ai');
export const AgentEntityName = 'Agent';
export const LlmEntityName = 'LLM';
export const AgentLearnerType = 'learner';

const AgentEvalType = 'eval';

export default `module ${CoreAIModuleName}

import "./modules/ai.js" @as ai

entity ${LlmEntityName} {
    name String @id,
    service String @default("openai"),
    config Map @optional
}

entity ${AgentEntityName} {
    name String @id,
    moduleName String @default("${CoreAIModuleName}"),
    type @enum("chat", "planner", "flow-exec", "${AgentEvalType}", "${AgentLearnerType}") @default("chat"),
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

entity Directive {
  id UUID @id @default(uuid()),
  agentFqName String @indexed,
  condition String,
  consequent String
}

entity Scenario {
  id UUID @id @default(uuid()),
  agentFqName String @indexed,
  user String,
  ai String
}

entity GlossaryEntry {
   id UUID @id @default(uuid()),
   agentFqName String @indexed,
   name String,
   meaning String,
   synonyms String @optional
}

entity EvaluationResult {
  id UUID @id @default(uuid()),
  agentFqName String @indexed,
  userRequest String,
  score Int,
  summary String
}

entity AgentLearningResult {
   id UUID @id @default(uuid()),
   agentFqName String @indexed,
   data String,
   summary String
}

@public event agentLearning{
    agentName String,
    agentModuleName String,
    instruction String
}

workflow agentLearning {
    await ai.processAgentLearning(agentLearning.agentModuleName, agentLearning.agentName, agentLearning.instruction)
}
`;

enum AgentCacheType {
  DIRECTIVE,
  GLOSSARY,
  SCENARIO,
  SUMMARY,
}

type AgentInstructionActivator = {
  provider: AgentServiceProvider;
  userMessage: string;
  agentInstruction: string;
  agentRole: string | undefined;
};

const MAX_USER_DEFINED_GLOSSARY = 20;
const MAX_USER_DEFINED_DIRECTIVES = 20;
const MAX_USER_DEFINED_SCENARIOS = 5;
const MAX_USER_DEFINED_SUMMARIES = 5;

async function activatedUserDefinedAgentLearnings<T>(
  objLabel: string,
  learningObjects: T[],
  activator: AgentInstructionActivator,
  maxResults: number
): Promise<T[]> {
  const msg = `Consider the following ${objLabel} (in JSON format):
  ${JSON.stringify(learningObjects)}

  Return the indices of the ${objLabel} relevant for the following text:

  ${activator.userMessage}

  Return the relevant indices and a JSON array of integers with the index starting at zero (0). Do not return any additional comments
  or text.
  `;
  const msgs = new Array<BaseMessage>();
  msgs.push(
    new SystemMessage(
      'You are an agent that filters a JSON array and return relevant indices as a JSON array of integers.'
    )
  );
  msgs.push(new HumanMessage(msg));
  const response: AIResponse = await activator.provider.invoke(msgs, undefined);
  const indices: number[] = JSON.parse(normalizeGeneratedCode(response.content));
  if (indices.length == 0 || indices.length == learningObjects.length) return learningObjects;
  const result = new Array<T>();
  for (let i = 0; i < indices.length; ++i) {
    if (i >= maxResults) break;
    result.push(learningObjects[indices[i]]);
  }
  return result;
}

async function activatedUserDefinedAgentGlossary(
  gls: AgentGlossaryEntry[],
  activator: AgentInstructionActivator
): Promise<AgentGlossaryEntry[]> {
  return await activatedUserDefinedAgentLearnings<AgentGlossaryEntry>(
    'glossary entries',
    gls,
    activator,
    MAX_USER_DEFINED_GLOSSARY
  );
}

async function activatedUserDefinedAgentScenarios(
  scns: AgentScenario[],
  activator: AgentInstructionActivator
): Promise<AgentScenario[]> {
  return await activatedUserDefinedAgentLearnings<AgentScenario>(
    'scenarios',
    scns,
    activator,
    MAX_USER_DEFINED_SCENARIOS
  );
}

async function activatedUserDefinedAgentDirectives(
  dirs: AgentCondition[],
  activator: AgentInstructionActivator
): Promise<AgentCondition[]> {
  return await activatedUserDefinedAgentLearnings<AgentCondition>(
    'directives or conditions',
    dirs,
    activator,
    MAX_USER_DEFINED_DIRECTIVES
  );
}

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
  private addContext = false;
  private remoteAgentSpec: any = undefined;

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
        agent.retryObj = getGlobalRetry(n);
        if (agent.retryObj === undefined) {
          n = `${agent.moduleName}/${n}`;
        }
      }
      if (agent.retryObj === undefined) {
        const parts = splitFqName(n);
        const m = fetchModule(parts[0]);
        agent.retryObj = m.getRetry(parts[1]);
      }
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

  static FromRemoteAgentSpec(
    name: string,
    moduleName: string,
    remoteAgentSpec: any
  ): AgentInstance {
    const result = new AgentInstance();
    result.name = name;
    result.moduleName = moduleName;
    result.remoteAgentSpec = remoteAgentSpec;
    return result;
  }

  isRemoteAgent(): boolean {
    return this.remoteAgentSpec !== undefined;
  }

  swapInstruction(newIns: string): string {
    const s = this.instruction;
    this.instruction = newIns;
    return s;
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

  isLearner(): boolean {
    return this.type === 'learner';
  }

  isFlowExecutor(): boolean {
    return this.type == 'flow-exec';
  }

  isEvaluator(): boolean {
    return this.type == AgentEvalType;
  }

  markAsDecisionExecutor(): AgentInstance {
    this.decisionExecutor = true;
    return this;
  }

  isDecisionExecutor(): boolean {
    return this.decisionExecutor;
  }

  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 mins
  private static DirectivesCache = new TtlCache<AgentCondition[]>(AgentInstance.CACHE_TTL_MS);

  private async getUserDefinedAgentDirectives(fqName: string): Promise<AgentCondition[]> {
    const cached = AgentInstance.DirectivesCache.get(fqName);
    if (cached !== undefined) return cached;
    const result: Instance[] = await parseAndEvaluateStatement(
      `{${CoreAIModuleName}/Directive {agentFqName? "${fqName}"}}`
    );
    let r: AgentCondition[] = [];
    if (result && result.length > 0) {
      r = result.map((inst: Instance) => {
        return newAgentDirective(
          restoreSpecialChars(inst.lookup('condition')),
          restoreSpecialChars(inst.lookup('consequent'))
        );
      });
    }
    return AgentInstance.DirectivesCache.set(fqName, r);
  }

  private async directivesAsString(
    fqName: string,
    activator: AgentInstructionActivator
  ): Promise<string> {
    let userDirs = await this.getUserDefinedAgentDirectives(fqName);
    if (userDirs.length > MAX_USER_DEFINED_DIRECTIVES)
      userDirs = await activatedUserDefinedAgentDirectives(userDirs, activator);
    const dirs = getAgentDirectives(fqName) || [];
    const conds = dirs.concat(userDirs);
    if (conds.length > 0) {
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

  private static GlossaryCache = new TtlCache<AgentGlossaryEntry[]>(AgentInstance.CACHE_TTL_MS);

  private async getUserDefinedAgentGlossary(fqName: string): Promise<AgentGlossaryEntry[]> {
    const cached = AgentInstance.GlossaryCache.get(fqName);
    if (cached !== undefined) return cached;
    const result: Instance[] = await parseAndEvaluateStatement(
      `{${CoreAIModuleName}/GlossaryEntry {agentFqName? "${fqName}"}}`
    );
    let r: AgentGlossaryEntry[] = [];
    if (result && result.length > 0) {
      r = result.map((inst: Instance) => {
        return newAgentGlossaryEntry(
          inst.lookup('name'),
          restoreSpecialChars(inst.lookup('meaning')),
          inst.lookup('synonyms')
        );
      });
    }
    return AgentInstance.GlossaryCache.set(fqName, r);
  }

  private static SummariesCache = new TtlCache<AgentLearningResult[]>(AgentInstance.CACHE_TTL_MS);

  private async getUserDefinedAgentLearningResults(fqName: string): Promise<AgentLearningResult[]> {
    const cached = AgentInstance.SummariesCache.get(fqName);
    if (cached !== undefined) return cached;
    const result: Instance[] = await parseAndEvaluateStatement(
      `{${CoreAIModuleName}/AgentLearningResult {agentFqName? "${fqName}"}}`
    );
    let r: AgentLearningResult[] = [];
    if (result && result.length > 0) {
      r = result.map((inst: Instance) => {
        return { data: inst.lookup('data'), summary: inst.lookup('summary') };
      });
    }
    return AgentInstance.SummariesCache.set(fqName, r);
  }

  private static ScenariosCache = new TtlCache<AgentScenario[]>(AgentInstance.CACHE_TTL_MS);

  private async getUserDefinedAgentScenarios(fqName: string): Promise<AgentScenario[]> {
    const cached = AgentInstance.ScenariosCache.get(fqName);
    if (cached !== undefined) return cached;
    const result: Instance[] = await parseAndEvaluateStatement(
      `{${CoreAIModuleName}/Scenario {agentFqName? "${fqName}"}}`
    );
    let r: AgentScenario[] = [];
    if (result && result.length > 0) {
      r = result.map((inst: Instance) => {
        return newAgentScenario(inst.lookup('user'), inst.lookup('ai'));
      });
    }
    return AgentInstance.ScenariosCache.set(fqName, r);
  }

  public static ResetCache(fqName: string, type: AgentCacheType) {
    switch (type) {
      case AgentCacheType.DIRECTIVE:
        AgentInstance.DirectivesCache.delete(fqName);
        break;
      case AgentCacheType.GLOSSARY:
        AgentInstance.GlossaryCache.delete(fqName);
        break;
      case AgentCacheType.SCENARIO:
        AgentInstance.ScenariosCache.delete(fqName);
        break;
      case AgentCacheType.SUMMARY:
        AgentInstance.SummariesCache.delete(fqName);
        break;
    }
  }

  private async getFullInstructions(
    env: Environment,
    activator: AgentInstructionActivator
  ): Promise<string> {
    const fqName = this.getFqName();
    const ins = this.role ? `${this.role}\n${this.instruction || ''}` : this.instruction || '';
    let finalInstruction = `${ins} ${await this.directivesAsString(fqName, activator)}`;
    const staticGls = getAgentGlossary(fqName) || [];
    let userGls = await this.getUserDefinedAgentGlossary(fqName);
    if (userGls.length > MAX_USER_DEFINED_GLOSSARY)
      userGls = await activatedUserDefinedAgentGlossary(userGls, activator);
    const gls = staticGls.concat(userGls);
    if (gls.length > 0) {
      const glss = new Array<string>();
      gls.forEach((age: AgentGlossaryEntry) => {
        glss.push(
          `${age.name}: ${age.meaning}. ${age.synonyms ? `These words are synonyms for ${age.name}: ${age.synonyms}` : ''}`
        );
      });
      finalInstruction = `${finalInstruction}\nThe following glossary will be helpful for understanding user requests.
      ${glss.join('\n')}\n`;
    }
    const staticScns = getAgentScenarios(fqName) || [];
    let userScns = await this.getUserDefinedAgentScenarios(fqName);
    if (userScns.length > MAX_USER_DEFINED_SCENARIOS)
      userScns = await activatedUserDefinedAgentScenarios(userScns, activator);
    const scenarios = staticScns.concat(userScns);
    if (scenarios.length > 0) {
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
    const summaries = await this.getUserDefinedAgentLearningResults(fqName);
    if (summaries.length > 0) {
      let s: string[] = summaries.map((sa: AgentLearningResult) => {
        return restoreSpecialChars(sa.summary);
      });
      if (s.length > MAX_USER_DEFINED_SUMMARIES)
        s = await activatedUserDefinedAgentLearnings<string>(
          'summaries',
          s,
          activator,
          MAX_USER_DEFINED_SUMMARIES
        );
      finalInstruction = `${finalInstruction}\nAlso keep in mind the following points:\n\n${s.join('\n')}\n\n`;
    }
    const responseSchema = getAgentResponseSchema(fqName);
    if (responseSchema) {
      finalInstruction = `${finalInstruction}\nReturn your response in the following JSON schema:\n${asJSONSchema(responseSchema)}
Only return a pure JSON object with no extra text, annotations etc.`;
    }
    const spad = env.getScratchPad();
    if (spad !== undefined) {
      if (finalInstruction.indexOf('{{') > 0) {
        return AgentInstance.maybeRewriteTemplatePatterns(spad, finalInstruction, env);
      } else {
        const ctx = JSON.stringify(spad);
        return `${finalInstruction}\nSome additional context:\n${ctx}`;
      }
    } else {
      this.addContext = true;
      return finalInstruction;
    }
  }

  private static maybeRewriteTemplatePatterns(
    scratchPad: any,
    instruction: string,
    env: Environment
  ): string {
    const templ = Handlebars.compile(env.rewriteTemplateMappings(instruction));
    return templ(scratchPad);
  }

  maybeValidateJsonResponse(response: string | undefined): object | undefined {
    if (response) {
      const responseSchema = getAgentResponseSchema(this.getFqName());
      if (responseSchema) {
        const attrs = JSON.parse(normalizeGeneratedCode(response));
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
      Instance.IsInstance(obj) ||
      (obj instanceof Array && obj.length > 0 && Instance.IsInstance(obj[0]))
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
      const i = r as Instance;
      data = extractScratchData(scratchNames, i);
      n = i.getFqName();
    }
    if (data) env.addToScratchPad(n, data);
    return this;
  }

  private static AgentEvaluators = new Map<string, AgentInstance>();

  public static RegisterEvaluator(e: AgentEvaluator): AgentInstance {
    const n = e.normalizedName();
    const agentFqName = isFqName(n) ? n : makeFqName(e.moduleName, n);
    const instruction = e.instruction;
    let llm = e.llm;
    const [agentModule, agentName] = splitFqName(agentFqName);
    if (llm === undefined) llm = `${agentName}_llm`;
    const inst = makeInstance(
      CoreAIModuleName,
      AgentEntityName,
      newInstanceAttributes()
        .set('llm', llm)
        .set('name', agentName)
        .set('moduleName', agentModule)
        .set(
          'instruction',
          instruction || 'You are an agent that evaluates the performance of another agent.'
        )
        .set('type', AgentEvalType)
    );
    const einst = AgentInstance.FromInstance(inst).disableSession();
    this.AgentEvaluators.set(agentFqName, einst);
    return einst;
  }

  private static async maybeEvaluateResponse(
    agent: AgentInstance,
    userRequest: string,
    fullRequest: string,
    response: string,
    env: Environment
  ): Promise<void> {
    const fqn = agent.getFqName();
    const e: AgentInstance | undefined = AgentInstance.AgentEvaluators.get(fqn);
    if (e !== undefined) {
      await e.invoke(
        JSON.stringify({ requestToAgent: fullRequest, responseFromAgent: response }),
        env
      );
      try {
        const r = JSON.parse(normalizeGeneratedCode(env.getLastResult()));
        const score = r.score;
        if (score === undefined || score === null) {
          logger.warn(`Evaluation for agent ${fqn} failed to generate a valid score`);
        } else {
          await parseAndEvaluateStatement(`{${CoreAIModuleName}/EvaluationResult {
              agentFqName "${fqn}",
              userRequest "${escapeSpecialChars(userRequest)}",
              score ${score},
              summary "${escapeSpecialChars(r.summary)}"
          }}`);
        }
      } catch (reason: any) {
        logger.warn(`Failed to save evaluation for agent ${fqn} - ${reason}`);
      }
    }
  }

  async invoke(message: string, env: Environment) {
    if (this.isRemoteAgent()) {
      env.setLastResult(invokeRemoteAgentWithMessage(this.remoteAgentSpec, message));
      return;
    }
    const p = await findProviderForLLM(this.llm, env);
    const agentName = this.name;
    const chatId = env.getAgentChatId() || agentName;
    let isplnr = this.isPlanner();
    const isflow = !isplnr && this.isFlowExecutor();
    const iseval = !isplnr && !isflow && this.isEvaluator();
    const islearner = !isflow && !isplnr && !iseval && this.isLearner();
    if ((isplnr || islearner || iseval) && this.withSession) {
      this.withSession = false;
    }
    if (isflow || islearner) {
      this.withSession = false;
    }
    if (this.withSession && env.getFlowContext()) {
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
    const activator: AgentInstructionActivator = {
      provider: p,
      userMessage: message,
      agentInstruction: this.instruction,
      agentRole: this.role,
    };
    if (sess) {
      msgs = sess.lookup('messages');
    } else {
      cachedMsg = await this.getFullInstructions(env, activator);
      msgs = [systemMessage(cachedMsg || '')];
    }
    if (msgs) {
      try {
        const sysMsg = msgs[0];
        if (isplnr || isflow || iseval || islearner) {
          const s = isplnr
            ? PlannerInstructions
            : isflow
              ? FlowExecInstructions
              : iseval
                ? EvalInstructions
                : LearnerAgentInstructions;
          const ts = this.toolsAsString();
          const msg = `${s}\n${ts}\n${cachedMsg || (await this.getFullInstructions(env, activator))}`;
          const newSysMsg = systemMessage(msg);
          msgs[0] = newSysMsg;
        }
        const hmsg = await this.maybeAddRelevantDocuments(
          this.maybeAddFlowContext(message, env),
          env
        );
        if (hmsg.length > 0) {
          msgs.push(humanMessage(hmsg));
        }
        const externalToolSpecs = this.getExternalToolSpecs();
        const msgsContent = msgs
          //.slice(1)
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
        if (!iseval)
          await AgentInstance.maybeEvaluateResponse(
            this,
            message,
            msgsContent,
            response.content,
            env
          );
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

  private maybeAddFlowContext(message: string, env: Environment): string {
    if (this.addContext) {
      this.addContext = false;
      const fctx = env.getFlowContext();
      if (fctx) {
        return `${message}\nContext: ${fctx}`;
      }
      return message;
    }
    return message;
  }

  private async invokeValidator(
    response: AIResponse,
    validationEventName: string
  ): Promise<Instance> {
    let isstr = true;
    const content = normalizeGeneratedCode(response.content);
    try {
      const c = JSON.parse(content);
      isstr = isString(c);
    } catch (reason: any) {
      logger.debug(`invokeValidator json/parse - ${reason}`);
    }
    const d = isstr ? `"${escapeSpecialChars(content)}"` : content;
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
              entry instanceof Record ? (entry as Record).toString_(true, true) : entry.toString();
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

export async function findAgentByName(
  name: string,
  moduleName: string | undefined,
  env: Environment
): Promise<AgentInstance> {
  if (moduleName) {
    const remoteAgentSpec = getRemoteAgent(makeFqName(moduleName, name));
    if (remoteAgentSpec) {
      return AgentInstance.FromRemoteAgentSpec(name, moduleName, remoteAgentSpec);
    }
  }
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

export function normalizeGeneratedCode(code: string | undefined): string {
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

async function parseAndInternAgentLearning(
  moduleName: string,
  agentName: string,
  learning: string,
  env: Environment
) {
  const obj = JSON.parse(normalizeGeneratedCode(learning));
  const fqName = makeFqName(moduleName, agentName);
  if (obj.decisions) {
    for (let j = 0; j < obj.decisions.length; ++j) {
      const conds: any[] = obj.decisions[j].conditions;
      if (conds && conds.length > 0) {
        AgentInstance.ResetCache(fqName, AgentCacheType.DIRECTIVE);
        for (let i = 0; i < conds.length; ++i) {
          const entry: any = conds[i];
          const cond: string = entry.if;
          const conseq: string = entry.then;
          if (cond && conseq) {
            await parseAndEvaluateStatement(
              `{${CoreAIModuleName}/Directive {
  agentFqName "${fqName}",
  condition "${escapeSpecialChars(cond)}",
  consequent "${escapeSpecialChars(conseq)}"}}`,
              env.getActiveUser(),
              env
            );
          } else {
            throw new Error(`Invalid directive generated - missing 'if' or 'then' in ${learning}`);
          }
        }
      }
    }
  }
  if (obj.glossary) {
    AgentInstance.ResetCache(fqName, AgentCacheType.GLOSSARY);
    for (let i = 0; i < obj.glossary.length; ++i) {
      const word = obj.glossary[i].word;
      const meaning = obj.glossary[i].meaning;
      if (word && meaning) {
        await parseAndEvaluateStatement(
          `{${CoreAIModuleName}/GlossaryEntry {
  agentFqName "${fqName}",
  name "${word}",
  meaning "${escapeSpecialChars(meaning)}"}}`,
          env.getActiveUser(),
          env
        );
      }
    }
  }
  if (obj.scenarios) {
    AgentInstance.ResetCache(fqName, AgentCacheType.SCENARIO);
    for (let i = 0; i < obj.scenarios.length; ++i) {
      const user = obj.scenarios[i].user;
      const ai = obj.scenarios[i].ai;
      if (user && ai) {
        await parseAndEvaluateStatement(
          `{${CoreAIModuleName}/Scenario {
  agentFqName "${fqName}",
  user "${escapeSpecialChars(user)}",
  ai "${escapeSpecialChars(ai)}"}}`,
          env.getActiveUser(),
          env
        );
      }
    }
  }
  AgentInstance.ResetCache(fqName, AgentCacheType.SUMMARY);
  const summary = obj.summary;
  delete obj.summary;
  await parseAndEvaluateStatement(
    `{${CoreAIModuleName}/AgentLearningResult {
  agentFqName "${fqName}",
  data "${escapeSpecialChars(JSON.stringify(obj))}",
  summary "${escapeSpecialChars(summary) || ''}"}}`,
    env.getActiveUser(),
    env
  );
}

export async function processAgentLearning(
  moduleName: string,
  agentName: string,
  instruction: string,
  env: Environment
): Promise<any> {
  const learning = await parseAndEvaluateStatement(
    `{${moduleName}/${agentName}_${AgentLearnerType} {message \`${instruction}\`}}`,
    env.getActiveUser(),
    env
  );
  await parseAndInternAgentLearning(moduleName, agentName, learning, env);
  return { agentLearning: { result: learning } };
}
