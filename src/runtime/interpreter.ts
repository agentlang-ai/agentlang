import {
  ArrayLiteral,
  CrudMap,
  Delete,
  Expr,
  FnCall,
  ForEach,
  FullTextSearch,
  Handler,
  If,
  IfWithAlias,
  isBinExpr,
  isGroup,
  isLiteral,
  isNegExpr,
  isNotExpr,
  isReturn,
  JoinSpec,
  Literal,
  MapKey,
  MapLiteral,
  Pattern,
  Purge,
  RelationshipPattern,
  Return,
  RuntimeHint,
  SelectIntoEntry,
  SelectIntoSpec,
  SetAttribute,
  Statement,
  ThrowError,
  WhereSpec,
} from '../language/generated/ast.js';
import {
  Agent,
  defineAgentEvent,
  Event,
  getOneOfRef,
  getRelationship,
  getWorkflow,
  Instance,
  InstanceAttributes,
  isAgentEventInstance,
  isBetweenRelationship,
  isContainsRelationship,
  isEmptyWorkflow,
  isEntityInstance,
  isEventInstance,
  isInstanceOfType,
  isOneToOneBetweenRelationship,
  isTimer,
  makeInstance,
  maybeInstanceAsString,
  newInstanceAttributes,
  PlaceholderRecordEntry,
  Relationship,
  setMetaAttributes,
  Workflow,
} from './module.js';
import { JoinInfo, Resolver, WhereClause } from './resolvers/interface.js';
import { ResolverAuthInfo } from './resolvers/authinfo.js';
import { SqlDbResolver } from './resolvers/sqldb/impl.js';
import {
  CrudType,
  DefaultModuleName,
  escapeFqName,
  escapeQueryName,
  fqNameFromPath,
  isCoreModule,
  isFqName,
  isPath,
  isString,
  makeCoreModuleName,
  makeFqName,
  nameToPath,
  Path,
  preprocessRawConfig,
  QuerySuffix,
  restoreSpecialChars,
  splitRefs,
} from './util.js';
import { getResolver, getResolverNameForPath } from './resolvers/registry.js';
import {
  ExtractedQueryOptions,
  extractQueryOptions,
  parseStatement,
  parseWorkflow,
} from '../language/parser.js';
import { ActiveSessionInfo, AdminSession, AdminUserId } from './auth/defs.js';
import {
  AgentEntityName,
  AgentFqName,
  AgentInstance,
  findAgentByName,
  normalizeGeneratedCode,
  saveFlowStepResult,
} from './modules/ai.js';
import { logger } from './logger.js';
import {
  FlowSuspensionTag,
  ParentAttributeName,
  PathAttributeName,
  PathAttributeNameQuery,
} from './defs.js';
import {
  addCreateAudit,
  addDeleteAudit,
  addUpdateAudit,
  createSuspension,
  flushMonitoringData,
  triggerTimer,
} from './modules/core.js';
import { getModuleDef, invokeModuleFn } from './jsmodules.js';
import { invokeOpenApiEvent, isOpenApiEventInstance } from './openapi.js';
import { fetchDoc } from './docs.js';
import { FlowSpec, FlowStep, getAgentFlow } from './agents/flows.js';
import { isMonitoringEnabled } from './state.js';
import { Monitor, MonitorEntry } from './monitor.js';
import { detailedDiff } from 'deep-object-diff';
import { callMcpTool, mcpClientNameFromToolEvent } from './mcpclient.js';
import { isNodeEnv } from '../utils/runtime.js';
import Handlebars from 'handlebars';

export type Result = any;

const EmptyResult: Result = null;

export function isEmptyResult(r: Result): boolean {
  return r == EmptyResult;
}

type BetweenRelInfo = {
  relationship: Relationship;
  connectedInstance: Instance;
};

function mkEnvName(name: string | undefined, parent: Environment | undefined): string {
  if (name) return name;
  else {
    if (parent) {
      return `${parent.name}+`;
    } else {
      return 'env';
    }
  }
}

type CatchHandlers = Map<string, Statement>;

export class Environment extends Instance {
  parent: Environment | undefined;

  private activeModule: string;
  private activeEventInstance: Instance | undefined;
  private activeUser: string = AdminUserId;
  private activeUserSet: boolean = false;
  private lastResult: Result;
  private trashedResult: Result = undefined;
  private returnFlag: boolean = false;
  private parentPath: string | undefined;
  private normalizedParentPath: string | undefined;
  private betweenRelInfo: BetweenRelInfo | undefined;
  private activeResolvers: Map<string, Resolver>;
  private activeTransactions: Map<string, string>;
  private inUpsertMode: boolean = false;
  private inDeleteMode: boolean = false;
  private inKernelMode: boolean = false;
  private suspensionId: string | undefined;
  private preGeneratedSuspensionId: string;
  private activeCatchHandlers: Array<CatchHandlers>;
  private eventExecutor: Function | undefined = undefined;
  private statementsExecutor: Function | undefined = undefined;
  private scratchPad: any = undefined;
  private agentMode: 'chat' | 'planner' | undefined = undefined;
  private agentChatId: string | undefined = undefined;
  private monitor: Monitor | undefined = undefined;
  private escalatedRole: string | undefined;
  private activeChatId: string | undefined;

  private activeUserData: any = undefined;

  constructor(name?: string, parent?: Environment) {
    super(
      PlaceholderRecordEntry,
      DefaultModuleName,
      mkEnvName(name, parent),
      newInstanceAttributes()
    );
    if (parent !== undefined) {
      this.parent = parent;
      this.activeModule = parent.activeModule;
      this.activeUser = parent.activeUser;
      this.activeUserSet = parent.activeUserSet;
      this.setActiveEvent(parent.getActiveEventInstance());
      this.lastResult = parent.lastResult;
      this.activeTransactions = parent.activeTransactions;
      this.activeResolvers = parent.activeResolvers;
      this.inUpsertMode = parent.inUpsertMode;
      this.inKernelMode = parent.inKernelMode;
      this.activeCatchHandlers = parent.activeCatchHandlers;
      this.suspensionId = parent.suspensionId;
      this.eventExecutor = parent.eventExecutor;
      this.agentChatId = parent.agentChatId;
      this.monitor = parent.monitor;
      this.escalatedRole = parent.escalatedRole;
      this.activeChatId = parent.activeChatId;
    } else {
      this.activeModule = DefaultModuleName;
      this.activeResolvers = new Map<string, Resolver>();
      this.activeTransactions = new Map<string, string>();
      this.activeCatchHandlers = new Array<CatchHandlers>();
      this.attributes.set('process', process);
    }
    this.preGeneratedSuspensionId = crypto.randomUUID();
  }

  static from(
    parent: Environment,
    name?: string | undefined,
    isAsync: boolean = false,
    mergeScratchPad: boolean = false
  ): Environment {
    const env = new Environment(name, parent);
    if (isAsync) {
      env.activeResolvers = new Map<string, Resolver>();
      env.activeTransactions = new Map<string, string>();
      env.activeCatchHandlers = new Array<CatchHandlers>();
      env.preGeneratedSuspensionId = parent.preGeneratedSuspensionId;
    }
    if (mergeScratchPad && parent.scratchPad) {
      Object.keys(parent.scratchPad).forEach((k: string) => {
        env.bind(k, parent.scratchPad[k]);
      });
    }
    return env;
  }

  static fromInstance(inst: Instance): Environment {
    const env = new Environment();
    env.attributes = inst.attributes;
    return env;
  }

  override asSerializableObject(): object {
    const obj: any = super.asSerializableObject();
    obj.activeModule = this.activeModule;
    if (this.activeEventInstance) {
      obj.activeEventInstance = this.activeEventInstance.asSerializableObject();
    }
    obj.activeUser = this.activeUser;
    obj.activeUserSet = this.activeUserSet;
    obj.inUpsertMode = this.inUpsertMode;
    obj.inDeleteMode = this.inDeleteMode;
    obj.inKernelMode = this.inKernelMode;
    if (this.parent) {
      obj.parent = this.parent.asSerializableObject();
    }
    return obj;
  }

  static override FromSerializableObject(obj: any): Environment {
    const inst = Instance.FromSerializableObject(obj, PlaceholderRecordEntry);
    const env = Environment.fromInstance(inst);
    env.activeModule = obj.activeModule;
    if (obj.activeEventInstance) {
      env.activeEventInstance = Instance.FromSerializableObject(obj.activeEventInstance);
    }
    env.activeUser = obj.activeUser;
    env.activeUserSet = obj.activeUserSet;
    env.inUpsertMode = obj.inUpsertMode;
    env.inDeleteMode = obj.inDeleteMode;
    env.inKernelMode = obj.inKernelMode;
    if (obj.parent) {
      env.parent = Environment.FromSerializableObject(obj.parent);
    }
    return env;
  }

  override lookup(k: string): Result {
    const v = this.attributes.get(k);
    if (v === undefined) {
      if (this.parent !== undefined) {
        return this.parent.lookup(k);
      } else if (this == GlobalEnvironment) {
        return EmptyResult;
      } else {
        return GlobalEnvironment.lookup(k);
      }
    } else return v;
  }

  bind(k: string, v: any): Environment {
    this.attributes.set(k, v);
    return this;
  }

  bindInstance(inst: Instance): Environment {
    const n: string = inst.name;
    this.attributes.set(n, inst);
    return this;
  }

  setEscalatedRole(s: string): Environment {
    this.escalatedRole = s;
    return this;
  }

  getEscalatedRole(): string | undefined {
    return this.escalatedRole;
  }

  resetEscalatedRole(): Environment {
    this.escalatedRole = undefined;
    return this;
  }

  private static FlowContextTag = 'flow-context';

  setFlowContext(s: string): Environment {
    this.attributes.set(Environment.FlowContextTag, s);
    return this;
  }

  resetFlowContext(): Environment {
    this.attributes.set(Environment.FlowContextTag, undefined);
    return this;
  }

  getFlowContext(): string | undefined {
    return this.attributes.get(Environment.FlowContextTag);
  }

  setActiveChatId(chatId: string): Environment {
    this.activeChatId = chatId;
    return this;
  }

  getActiveChatId(): string | undefined {
    return this.activeChatId;
  }

  addToScratchPad(k: string, data: any): Environment {
    if (this.scratchPad === undefined) {
      this.scratchPad = {};
    }
    if (isFqName(k)) {
      const parts = nameToPath(k);
      this.scratchPad[parts.getEntryName()] = data;
    }
    this.scratchPad[k] = data;
    return this.addAttributesToScratchPad(data);
  }

  private addAttributesToScratchPad(data: any): Environment {
    if (data instanceof Map) {
      data.forEach((v: any, k: any) => {
        this.addToScratchPad(k as string, v);
      });
    } else if (data instanceof Array) {
      return this;
    } else if (data instanceof Object) {
      Object.keys(data).forEach((k: string) => {
        this.addToScratchPad(k, data[k]);
      });
    }
    return this;
  }

  getScratchPad(): any {
    return this.scratchPad;
  }

  resetScratchPad(): Environment {
    this.scratchPad = undefined;
    return this;
  }

  setScratchPad(obj: any): Environment {
    this.scratchPad = obj;
    return this;
  }

  private templateMappings: Map<string, string> | undefined;

  setTemplateMapping(k: string, v: string): Environment {
    if (this.templateMappings === undefined) {
      this.templateMappings = new Map<string, string>();
    }
    this.templateMappings.set(k, v);
    return this;
  }

  rewriteTemplateMappings(s: string): string {
    if (this.templateMappings !== undefined) {
      this.templateMappings.keys().forEach((k: string) => {
        const tk = `{{${k}}}`;
        const v = this.templateMappings?.get(k);
        if (v) {
          const tv = `{{${v}}}`;
          s = s.replaceAll(tk, tv);
        }
      });
    }
    return s;
  }

  resetTemplateMappings(): Environment {
    this.templateMappings?.clear();
    return this;
  }

  maybeRewriteTemplatePatterns(instruction: string, scratchPad?: any): string {
    const templ = Handlebars.compile(this.rewriteTemplateMappings(instruction));
    return templ(scratchPad);
  }

  static SuspensionUserData = '^';

  bindSuspensionUserData(userData: string): Environment {
    this.bind(Environment.SuspensionUserData, userData);
    return this;
  }

  lookupSuspensionUserData(): string | undefined {
    return this.lookup(Environment.SuspensionUserData);
  }

  maybeLookupAgentInstance(entryName: string): Instance | undefined {
    const v = this.lookup(entryName);
    if (v && isInstanceOfType(v, AgentFqName)) {
      return v as Instance;
    } else {
      return undefined;
    }
  }

  setActiveEvent(eventInst: Instance | undefined): Environment {
    if (eventInst) {
      if (!isEventInstance(eventInst)) throw new Error(`Not an event instance - ${eventInst.name}`);
      this.bindInstance(eventInst);
      this.activeModule = eventInst.moduleName;
      this.activeEventInstance = eventInst;
      if (!this.activeUserSet) {
        this.activeUser = eventInst.getAuthContextUserId();
        this.activeUserSet = true;
      }
    }
    return this;
  }

  getActiveEventInstance(): Instance | undefined {
    return this.activeEventInstance;
  }

  isSuspended(): boolean {
    return this.suspensionId !== undefined;
  }

  suspend(): string {
    if (this.suspensionId === undefined) {
      const id = this.preGeneratedSuspensionId;
      this.propagateSuspension(id);
      return id;
    } else {
      return this.suspensionId;
    }
  }

  softSuspend(): string {
    this.suspensionId = this.preGeneratedSuspensionId;
    return this.suspensionId;
  }

  releaseSuspension(): Environment {
    this.suspensionId = undefined;
    this.preGeneratedSuspensionId = crypto.randomUUID();
    return this;
  }

  fetchSuspensionId(): string {
    return this.preGeneratedSuspensionId;
  }

  markForReturn(): Environment {
    if (this.parent) {
      this.parent.markForReturn();
    }
    this.returnFlag = true;
    return this;
  }

  isMarkedForReturn(): boolean {
    return this.returnFlag;
  }

  propagateLastResult(): Environment {
    if (this.parent) {
      this.parent.lastResult = this.lastResult;
      this.parent.propagateLastResult();
    }
    return this;
  }

  resetReturnFlag(): Environment {
    if (this.returnFlag) {
      this.returnFlag = false;
      if (this.parent) {
        this.parent.resetReturnFlag();
      }
    }
    return this;
  }

  protected propagateSuspension(suspId: string) {
    this.suspensionId = suspId;
    if (this.parent) {
      this.parent.propagateSuspension(suspId);
    }
  }

  getSuspensionId(): string {
    if (this.suspensionId) {
      return this.suspensionId;
    } else {
      throw new Error('SuspensionId is not set');
    }
  }

  getActiveAuthContext(): ActiveSessionInfo | undefined {
    if (this.activeEventInstance) {
      return this.activeEventInstance.getAuthContext();
    }
    return undefined;
  }

  getActiveToken(): string | undefined {
    if (this.activeEventInstance) {
      const sess = this.activeEventInstance.getAuthContext();
      if (sess) {
        return sess.sessionId;
      }
    }
    return undefined;
  }

  setActiveUser(userId: string): Environment {
    this.activeUser = userId;
    this.activeUserSet = true;
    return this;
  }

  getActiveUser(): string {
    return this.activeUser;
  }

  setLastResult(result: Result): Environment {
    this.trashedResult = this.lastResult;
    this.lastResult = result;
    return this;
  }

  revokeLastResult(): Environment {
    if (this.trashedResult !== undefined) {
      this.lastResult = this.trashedResult;
      this.trashedResult = undefined;
    }
    return this;
  }

  getLastResult(): Result {
    return this.lastResult;
  }

  getActiveModuleName(): string {
    return this.activeModule;
  }

  setActiveModuleName(n: string): Environment {
    this.activeModule = n;
    return this;
  }

  switchActiveModuleName(newModuleName: string): string {
    const oldModuleName = this.activeModule;
    this.activeModule = newModuleName;
    return oldModuleName;
  }

  setParentPath(path: string): Environment {
    this.parentPath = path;
    return this;
  }

  getParentPath(): string | undefined {
    return this.parentPath;
  }

  setNormalizedParentPath(path: string): Environment {
    this.normalizedParentPath = path;
    return this;
  }

  getNormalizedParentPath(): string | undefined {
    return this.normalizedParentPath;
  }

  setBetweenRelInfo(info: BetweenRelInfo): Environment {
    this.betweenRelInfo = info;
    return this;
  }

  getBetweenRelInfo(): BetweenRelInfo | undefined {
    return this.betweenRelInfo;
  }

  setActiveResolvers(resolvers: Map<string, Resolver>): Environment {
    this.activeResolvers = resolvers;
    return this;
  }

  getActiveResolvers(): Map<string, Resolver> {
    return this.activeResolvers;
  }

  getResolver(resolverName: string): Resolver | undefined {
    const r: Resolver | undefined = this.getActiveResolvers().get(resolverName);
    if (r) {
      return r.setEnvironment(this);
    }
    return undefined;
  }

  async addResolver(resolver: Resolver): Promise<Environment> {
    this.getActiveResolvers().set(resolver.getName(), resolver);
    await this.ensureTransactionForResolver(resolver);
    resolver.setEnvironment(this);
    return this;
  }

  setActiveTransactions(txns: Map<string, string>): Environment {
    this.activeTransactions = txns;
    return this;
  }

  getActiveTransactions(): Map<string, string> {
    return this.activeTransactions;
  }

  async resetActiveTransactions(commit: boolean): Promise<Environment> {
    await this.endAllTransactions(commit);
    this.activeTransactions = new Map<string, string>();
    return this;
  }

  async getTransactionForResolver(resolver: Resolver): Promise<string> {
    const n: string = resolver.getName();
    let txnId: string | undefined = this.activeTransactions.get(n);
    if (txnId) {
      return txnId;
    } else {
      txnId = await resolver.startTransaction();
      if (txnId) {
        this.activeTransactions.set(n, txnId);
        return txnId;
      } else {
        throw new Error(`Failed to start transaction for ${n}`);
      }
    }
  }

  async ensureTransactionForResolver(resolver: Resolver): Promise<Environment> {
    await this.getTransactionForResolver(resolver);
    return this;
  }

  private async endAllTransactions(commit: boolean): Promise<void> {
    const txns: Map<string, string> = this.activeTransactions;
    for (const n of txns.keys()) {
      const txnId: string | undefined = txns.get(n);
      if (txnId) {
        const res: Resolver | undefined = this.getResolver(n);
        if (res) {
          if (commit) await res.commitTransaction(txnId);
          else await res.rollbackTransaction(txnId);
        }
      }
    }
  }

  async callInTransaction(f: Function): Promise<any> {
    let result: any;
    let commit: boolean = true;
    await f()
      .then((r: any) => {
        result = r;
      })
      .catch((r: any) => {
        commit = false;
        result = r;
      });
    await this.endAllTransactions(commit);
    if (!commit) {
      throw result;
    }
    return result;
  }

  async commitAllTransactions(): Promise<void> {
    await this.endAllTransactions(true);
  }

  async rollbackAllTransactions(): Promise<void> {
    await this.endAllTransactions(false);
  }

  setInUpsertMode(flag: boolean): Environment {
    this.inUpsertMode = flag;
    return this;
  }

  isInUpsertMode(): boolean {
    return this.inUpsertMode;
  }

  setInDeleteMode(flag: boolean): Environment {
    this.inDeleteMode = flag;
    return this;
  }

  isInDeleteMode(): boolean {
    return this.inDeleteMode;
  }

  setInKernelMode(flag: boolean): Environment {
    this.inKernelMode = flag;
    return this;
  }

  isInKernelMode(): boolean {
    return this.inKernelMode;
  }

  pushHandlers(handlers: CatchHandlers): boolean {
    if (handlers.has('error')) {
      this.activeCatchHandlers.push(handlers);
      return true;
    }
    return false;
  }

  hasHandlers(): boolean {
    return this.activeCatchHandlers.length > 0;
  }

  popHandlers(): CatchHandlers {
    const r = this.activeCatchHandlers.pop();
    if (r === undefined) {
      throw new Error(`No more handlers to pop`);
    }
    return r;
  }

  setEventExecutor(exec: Function): Environment {
    this.eventExecutor = exec;
    return this;
  }

  getEventExecutor(): Function | undefined {
    return this.eventExecutor;
  }

  unsetEventExecutor(): Environment {
    this.eventExecutor = undefined;
    return this;
  }

  setStatementsExecutor(f: Function): Environment {
    this.statementsExecutor = f;
    return this;
  }

  getStatementsExecutor(): Function | undefined {
    return this.statementsExecutor;
  }

  async callWithStatementsExecutor(exec: Function, f: Function): Promise<any> {
    const oldExec = this.statementsExecutor;
    this.statementsExecutor = exec;
    try {
      return await f();
    } finally {
      this.statementsExecutor = oldExec;
    }
  }

  setActiveUserData(data: any): Environment {
    this.activeUserData = data;
    return this;
  }

  getActiveUserData(): any {
    return this.activeUserData;
  }

  inChatAgentMode(): Environment {
    this.agentMode = 'chat';
    return this;
  }

  inPlannerAgentMode(): Environment {
    this.agentMode = 'planner';
    return this;
  }

  resetAgentMode(): Environment {
    this.agentMode = undefined;
    return this;
  }

  isInAgentChatMode(): boolean {
    return this.agentMode === 'chat';
  }

  isAgentModeSet(): boolean {
    return this.agentMode !== undefined;
  }

  setAgentChatId(chatId: string): Environment {
    this.agentChatId = chatId;
    return this;
  }

  getAgentChatId(): string | undefined {
    return this.agentChatId;
  }

  appendEntryToMonitor(stmt: string): Environment {
    if (this.monitor === undefined) {
      if (this.activeEventInstance && isCoreModule(this.activeEventInstance.moduleName)) {
        return this;
      }
      this.monitor = new Monitor(this.activeEventInstance, this.activeUser);
    }
    this.monitor.addEntry(new MonitorEntry(stmt));
    return this;
  }

  setMonitorEntryError(reason: string): Environment {
    if (this.monitor !== undefined) {
      this.monitor.setEntryError(reason);
    }
    return this;
  }

  setMonitorEntryResult(result: any): Environment {
    if (this.monitor !== undefined) {
      this.monitor.setEntryResult(result);
    }
    return this;
  }

  flagMonitorEntryAsLlm(): Environment {
    if (this.monitor !== undefined) {
      this.monitor.flagEntryAsLlm();
    }
    return this;
  }

  flagMonitorEntryAsPlanner(): Environment {
    if (this.monitor !== undefined) {
      this.monitor.flagEntryAsPlanner();
    }
    return this;
  }

  flagMonitorEntryAsFlow(): Environment {
    if (this.monitor !== undefined) {
      this.monitor.flagEntryAsFlow();
    }
    return this;
  }

  flagMonitorEntryAsFlowStep(): Environment {
    if (this.monitor !== undefined) {
      this.monitor.flagEntryAsFlowStep();
    }
    return this;
  }

  flagMonitorEntryAsDecision(): Environment {
    if (this.monitor !== undefined) {
      this.monitor.flagEntryAsDecision();
    }
    return this;
  }

  setMonitorEntryLlmPrompt(s: string): Environment {
    if (this.monitor !== undefined) {
      this.monitor.setEntryLlmPrompt(s);
    }
    return this;
  }

  setMonitorEntryLlmResponse(s: string): Environment {
    if (this.monitor !== undefined) {
      this.monitor.setEntryLlmResponse(s);
    }
    return this;
  }

  setMonitorEntryLlmTokenUsage(input: number, output: number, total: number): Environment {
    if (this.monitor !== undefined) {
      this.monitor.setEntryLlmTokenUsage(input, output, total);
    }
    return this;
  }

  incrementMonitor(): Environment {
    if (this.monitor !== undefined) {
      this.monitor = this.monitor.increment();
    }
    return this;
  }

  decrementMonitor(): Environment {
    if (this.monitor !== undefined) {
      this.monitor = this.monitor.decrement();
    }
    return this;
  }

  setMonitorFlowResult(): Environment {
    if (this.monitor !== undefined) {
      this.monitor.setFlowResult(this.lastResult);
    }
    return this;
  }
}

export const GlobalEnvironment = new Environment();

export let evaluate = async function (
  eventInstance: Instance,
  continuation?: Function,
  activeEnv?: Environment,
  kernelCall?: boolean
): Promise<Result> {
  let env: Environment | undefined;
  let txnRolledBack: boolean = false;
  try {
    if (isEventInstance(eventInstance)) {
      const wf: Workflow = getWorkflow(eventInstance);
      if (!isEmptyWorkflow(wf)) {
        env = new Environment(eventInstance.name + '.env', activeEnv);
        env.setActiveEvent(eventInstance);
        const er = wf.getRoleEscalation();
        if (er) env.setEscalatedRole(er);
        if (kernelCall) {
          env.setInKernelMode(true);
        }
        await evaluateStatements(wf.statements, env, continuation);
        return env.getLastResult();
      } else if (isAgentEventInstance(eventInstance)) {
        env = new Environment(eventInstance.name + '.env', activeEnv);
        await handleAgentInvocation(eventInstance, env);
        if (continuation) continuation(env.getLastResult());
      } else if (isOpenApiEventInstance(eventInstance)) {
        env = new Environment(eventInstance.name + '.env', activeEnv);
        await handleOpenApiEvent(eventInstance, env);
        const r = env.getLastResult();
        if (continuation) continuation(r);
        return r;
      } else {
        if (continuation) continuation(null);
        return null;
      }
    } else {
      throw new Error('Not an event - ' + eventInstance.name);
    }
  } catch (err) {
    if (env && env.hasHandlers()) {
      throw err;
    } else {
      if (env !== undefined && activeEnv === undefined) {
        await env.rollbackAllTransactions().then(() => {
          txnRolledBack = true;
        });
      }
      throw err;
    }
  } finally {
    env?.resetEscalatedRole();
    if (!txnRolledBack && env !== undefined && activeEnv === undefined) {
      await env.commitAllTransactions();
    }
    if (isMonitoringEnabled()) {
      await flushMonitoringData(eventInstance.getId());
    }
  }
};

export function setEvaluateFn(f: any): Function {
  const oldf = evaluate;
  evaluate = f;
  return oldf;
}

export async function evaluateAsEvent(
  moduleName: string,
  eventName: string,
  attrs: Array<any> | object,
  activeSession?: ActiveSessionInfo,
  env?: Environment,
  kernelCall?: boolean
): Promise<Result> {
  const finalAttrs: Map<string, any> =
    attrs instanceof Array ? new Map(attrs) : new Map(Object.entries(attrs));
  const eventInst: Instance = makeInstance(moduleName, eventName, finalAttrs).setAuthContext(
    activeSession || AdminSession
  );
  let result: any;
  await evaluate(eventInst, (r: any) => (result = r), env, kernelCall);
  return result;
}

export function makeEventEvaluator(moduleName: string): Function {
  return async (
    eventName: string,
    attrs: Array<any> | object,
    env: Environment,
    session?: ActiveSessionInfo,
    kernelCall: boolean = true
  ): Promise<Result> => {
    if (!env) {
      env = new Environment();
    }
    return await evaluateAsEvent(moduleName, eventName, attrs, session, env, kernelCall);
  };
}

export async function evaluateStatements(
  stmts: Statement[],
  env: Environment,
  continuation?: Function
) {
  for (let i = 0; i < stmts.length; ++i) {
    const stmt = stmts[i];
    await evaluateStatement(stmt, env);
    if (env.isMarkedForReturn()) {
      break;
    }
  }
  if (continuation !== undefined) {
    continuation(env.getLastResult());
  }
}

async function evaluateAsyncPattern(
  pat: Pattern,
  thenStmts: Statement[],
  handlers: CatchHandlers | undefined,
  hints: RuntimeHint[],
  env: Environment
): Promise<void> {
  try {
    await evaluatePattern(pat, env);
    maybeBindStatementResultToAlias(hints, env);
    if (env.isSuspended()) {
      await createSuspension(
        env.fetchSuspensionId(),
        thenStmts.map((s: Statement) => {
          if (s.$cstNode) {
            return s.$cstNode.text;
          } else {
            throw new Error('failed to extract code for suspension statement');
          }
        }),
        env
      );
    } else {
      await evaluateStatements(thenStmts, env);
    }
  } catch (reason: any) {
    await env.rollbackAllTransactions();
    await maybeHandleError(handlers, reason, env);
  } finally {
    await env.commitAllTransactions();
  }
}

export async function evaluateStatement(stmt: Statement, env: Environment): Promise<void> {
  const hints = stmt.hints;
  const hasHints = hints && hints.length > 0;
  const thenStmts: Statement[] | undefined = hasHints ? maybeFindThenStatements(hints) : undefined;
  const handlers: CatchHandlers | undefined = hasHints ? maybeFindHandlers(hints) : undefined;
  if (thenStmts) {
    evaluateAsyncPattern(
      stmt.pattern,
      thenStmts,
      handlers,
      hints,
      Environment.from(env, env.name + 'async', true)
    );
    env.setLastResult(env.fetchSuspensionId());
    if (isReturn(stmt.pattern)) {
      env.markForReturn();
    }
    if (hasHints) {
      maybeBindStatementResultToAlias(hints, env);
    }
    return;
  }
  let handlersPushed = false;
  try {
    if (handlers) {
      handlersPushed = env.pushHandlers(handlers);
    }
    await evaluatePattern(stmt.pattern, env);
    if (hasHints) {
      await maybeHandleEmpty(hints, env);
    }
    if (hasHints) {
      maybeBindStatementResultToAlias(hints, env);
    }
    await maybeHandleNotFound(handlers, env);
  } catch (reason: any) {
    await maybeHandleError(handlers, reason, env);
  } finally {
    if (handlersPushed && env.hasHandlers()) {
      env.popHandlers();
    }
  }
}

async function maybeHandleNotFound(handlers: CatchHandlers | undefined, env: Environment) {
  const lastResult: Result = env.getLastResult();
  if (
    lastResult === null ||
    lastResult === undefined ||
    (lastResult instanceof Array && lastResult.length == 0)
  ) {
    const onNotFound = handlers ? handlers.get('not_found') : undefined;
    if (onNotFound) {
      const newEnv = new Environment('not-found-env', env).unsetEventExecutor();
      await evaluateStatement(onNotFound, newEnv);
      env.setLastResult(newEnv.getLastResult());
    }
  }
}

async function maybeHandleEmpty(hints: RuntimeHint[], env: Environment) {
  const lastResult: Result = env.getLastResult();
  if (
    lastResult === null ||
    lastResult === undefined ||
    (lastResult instanceof Array && lastResult.length == 0)
  ) {
    for (const rh of hints) {
      if (rh.emptySpec) {
        const newEnv = new Environment('empty-env', env).unsetEventExecutor();
        await evaluateStatement(rh.emptySpec.stmt, newEnv);
        env.setLastResult(newEnv.getLastResult());
        break;
      }
    }
  }
}

async function maybeHandleError(
  handlers: CatchHandlers | undefined,
  reason: any,
  env: Environment
) {
  const handler = handlers ? handlers.get('error') : undefined;
  if (handler) {
    const newEnv = new Environment('handler-env', env).unsetEventExecutor();
    await evaluateStatement(handler, newEnv);
    env.setLastResult(newEnv.getLastResult());
  } else {
    throw reason;
  }
}

export function maybeBindStatementResultToAlias(hints: RuntimeHint[], env: Environment) {
  for (let i = 0; i < hints.length; ++i) {
    const rh = hints[i];
    if (rh.aliasSpec) {
      if (rh.aliasSpec.alias !== undefined || rh.aliasSpec.aliases.length > 0) {
        const result: Result = env.getLastResult();
        const alias: string | undefined = rh.aliasSpec.alias;
        if (alias !== undefined) {
          env.bind(alias, result);
        } else {
          const aliases: string[] = rh.aliasSpec.aliases;
          if (result instanceof Array) {
            const resArr: Array<any> = result as Array<any>;
            for (let i = 0; i < aliases.length; ++i) {
              const k: string = aliases[i];
              if (k == '__') {
                env.bind(aliases[i + 1], resArr.splice(i));
                break;
              } else if (k != '_') {
                env.bind(aliases[i], resArr[i]);
              }
            }
          } else {
            env.bind(aliases[0], result);
          }
        }
      }
      break;
    }
  }
}

function maybeFindHandlers(hints: RuntimeHint[]): Map<string, Statement> | undefined {
  for (let i = 0; i < hints.length; ++i) {
    const rh = hints[i];
    if (rh.catchSpec) {
      const result = new Map<string, Statement>();
      rh.catchSpec.handlers.forEach((h: Handler) => {
        result.set(h.except, h.stmt);
      });
      return result;
    }
  }
  return undefined;
}

function maybeFindThenStatements(hints: RuntimeHint[]): Statement[] | undefined {
  for (let i = 0; i < hints.length; ++i) {
    const rh = hints[i];
    if (rh.thenSpec) {
      return rh.thenSpec.statements;
    }
  }
  return undefined;
}

export let parseAndEvaluateStatement = async function (
  stmtString: string,
  activeUserId?: string,
  actievEnv?: Environment
): Promise<Result> {
  const env = actievEnv ? actievEnv : new Environment();
  if (activeUserId) {
    env.setActiveUser(activeUserId);
  }
  let commit: boolean = true;
  try {
    const stmt: Statement = await parseStatement(stmtString);
    if (stmt) {
      await evaluateStatement(stmt, env);
      return env.getLastResult();
    } else {
      commit = false;
    }
  } catch (err) {
    commit = false;
    throw err;
  } finally {
    if (!actievEnv) {
      if (commit) {
        await env.commitAllTransactions();
      } else {
        await env.rollbackAllTransactions();
      }
    }
  }
};

export function setParseAndEvaluateStatementFn(f: any): Function {
  const oldf = parseAndEvaluateStatement;
  parseAndEvaluateStatement = f;
  return oldf;
}

export async function lookupAllInstances(entityFqName: string): Promise<Instance[]> {
  return await parseAndEvaluateStatement(`{${entityFqName}? {}}`);
}

export class PatternHandler {
  async handleExpression(expr: Expr, env: Environment) {
    await evaluateExpression(expr, env);
  }

  async handleCrudMap(crudMap: CrudMap, env: Environment) {
    await evaluateCrudMap(crudMap, env);
  }

  async handleForEach(forEach: ForEach, env: Environment) {
    await evaluateForEach(forEach, env);
  }

  async handleIf(_if: If, env: Environment) {
    await evaluateIf(_if, env);
  }

  async handleIfWithAlias(ifWithAlias: IfWithAlias, env: Environment) {
    await evaluateIfWithAlias(ifWithAlias, env);
  }

  async handleDelete(del: Delete, env: Environment) {
    await evaluateDelete(del, env);
  }

  async handlePurge(purge: Purge, env: Environment) {
    await evaluatePurge(purge, env);
  }

  async handleFullTextSearch(fullTextSearch: FullTextSearch, env: Environment) {
    await evaluateFullTextSearch(fullTextSearch, env);
  }

  async handleReturn(ret: Return, env: Environment) {
    await evaluatePattern(ret.pattern, env);
  }

  async handleThrow(throwErr: ThrowError, env: Environment) {
    await evaluateThrowError(throwErr, env);
  }
}

const DefaultPatternHandler = new PatternHandler();

export async function evaluatePattern(
  pat: Pattern,
  env: Environment,
  handler: PatternHandler = DefaultPatternHandler
): Promise<void> {
  if (pat.expr) {
    await handler.handleExpression(pat.expr, env);
  } else if (pat.crudMap) {
    await handler.handleCrudMap(pat.crudMap, env);
  } else if (pat.forEach) {
    await handler.handleForEach(pat.forEach, env);
  } else if (pat.if) {
    await handler.handleIf(pat.if, env);
  } else if (pat.ifWithAlias) {
    await handler.handleIfWithAlias(pat.ifWithAlias, env);
  } else if (pat.delete) {
    await handler.handleDelete(pat.delete, env);
  } else if (pat.purge) {
    await handler.handlePurge(pat.purge, env);
  } else if (pat.fullTextSearch) {
    await handler.handleFullTextSearch(pat.fullTextSearch, env);
  } else if (pat.return) {
    await handler.handleReturn(pat.return, env);
    env.markForReturn();
  } else if (pat.throwError) {
    await handler.handleThrow(pat.throwError, env);
  }
}

async function evaluateThrowError(throwErr: ThrowError, env: Environment) {
  await evaluateExpression(throwErr.reason, env);
  throw new Error(env.getLastResult());
}

async function evaluateFullTextSearch(fts: FullTextSearch, env: Environment): Promise<void> {
  let n = escapeQueryName(fts.name);
  if (!isFqName(n)) {
    const inst: Instance | undefined = env.getActiveEventInstance();
    if (inst) {
      n = makeFqName(inst.moduleName, n);
    } else {
      throw new Error(`Fully qualified name required for full-text-search in ${n}`);
    }
  }
  const path = nameToPath(n);
  const entryName = path.getEntryName();
  const moduleName = path.getModuleName();
  const resolver = await getResolverForPath(entryName, moduleName, env);
  await evaluateLiteral(fts.query, env);
  const q = env.getLastResult();
  if (!isString(q)) {
    throw new Error(`Full text search query must be a string - ${q}`);
  }
  let options: Map<string, any> | undefined;
  if (fts.options) {
    await realizeMap(fts.options, env);
    options = env.getLastResult();
  }
  env.setLastResult(await resolver.fullTextSearch(entryName, moduleName, q, options));
}

async function evaluateLiteral(lit: Literal, env: Environment): Promise<void> {
  if (lit.id !== undefined) env.setLastResult(env.lookup(lit.id));
  else if (lit.ref !== undefined) env.setLastResult(await followReference(env, lit.ref));
  else if (lit.fnCall !== undefined) await applyFn(lit.fnCall, env, false);
  else if (lit.asyncFnCall !== undefined) await applyFn(lit.asyncFnCall.fnCall, env, true);
  else if (lit.array !== undefined) await realizeArray(lit.array, env);
  else if (lit.map !== undefined) await realizeMap(lit.map, env);
  else if (lit.num !== undefined) env.setLastResult(lit.num);
  else if (lit.str !== undefined) env.setLastResult(restoreSpecialChars(lit.str));
  else if (lit.bool !== undefined) env.setLastResult(lit.bool == 'true' ? true : false);
}

function getMapKey(k: MapKey): Result {
  if (k.str !== undefined) return k.str;
  else if (k.num !== undefined) return k.num;
  else if (k.bool !== undefined) return k.bool == 'true' ? true : false;
}

const DefaultResolverName: string = '-';

async function getResolverForPath(
  entryName: string,
  moduleName: string,
  env: Environment,
  isReadForUpdate: boolean = false,
  isReadForDelete: boolean = false
): Promise<Resolver> {
  const fqEntryName: string = isFqName(entryName) ? entryName : makeFqName(moduleName, entryName);
  const resN: string | undefined = getResolverNameForPath(fqEntryName);
  let res: Resolver | undefined;
  if (resN === undefined) {
    res = env.getResolver(DefaultResolverName);
    if (res === undefined) {
      res = new SqlDbResolver(DefaultResolverName);
      await env.addResolver(res);
    }
  } else {
    res = env.getResolver(resN);
    if (res === undefined) {
      res = getResolver(fqEntryName);
      await env.addResolver(res);
    }
  }

  const authInfo: ResolverAuthInfo = new ResolverAuthInfo(
    env.getActiveUser(),
    isReadForUpdate,
    isReadForDelete
  );
  return res.setAuthInfo(authInfo);
}

async function lookupOneOfVals(fqName: string, env: Environment): Promise<Instance[] | null> {
  return await parseAndEvaluateStatement(`{${fqName}? {}}`, undefined, env);
}

export type AggregateFunctionCall = {
  name: string;
  args: string[];
};

async function patternToInstance(
  entryName: string,
  attributes: SetAttribute[] | undefined,
  env: Environment
): Promise<Instance> {
  const attrs: InstanceAttributes = newInstanceAttributes();
  let qattrs: InstanceAttributes | undefined;
  let qattrVals: InstanceAttributes | undefined;
  let aggregates: Map<string, AggregateFunctionCall> | undefined;
  const isQueryAll: boolean = entryName.endsWith(QuerySuffix);
  if (isQueryAll) {
    entryName = entryName.slice(0, entryName.length - 1);
  }
  if (attributes) {
    for (let i = 0; i < attributes.length; ++i) {
      const a: SetAttribute = attributes[i];
      if (a.value !== undefined) {
        await evaluateExpression(a.value, env);
        const v: Result = env.getLastResult();
        let aname: string = a.name;
        if (aname.endsWith(QuerySuffix)) {
          if (isQueryAll) {
            throw new Error(`Cannot specifiy query attribute ${aname} here`);
          }
          if (qattrs === undefined) qattrs = newInstanceAttributes();
          if (qattrVals === undefined) qattrVals = newInstanceAttributes();
          aname = aname.slice(0, aname.length - 1);
          qattrs.set(aname, a.op === undefined ? '=' : a.op);
          qattrVals.set(aname, v);
        } else {
          attrs.set(aname, v);
        }
      } else if (a.aggregate !== undefined) {
        if (aggregates === undefined) aggregates = new Map<string, AggregateFunctionCall>();
        aggregates.set(escapeQueryName(a.name), { name: a.aggregate.name, args: a.aggregate.args });
      }
    }
  }
  let moduleName = env.getActiveModuleName();
  if (isFqName(entryName)) {
    const p: Path = nameToPath(entryName);
    if (p.hasModule()) moduleName = p.getModuleName();
    if (p.hasEntry()) entryName = p.getEntryName();
  }
  const inst = makeInstance(moduleName, entryName, attrs, qattrs, qattrVals, isQueryAll);
  if (aggregates !== undefined) {
    return inst.setAggregates(aggregates);
  }
  return inst;
}

async function instanceFromSource(crud: CrudMap, env: Environment): Promise<Instance> {
  if (crud.source) {
    await evaluateLiteral(crud.source, env);
    const attrsSrc = env.getLastResult();
    if (attrsSrc && attrsSrc instanceof Object) {
      const obj =
        attrsSrc instanceof Instance ? (attrsSrc as Instance).userAttributesAsObject() : attrsSrc;
      const attrs: InstanceAttributes = new Map(Object.entries(obj));
      const nparts = nameToPath(crud.name);
      const n = nparts.getEntryName();
      const m = nparts.hasModule() ? nparts.getModuleName() : env.getActiveModuleName();
      return makeInstance(m, n, attrs);
    } else {
      throw new Error(`Failed to initialize instance of ${crud.name}, expected a map after @from.`);
    }
  } else {
    throw new Error(
      `Cannot create instance of ${crud.name}, CRUD pattern does not specify a source map.`
    );
  }
}

async function maybeValidateOneOfRefs(inst: Instance, env: Environment) {
  const attrs = inst.record.oneOfRefAttributes;
  if (!attrs) return;
  for (let i = 0; i < attrs.length; ++i) {
    const n = attrs[i];
    const v = inst.lookup(n);
    if (v === undefined) continue;
    const attrSpec = inst.record.schema.get(n);
    if (!attrSpec) continue;
    const r = getOneOfRef(attrSpec);
    if (!r) throw new Error(`Failed to fetch one-of-ref for ${n}`);
    if (r) {
      const parts = r.split('.');
      const insts = await lookupOneOfVals(parts[0], env);
      if (!insts || insts.length == 0) {
        logger.warn(`No enum values set for ${n}`);
        continue;
      }
      if (
        !insts.some((i: Instance) => {
          return i.lookup(parts[1]) == v;
        })
      ) {
        throw new Error(`Invalid enum-value ${v} for ${n}`);
      }
    }
  }
}

function maybeSetQueryClauses(inst: Instance, qopts: ExtractedQueryOptions) {
  if (qopts.groupByClause) {
    inst.setGroupBy(qopts.groupByClause.colNames);
  }
  if (qopts.orderByClause) {
    inst.setOrderBy(qopts.orderByClause.colNames, qopts.orderByClause.order === '@desc');
  }
}

async function evaluateCrudMap(crud: CrudMap, env: Environment): Promise<void> {
  const qopts = extractQueryOptions(crud);
  if (!env.isInUpsertMode() && qopts.upsert !== undefined) {
    return await evaluateUpsert(crud, env);
  }
  const inst: Instance = crud.source
    ? await instanceFromSource(crud, env)
    : await patternToInstance(crud.name, crud.body?.attributes, env);
  const entryName = inst.name;
  const moduleName = inst.moduleName;
  const attrs = inst.attributes;
  const qattrs = inst.queryAttributes;
  const onlyAggregates = inst.aggregates !== undefined && qattrs === undefined;
  const isQueryAll = onlyAggregates || crud.name.endsWith(QuerySuffix);
  const distinct: boolean = qopts.distinct !== undefined;
  maybeSetQueryClauses(inst, qopts);
  if (attrs.size > 0) {
    await maybeValidateOneOfRefs(inst, env);
  }
  if (qopts.into) {
    if (attrs.size > 0) {
      throw new Error(
        `Query pattern for ${entryName} with 'into' clause cannot be used to update attributes`
      );
    }
    if (qattrs === undefined && !isQueryAll) {
      throw new Error(`Pattern for ${entryName} with 'into' clause must be a query`);
    }
    if (qopts.joins && qopts.joins.length > 0) {
      await evaluateJoinQuery(qopts.joins, qopts.into, qopts.where, inst, distinct, env);
    } else {
      await evaluateJoinQueryWithRelationships(
        qopts.into,
        inst,
        crud.relationships || [],
        distinct,
        env
      );
    }
    return;
  }
  const isBetRel = isBetweenRelationship(inst.name, inst.moduleName);
  if (isEntityInstance(inst) || isBetRel) {
    if (qattrs === undefined && !isQueryAll) {
      const parentPath: string | undefined = env.getParentPath();
      if (parentPath) {
        inst.attributes.set(PathAttributeName, parentPath);
        inst.attributes.set(ParentAttributeName, env.getNormalizedParentPath() || '');
      }
      const res: Resolver = await getResolverForPath(entryName, moduleName, env);
      let r: Instance | undefined;
      await computeExprAttributes(inst, undefined, undefined, env);
      await setMetaAttributes(inst.attributes, env);
      if (env.isInUpsertMode()) {
        await runPreUpdateEvents(inst, env);
        r = await res.upsertInstance(inst);
        await runPostUpdateEvents(inst, undefined, env);
      } else {
        if (isBetRel && env.isInDeleteMode()) {
          const rel: Relationship = getRelationship(inst.name, inst.moduleName);
          await res.handleInstancesLink(
            inst.lookup(rel.node1.alias),
            inst.lookup(rel.node2.alias),
            rel,
            false,
            true
          );
          r = inst;
        } else {
          await runPreCreateEvents(inst, env);
          if (isTimer(inst)) triggerTimer(inst);
          r = await res.createInstance(inst);
          await runPostCreateEvents(inst, env);
        }
      }
      if (r && entryName == AgentEntityName && inst.moduleName == CoreAIModuleName) {
        defineAgentEvent(env.getActiveModuleName(), r.lookup('name'), r.lookup('instruction'));
      }
      env.setLastResult(r);
      const betRelInfo: BetweenRelInfo | undefined = env.getBetweenRelInfo();
      if (betRelInfo) {
        await res.handleInstancesLink(
          betRelInfo.connectedInstance,
          env.getLastResult(),
          betRelInfo.relationship,
          env.isInUpsertMode(),
          env.isInDeleteMode()
        );
      }
      if (crud.relationships !== undefined) {
        for (let i = 0; i < crud.relationships.length; ++i) {
          const rel: RelationshipPattern = crud.relationships[i];
          const relEntry: Relationship = getRelationship(rel.name, moduleName);
          const newEnv: Environment = Environment.from(env);
          if (isContainsRelationship(rel.name, moduleName)) {
            const ppath = inst.attributes.get(PathAttributeName);
            newEnv.setParentPath(`${ppath}/${escapeFqName(relEntry.getFqName())}`);
            newEnv.setNormalizedParentPath(ppath);
            await evaluatePattern(rel.pattern, newEnv);
            const lastInst: Instance = env.getLastResult();
            lastInst.attachRelatedInstances(rel.name, newEnv.getLastResult());
          } else if (isBetweenRelationship(rel.name, moduleName)) {
            const lastInst: Instance = env.getLastResult() as Instance;
            await evaluatePattern(rel.pattern, newEnv);
            const relResult: any = newEnv.getLastResult();
            const res: Resolver = await getResolverForPath(rel.name, moduleName, env);
            await res.handleInstancesLink(
              lastInst,
              relResult,
              relEntry,
              env.isInUpsertMode(),
              env.isInDeleteMode()
            );
            lastInst.attachRelatedInstances(rel.name, newEnv.getLastResult());
          }
        }
      }
    } else {
      const parentPath: string | undefined = env.getParentPath();
      const betRelInfo: BetweenRelInfo | undefined = env.getBetweenRelInfo();
      const isReadForUpdate = attrs.size > 0;
      let res: Resolver = Resolver.Default;
      if (parentPath !== undefined) {
        res = await getResolverForPath(inst.name, inst.moduleName, env);
        const insts: Instance[] = await res.queryChildInstances(parentPath, inst);
        env.setLastResult(insts);
      } else if (betRelInfo !== undefined) {
        res = await getResolverForPath(
          betRelInfo.relationship.name,
          betRelInfo.relationship.moduleName,
          env
        );
        const insts: Instance[] = await res.queryConnectedInstances(
          betRelInfo.relationship,
          betRelInfo.connectedInstance,
          inst
        );
        env.setLastResult(insts);
      } else {
        res = await getResolverForPath(
          inst.name,
          inst.moduleName,
          env,
          isReadForUpdate,
          env.isInDeleteMode()
        );
        let oneToOne = false;
        let rel: Relationship | undefined;
        if (isBetRel && env.isInDeleteMode()) {
          rel = getRelationship(inst.name, inst.moduleName);
          oneToOne = rel.isOneToOne();
        }
        if (oneToOne && rel !== undefined) {
          await res.handleInstancesLink(
            inst.lookupQueryVal(rel.node1.alias),
            inst.lookupQueryVal(rel.node2.alias),
            rel,
            false,
            true
          );
          env.setLastResult(inst);
        } else {
          const insts: Instance[] = await res.queryInstances(inst, isQueryAll, distinct);
          env.setLastResult(insts);
        }
      }
      if (crud.relationships !== undefined) {
        const lastRes: Instance[] = env.getLastResult();
        for (let i = 0; i < crud.relationships.length; ++i) {
          const rel: RelationshipPattern = crud.relationships[i];
          const relEntry: Relationship = getRelationship(rel.name, moduleName);
          for (let j = 0; j < lastRes.length; ++j) {
            const newEnv: Environment = Environment.from(env);
            if (isContainsRelationship(rel.name, moduleName)) {
              const currInst: Instance = lastRes[j];
              let ppath = '';
              if (relEntry.isParent(currInst)) {
                ppath = currInst.lookup(PathAttributeName);
                newEnv.setParentPath(ppath + '/' + escapeFqName(relEntry.getFqName()));
              } else {
                ppath = currInst.lookup(ParentAttributeName);
                newEnv.setParentPath(ppath);
              }
              newEnv.setNormalizedParentPath(ppath);
              await evaluatePattern(rel.pattern, newEnv);
              lastRes[j].attachRelatedInstances(rel.name, newEnv.getLastResult());
            } else if (isBetweenRelationship(rel.name, moduleName)) {
              newEnv.setBetweenRelInfo({ relationship: relEntry, connectedInstance: lastRes[j] });
              await evaluatePattern(rel.pattern, newEnv);
              lastRes[j].attachRelatedInstances(rel.name, newEnv.getLastResult());
            }
          }
        }
      }
      if (isReadForUpdate) {
        const lastRes: Instance[] | Instance = env.getLastResult();
        if (lastRes instanceof Array) {
          if (lastRes.length > 0) {
            const resolver: Resolver = await getResolverForPath(
              lastRes[0].name,
              lastRes[0].moduleName,
              env
            );
            const res: Array<Instance> = new Array<Instance>();
            for (let i = 0; i < lastRes.length; ++i) {
              await computeExprAttributes(lastRes[i], crud.body?.attributes, attrs, env);
              env.attributes.set('__patch', attrs);
              await runPreUpdateEvents(lastRes[i], env);
              await setMetaAttributes(attrs, env, true);
              const finalInst: Instance = await resolver.updateInstance(lastRes[i], attrs);
              await runPostUpdateEvents(finalInst, lastRes[i], env);
              res.push(finalInst);
            }
            env.setLastResult(res);
          } else {
            env.setLastResult(lastRes);
          }
        } else {
          const res: Resolver = await getResolverForPath(lastRes.name, lastRes.moduleName, env);
          await computeExprAttributes(lastRes, crud.body?.attributes, attrs, env);
          await runPreUpdateEvents(lastRes, env);
          const finalInst: Instance = await res.updateInstance(lastRes, attrs);
          await runPostUpdateEvents(finalInst, lastRes, env);
          env.setLastResult(finalInst);
        }
      }
    }
  } else if (isEventInstance(inst)) {
    if (isAgentEventInstance(inst)) await handleAgentInvocation(inst, env);
    else if (isOpenApiEventInstance(inst)) await handleOpenApiEvent(inst, env);
    else if (isDocEventInstance(inst)) await handleDocEvent(inst, env);
    else if (isMcpEventInstance(inst)) await handleMcpEvent(inst, env);
    else {
      const eventExec = env.getEventExecutor();
      const newEnv = new Environment(`${inst.name}.env`, env);
      if (eventExec) {
        await eventExec(inst, newEnv);
        env.setLastResult(newEnv.getLastResult());
      } else {
        await evaluate(inst, (result: Result) => env.setLastResult(result), newEnv);
      }
      env.resetReturnFlag();
    }
  } else {
    env.setLastResult(inst);
  }
}

const CoreAIModuleName = makeCoreModuleName('ai');
export const DocEventName = `${CoreAIModuleName}/doc`;

function isDocEventInstance(inst: Instance): boolean {
  return isInstanceOfType(inst, DocEventName);
}

export function isMcpEventInstance(inst: Instance): boolean {
  const event: Event = inst.record as Event;
  return event.isMcpTool();
}

async function handleDocEvent(inst: Instance, env: Environment): Promise<void> {
  const url = inst.lookup('url');
  if (typeof url === 'string' && url.startsWith('s3://')) {
    if (!isNodeEnv) {
      throw new Error('Document fetching is only available in Node.js environment');
    }
    const title = inst.lookup('title');
    const retrievalConfig = inst.lookup('retrievalConfig');
    const embeddingConfig = inst.lookup('embeddingConfig');
    const { documentFetcher } = await import('./services/documentFetcher.js');
    await documentFetcher.fetchDocument({
      title,
      url,
      retrievalConfig,
      embeddingConfig,
    });
    return;
  }

  if (typeof url === 'string' && url.startsWith('document-service://')) {
    const title = inst.lookup('title');
    const retrievalConfig = inst.lookup('retrievalConfig');
    const embeddingConfig = inst.lookup('embeddingConfig');
    const { documentFetcher } = await import('./services/documentFetcher.js');
    await documentFetcher.fetchDocument({
      title,
      url,
      retrievalConfig,
      embeddingConfig,
    });
    return;
  }

  const s = await fetchDoc(url);
  if (s) {
    const title = inst.lookup('title');
    const doc = makeInstance(
      CoreAIModuleName,
      'Document',
      newInstanceAttributes().set('title', title).set('content', s)
    );
    await computeExprAttributes(doc, undefined, undefined, env);
    await setMetaAttributes(doc.attributes, env);
    const res: Resolver = await getResolverForPath('Document', CoreAIModuleName, env);
    await res.createInstance(doc);
  }
}

export async function handleMcpEvent(inst: Instance, env: Environment): Promise<void> {
  const mcpClientName = mcpClientNameFromToolEvent(inst);
  const clientInsts: Instance[] = await parseAndEvaluateStatement(
    `{agentlang.mcp/Client {name? "${mcpClientName}"}}`,
    undefined,
    env
  );
  const result = await callMcpTool(clientInsts[0], inst);
  env.setLastResult(result);
}

async function computeExprAttributes(
  inst: Instance,
  origAttrs: SetAttribute[] | undefined,
  updatedAttrs: InstanceAttributes | undefined,
  env: Environment
) {
  const exprAttrs = inst.getExprAttributes();
  if (exprAttrs || origAttrs) {
    const newEnv = new Environment('expr-env', env);
    inst.attributes.forEach((v: any, k: string) => {
      if (v !== undefined) newEnv.bind(k, v);
    });
    updatedAttrs?.forEach((v: any, k: string) => {
      if (v !== undefined) newEnv.bind(k, v);
    });
    if (exprAttrs) {
      const ks = [...exprAttrs.keys()];
      for (let i = 0; i < ks.length; ++i) {
        const n = ks[i];
        const expr: Expr | undefined = exprAttrs.get(n);
        if (expr) {
          await evaluateExpression(expr, newEnv);
          const v: Result = newEnv.getLastResult();
          newEnv.bind(n, v);
          inst.attributes.set(n, v);
          updatedAttrs?.set(n, v);
        }
      }
    }
    if (origAttrs && updatedAttrs) {
      for (let i = 0; i < origAttrs.length; ++i) {
        const a: SetAttribute = origAttrs[i];
        const n = a.name;
        if (!n.endsWith(QuerySuffix) && updatedAttrs.has(n) && a.value !== undefined) {
          await evaluateExpression(a.value, newEnv);
          const v: Result = newEnv.getLastResult();
          updatedAttrs.set(n, v);
          newEnv.bind(n, v);
        }
      }
    }
  }
}

async function evalWhereClauses(whereSpec: WhereSpec, env: Environment): Promise<WhereClause[]> {
  const result = new Array<WhereClause>();
  const e = new Environment(undefined, env);
  for (let i = 0; i < whereSpec.clauses.length; ++i) {
    const c = whereSpec.clauses[i];
    await evaluateExpression(c.rhs, e);
    result.push({
      attrName: escapeQueryName(c.lhs),
      op: c.op === undefined ? '=' : c.op,
      qval: e.getLastResult(),
    });
  }
  return result;
}

async function evaluateJoinQuery(
  joinSpec: JoinSpec[],
  intoSpec: SelectIntoSpec,
  whereSpec: WhereSpec | undefined,
  inst: Instance,
  distinct: boolean,
  env: Environment
): Promise<void> {
  const normIntoSpec = new Map<string, string>();
  let aggregates: Map<string, AggregateFunctionCall> | undefined;
  intoSpec.entries.forEach((entry: SelectIntoEntry) => {
    if (entry.attribute !== undefined) normIntoSpec.set(entry.alias, entry.attribute);
    else {
      if (aggregates === undefined) aggregates = new Map<string, AggregateFunctionCall>();
      if (entry.aggregate !== undefined) aggregates?.set(entry.alias, entry.aggregate);
    }
  });
  if (aggregates !== undefined) {
    inst.setAggregates(aggregates);
  }
  const clauses = whereSpec ? await evalWhereClauses(whereSpec, env) : undefined;
  const resolver = await getResolverForPath(inst.name, inst.moduleName, env);
  const result: Result = await resolver.queryByJoin(
    inst,
    [],
    normIntoSpec,
    distinct,
    joinSpec,
    clauses
  );

  const transformedResult = transformDateFieldsInJoinResult(result);

  env.setLastResult(transformedResult);
}

async function evaluateJoinQueryWithRelationships(
  intoSpec: SelectIntoSpec,
  inst: Instance,
  relationships: RelationshipPattern[],
  distinct: boolean,
  env: Environment
): Promise<void> {
  const normIntoSpec = new Map<string, string>();
  let aggregates: Map<string, AggregateFunctionCall> | undefined;
  intoSpec.entries.forEach((entry: SelectIntoEntry) => {
    if (entry.attribute !== undefined) normIntoSpec.set(entry.alias, entry.attribute);
    else {
      if (aggregates === undefined) aggregates = new Map<string, AggregateFunctionCall>();
      if (entry.aggregate !== undefined) aggregates?.set(entry.alias, entry.aggregate);
    }
  });
  if (aggregates !== undefined) {
    inst.setAggregates(aggregates);
  }
  const moduleName = inst.moduleName;
  let joinsSpec = new Array<JoinInfo>();
  for (let i = 0; i < relationships.length; ++i) {
    joinsSpec = await walkJoinQueryPattern(relationships[i], joinsSpec, env);
  }
  const resolver = await getResolverForPath(inst.name, moduleName, env);
  const result: Result = await resolver.queryByJoin(inst, joinsSpec, normIntoSpec, distinct);

  const transformedResult = transformDateFieldsInJoinResult(result);

  env.setLastResult(transformedResult);
}

function transformDateFieldsInJoinResult(result: any): any {
  if (!result || !Array.isArray(result)) {
    return result;
  }
  return result.map((row: any) => {
    if (typeof row !== 'object' || row === null) {
      return row;
    }

    for (const [key, value] of Object.entries(row)) {
      if (value && value instanceof Date) {
        if (value instanceof Date) {
          row[key] = value.toLocaleDateString('en-CA');
        }
      }
    }

    return row;
  });
}

async function walkJoinQueryPattern(
  rp: RelationshipPattern,
  joinsSpec: JoinInfo[],
  env: Environment
): Promise<JoinInfo[]> {
  const crudMap = rp.pattern.crudMap;
  if (crudMap) {
    let subJoins: JoinInfo[] | undefined;
    if (crudMap.relationships && crudMap.relationships.length > 0) {
      subJoins = new Array<JoinInfo>();
      for (let i = 0; i < crudMap.relationships.length; ++i) {
        await walkJoinQueryPattern(crudMap.relationships[i], subJoins, env);
      }
    }
    const qInst = await patternToInstance(crudMap.name, crudMap.body?.attributes, env);
    joinsSpec.push({
      relationship: getRelationship(rp.name, qInst.moduleName),
      queryInstance: qInst,
      subJoins: subJoins,
    });
    return joinsSpec;
  } else {
    throw new Error(`Expected a query for relationship ${rp.name}`);
  }
}

const MAX_PLANNER_RETRIES = 3;

async function agentInvoke(agent: AgentInstance, msg: string, env: Environment): Promise<void> {
  // log invocation details
  let invokeDebugMsg = `\nInvoking agent ${agent.name}:`;
  if (agent.role) {
    invokeDebugMsg = `${invokeDebugMsg} Role=${agent.role}`;
  }
  console.debug(invokeDebugMsg);
  invokeDebugMsg = `\nMessage=${msg}`;
  console.debug(invokeDebugMsg);
  //

  const monitoringEnabled = isMonitoringEnabled();

  await agent.invoke(msg, env);
  let result: string | undefined = env.getLastResult();
  logger.debug(`Agent ${agent.name} result: ${result}`);

  const isPlanner = !env.isInAgentChatMode() && agent.isPlanner();
  const stmtsExec = env.getStatementsExecutor();
  let agentInternalError: string | undefined;
  if (result) {
    if (isPlanner) {
      if (monitoringEnabled) {
        env.incrementMonitor();
      }
      let retries = 0;
      while (true) {
        try {
          let rs: string = result ? normalizeGeneratedCode(result) : '';
          let isWf = rs.startsWith('workflow');
          if (isWf && !agent.runWorkflows) {
            await parseWorkflow(rs);
            return;
          }
          const isGrp = rs.startsWith('[');
          if (!isWf && !isGrp && rs.indexOf(';') > 0) {
            rs = `workflow T {${rs}}`;
            isWf = true;
          } else if (!isWf && isGrp) {
            const stmts = rs.substring(1, rs.length - 1);
            rs = `workflow T {${stmts}}`;
            isWf = true;
          }
          if (isWf) {
            const wf = await parseWorkflow(normalizeGeneratedCode(rs));
            if (stmtsExec) {
              await stmtsExec(wf.statements, env);
            } else {
              await evaluateStatements(wf.statements, env);
            }
          } else {
            if (stmtsExec) {
              const stmt = await parseStatement(rs);
              const r = await stmtsExec([stmt], env);
              env.setLastResult(r);
            } else {
              env.setLastResult(
                await parseAndEvaluateStatement(normalizeGeneratedCode(rs), undefined, env)
              );
            }
          }
          agent.maybeAddScratchData(env);
          break;
        } catch (err: any) {
          if (retries < MAX_PLANNER_RETRIES) {
            await agent.invoke(
              `For my previouns request <${msg}>, you generated this pattern: ${result}. It had these errors: ${err}. Please fix these errors.\nReturn only the fixed code and no other additional text or messages.`,
              env
            );
            const r: string | undefined = env.getLastResult();
            result = r;
            ++retries;
          } else {
            agentInternalError = `Failed to evaluate pattern generated by agent ${agent.name} - ${result}, ${err}`;
            if (monitoringEnabled) env.setMonitorEntryError(agentInternalError);
            break;
          }
        }
      }
      if (monitoringEnabled) env.decrementMonitor();
    } else {
      let retries = 0;
      while (true) {
        try {
          result = normalizeGeneratedCode(result);
          const obj = agent.maybeValidateJsonResponse(result);
          if (obj !== undefined) {
            env.setLastResult(obj);
            env.addToScratchPad(Agent.NormalizeName(agent.getFqName()), obj);
          }
          break;
        } catch (err: any) {
          if (retries < MAX_PLANNER_RETRIES) {
            await agent.invoke(
              `Please fix these errors:\n ${err}\nReturn only the fixed response and no other additional text or messages.`,
              env
            );
            const r: string | undefined = env.getLastResult();
            result = r;
            ++retries;
          } else {
            agentInternalError = `Failed to validate JSON response generated by agent ${agent.name} - ${result}, ${err}`;
            logger.error(agentInternalError);
            if (monitoringEnabled) env.setMonitorEntryError(agentInternalError);
            break;
          }
        }
      }
    }
  } else {
    throw new Error(`Agent ${agent.name} failed to generate a response`);
  }
  if (agentInternalError !== undefined) {
    throw new Error(agentInternalError);
  }
}

export async function handleAgentInvocation(
  agentEventInst: Instance,
  env: Environment
): Promise<void> {
  const agent: AgentInstance = await findAgentByName(agentEventInst.name, env);
  const chatId = agentEventInst.lookup('chatId');
  if (chatId) {
    env.setActiveChatId(chatId);
  }
  const origMsg: any =
    agentEventInst.lookup('message') || JSON.stringify(agentEventInst.asObject());
  const msg: string = isString(origMsg) ? origMsg : maybeInstanceAsString(origMsg);
  const flow = getAgentFlow(agent.name, agent.moduleName);
  if (flow) {
    await handleAgentInvocationWithFlow(agent, flow, msg, env);
  } else {
    const mode = agentEventInst.lookup('mode');
    let activeEnv = env;
    if (chatId !== undefined) {
      activeEnv.setAgentChatId(chatId);
    }
    let envChanged = false;
    if (mode !== undefined) {
      if (mode === 'chat') {
        activeEnv = new Environment(`${env.name}.chat`, env).inChatAgentMode();
        envChanged = true;
      } else if (mode === 'planner') {
        activeEnv = new Environment(`${env.name}.planner`, env).inPlannerAgentMode();
        envChanged = true;
      }
    }
    await agentInvoke(agent, msg, activeEnv);
    if (envChanged) {
      env.setLastResult(activeEnv.getLastResult());
    }
  }
}

async function handleAgentInvocationWithFlow(
  rootAgent: AgentInstance,
  flow: FlowSpec,
  msg: string,
  env: Environment
): Promise<void> {
  rootAgent.markAsFlowExecutor();
  await iterateOnFlow(flow, rootAgent, msg, env);
  env.resetScratchPad();
}

async function saveFlowSuspension(
  agent: AgentInstance,
  context: string,
  step: FlowStep,
  env: Environment
): Promise<void> {
  const spad = env.getScratchPad() || {};
  const suspId = await createSuspension(
    env.getSuspensionId(),
    [FlowSuspensionTag, agent.name, step, context, JSON.stringify(spad)],
    env
  );
  env.setLastResult({ suspension: suspId || 'null' });
}

export async function restartFlow(
  flowContext: string[],
  userData: string,
  env: Environment
): Promise<void> {
  const [_, agentName, step, ctx, spad] = flowContext;
  const rootAgent: AgentInstance = await findAgentByName(agentName, env);
  const flow = getAgentFlow(agentName, rootAgent.moduleName);
  if (flow) {
    const newCtx = `${ctx}\nRestart the flow at ${step} using the following user-input as additional guidance:\n${userData}\n`;
    env.setScratchPad(JSON.parse(spad));
    await iterateOnFlow(flow, rootAgent, newCtx, env);
  }
}

const MaxFlowSteps = 25;
const MaxFlowRetries = 10;

async function iterateOnFlow(
  flow: FlowSpec,
  rootAgent: AgentInstance,
  msg: string,
  env: Environment
): Promise<void> {
  rootAgent.disableSession();
  const chatId = env.getActiveEventInstance()?.lookup('chatId');
  const iterId = chatId || crypto.randomUUID();
  let step = '';
  let fullFlowRetries = 0;
  while (true) {
    try {
      const initContext = msg;
      const s = `Now consider the following flowchart and return the next step:\n${flow}\n
  If you understand from the context that a step with no further possible steps has been evaluated,
  terminate the flowchart by returning DONE. Never return to the top or root step of the flowchart, instead return DONE.
  Important: Return only the next flow-step or DONE. Do not return any additional description, like your thinking process.\n`;
      env.setFlowContext(initContext);
      await agentInvoke(rootAgent, s, env);
      const rootModuleName = rootAgent.moduleName;
      let preprocResult = await preprocessStep(env.getLastResult(), rootModuleName, env);
      step = preprocResult.step;
      let needAgentProcessing = preprocResult.needAgentProcessing;
      let context = initContext;
      let stepc = 0;
      console.debug(`Starting iteration ${iterId} on flow: ${flow}`);
      const executedSteps = new Set<string>();
      const monitoringEnabled = isMonitoringEnabled();
      let isfxc = false;
      if (monitoringEnabled) {
        env.flagMonitorEntryAsFlow().incrementMonitor();
      }
      while (step != 'DONE' && !executedSteps.has(step)) {
        if (stepc > MaxFlowSteps) {
          throw new Error(`Flow execution exceeded maximum steps limit`);
        }
        executedSteps.add(step);
        ++stepc;
        const agent = needAgentProcessing
          ? AgentInstance.FromFlowStep(step, rootAgent, context)
          : undefined;
        if (agent) {
          console.debug(
            `Starting to execute flow step ${step} with agent ${agent.name} with iteration ID ${iterId} and context: \n${context}`
          );
          isfxc = agent.isFlowExecutor();
          const isdec = agent.isDecisionExecutor();
          if (isfxc || isdec) env.setFlowContext(context);
          else env.setFlowContext(initContext);
          if (monitoringEnabled) {
            env.appendEntryToMonitor(step);
          }
          const inst = agent.swapInstruction('');
          await agentInvoke(agent, inst, env);
        } else {
          rootAgent.maybeAddScratchData(env);
        }
        if (monitoringEnabled) env.setMonitorEntryResult(env.getLastResult());
        if (env.isSuspended()) {
          console.debug(`${iterId} suspending iteration on step ${step}`);
          await saveFlowSuspension(rootAgent, context, step, env);
          env.releaseSuspension();
          return;
        }
        const r = env.getLastResult();
        const rs = maybeInstanceAsString(r);
        console.debug(
          `\n----> Completed execution of step ${step}, iteration id ${iterId} with result:\n${rs}`
        );
        context = `${context}\n${step} --> ${rs}\n`;
        if (chatId) {
          const suspEnv = new Environment(env.name, env);
          suspEnv.softSuspend();
          await saveFlowSuspension(rootAgent, context, step, suspEnv);
          await saveFlowStepResult(chatId, step, rs, suspEnv.getSuspensionId(), env);
        }
        if (isfxc) {
          preprocResult = await preprocessStep(rs, rootModuleName, env);
        } else {
          env.setFlowContext(context);
          await agentInvoke(rootAgent, `${s}\n${context}`, env);
          preprocResult = await preprocessStep(env.getLastResult(), rootModuleName, env);
        }
        step = preprocResult.step;
        needAgentProcessing = preprocResult.needAgentProcessing;
      }
    } catch (reason: any) {
      if (fullFlowRetries < MaxFlowRetries) {
        msg = `The previous attempt failed at step ${step} with the error ${reason}. Restart the flow the appropriate step
(maybe even from the first step) and try to fix the issue.`;
        ++fullFlowRetries;
        continue;
      } else {
        throw new Error(reason);
      }
    } finally {
      env.decrementMonitor().revokeLastResult().setMonitorFlowResult();
    }
    console.debug(`No more flow steps, completed iteration ${iterId} on flow:\n${flow}`);
    break;
  }
}

type PreprocStepResult = {
  step: string;
  needAgentProcessing: boolean;
};

async function preprocessStep(
  spec: string,
  activeModuleName: string,
  env: Environment
): Promise<PreprocStepResult> {
  let needAgentProcessing = true;
  spec = normalizeGeneratedCode(spec);
  if (spec.startsWith('{') || spec.indexOf(' ') > 0) {
    const newEnv = Environment.from(env, env.name + '_flow_eval', false, true).setActiveModuleName(
      activeModuleName
    );
    const r = await parseAndEvaluateStatement(spec, undefined, newEnv);
    env.setLastResult(r);
    needAgentProcessing = false;
  }
  return { step: spec, needAgentProcessing };
}

export async function handleOpenApiEvent(eventInst: Instance, env: Environment): Promise<void> {
  const r = await invokeOpenApiEvent(
    eventInst.moduleName,
    eventInst.name,
    eventInst.attributesAsObject()
  );
  env.setLastResult(r);
}

async function evaluateUpsert(crud: CrudMap, env: Environment): Promise<void> {
  env.setInUpsertMode(true);
  try {
    await evaluateCrudMap(crud, env);
  } finally {
    env.setInUpsertMode(false);
  }
}

async function evaluateForEach(forEach: ForEach, env: Environment): Promise<void> {
  const loopVar: string = forEach.var;
  await evaluatePattern(forEach.src, env);
  const src: Result = env.getLastResult();
  if (src instanceof Array && src.length > 0) {
    const loopEnv: Environment = Environment.from(env);
    const finalResult = new Array<any>();
    for (let i = 0; i < src.length; ++i) {
      loopEnv.bind(loopVar, src[i]);
      await evaluateStatements(forEach.statements, loopEnv);
      finalResult.push(loopEnv.getLastResult());
    }
    env.setLastResult(finalResult);
  } else {
    env.setLastResult(EmptyResult);
  }
}

async function evaluateIf(ifStmt: If, env: Environment): Promise<void> {
  await evaluateExpression(ifStmt.cond, env);
  if (env.getLastResult()) {
    await evaluateStatements(ifStmt.statements, env);
  } else if (ifStmt.else !== undefined) {
    await evaluateStatements(ifStmt.else.statements, env);
  }
}

async function evaluateIfWithAlias(ifWithAlias: IfWithAlias, env: Environment): Promise<void> {
  await evaluateIf(ifWithAlias.if, env);
}

async function evaluateDeleteHelper(
  pattern: Pattern,
  purge: boolean,
  env: Environment
): Promise<void> {
  const newEnv = Environment.from(env).setInDeleteMode(true);
  await evaluatePattern(pattern, newEnv);
  await maybeDeleteQueriedInstances(newEnv, env, purge);
}

export async function maybeDeleteQueriedInstances(
  queryEnv: Environment,
  env: Environment,
  purge: boolean = false
): Promise<void> {
  const inst: Instance[] | Instance = queryEnv.getLastResult();
  let resolver: Resolver = Resolver.Default;
  if (inst instanceof Array) {
    if (inst.length > 0) {
      if (isOneToOneBetweenRelationship(inst[0].name, inst[0].moduleName)) {
        // delete already handled in evaluateCrudMap
        env.setLastResult(inst);
        return;
      }
      resolver = await getResolverForPath(inst[0].name, inst[0].moduleName, queryEnv);
      const finalResult: Array<any> = new Array<any>();
      for (let i = 0; i < inst.length; ++i) {
        await runPreDeleteEvents(inst[i], env);
        const r: any = await resolver.deleteInstance(inst[i], purge);
        await runPostDeleteEvents(inst[i], env);
        finalResult.push(r);
      }
      queryEnv.setLastResult(finalResult);
    } else {
      queryEnv.setLastResult(inst);
    }
  } else {
    if (isOneToOneBetweenRelationship(inst.name, inst.moduleName)) {
      // delete already handled in evaluateCrudMap
      env.setLastResult([inst]);
      return;
    }
    resolver = await getResolverForPath(inst.name, inst.moduleName, queryEnv);
    await runPreDeleteEvents(inst, env);
    const r: Instance | null = await resolver.deleteInstance(inst, purge);
    await runPostDeleteEvents(inst, env);
    queryEnv.setLastResult(r);
  }
  env.setLastResult(queryEnv.getLastResult());
}

async function evaluateDelete(delStmt: Delete, env: Environment): Promise<void> {
  await evaluateDeleteHelper(delStmt.pattern, false, env);
}

async function evaluatePurge(purgeStmt: Purge, env: Environment): Promise<void> {
  await evaluateDeleteHelper(purgeStmt.pattern, true, env);
}

export async function evaluateExpression(expr: Expr, env: Environment): Promise<void> {
  let result: Result = EmptyResult;
  if (isBinExpr(expr)) {
    await evaluateExpression(expr.e1, env);
    const v1 = env.getLastResult();
    if (expr.op == 'or') {
      if (v1) return;
      await evaluateExpression(expr.e2, env);
      return;
    } else if (expr.op == 'and') {
      if (!v1) return;
      await evaluateExpression(expr.e2, env);
      return;
    }
    if (v1 === null || v1 === undefined) {
      env.setLastResult(undefined);
      return;
    }
    await evaluateExpression(expr.e2, env);
    const v2 = env.getLastResult();
    if (v2 === null || v2 === undefined) {
      env.setLastResult(undefined);
      return;
    }
    switch (expr.op) {
      // arithmetic operators
      case '+':
        result = v1 + v2;
        break;
      case '-':
        result = v1 - v2;
        break;
      case '*':
        result = v1 * v2;
        break;
      case '/':
        result = v1 / v2;
        break;
      // comparison operators
      case '==':
        result = v1 == v2;
        break;
      case '<':
        result = v1 < v2;
        break;
      case '>':
        result = v1 > v2;
        break;
      case '<=':
        result = v1 <= v2;
        break;
      case '>=':
        result = v1 >= v2;
        break;
      case '<>':
      case '!=':
        result = v1 != v2;
        break;
      case 'like':
        result = v1.startsWith(v2);
        break;
      case 'in':
        result = v2.find((x: any) => {
          x == v1;
        });
        break;
      default:
        throw new Error(`Unrecognized binary operator: ${expr.op}`);
    }
  } else if (isNegExpr(expr)) {
    await evaluateExpression(expr.ne, env);
    result = -1 * env.getLastResult();
  } else if (isGroup(expr)) {
    await evaluateExpression(expr.ge, env);
    result = env.getLastResult();
  } else if (isLiteral(expr)) {
    await evaluateLiteral(expr, env);
    return;
  } else if (isNotExpr(expr)) {
    await evaluateExpression(expr.ne, env);
    result = !env.getLastResult();
  }
  env.setLastResult(result);
}

async function getRef(r: string, src: any, env: Environment): Promise<Result> {
  if (Instance.IsInstance(src)) return src.lookup(r);
  else if (src instanceof Map) return src.get(r);
  else if (src instanceof Object) return src[r];
  else if (isPath(src)) return await getRef(r, await dereferencePath(src, env), env);
  else return undefined;
}

async function followReference(env: Environment, s: string): Promise<Result> {
  const refs: string[] = splitRefs(s);
  let result: Result = EmptyResult;
  let src: any = env;
  for (let i = 0; i < refs.length; ++i) {
    const r: string = refs[i];
    const v: Result | undefined = await getRef(r, src, env);
    if (v === undefined || v === null) {
      result = EmptyResult;
      break;
    }
    result = v;
    src = result;
  }
  if (result === EmptyResult) {
    result = getModuleDef(s);
    if (result === undefined) {
      result = EmptyResult;
    }
  }
  return result;
}

async function dereferencePath(path: string, env: Environment): Promise<Result> {
  const fqName = fqNameFromPath(path);
  if (fqName === undefined) {
    throw new Error(`Failed to deduce entry-name from path - ${path}`);
  }
  const newEnv = new Environment('path-deref', env);
  await parseAndEvaluateStatement(
    `{${fqName} {${PathAttributeNameQuery} "${path}"}}`,
    env.getAuthContextUserId(),
    newEnv
  );
  const result: Result = newEnv.getLastResult();
  if (result && result instanceof Array && result.length > 0) {
    return result[0];
  }
  return undefined;
}

async function applyFn(fnCall: FnCall, env: Environment, isAsync: boolean): Promise<void> {
  const fnName: string | undefined = fnCall.name;
  if (fnName !== undefined) {
    let args: Array<Result> | null = null;
    if (fnCall.args !== undefined) {
      args = new Array<Result>();
      for (let i = 0; i < fnCall.args.length; ++i) {
        const arg = fnCall.args[i];
        if (isLiteral(arg)) {
          await evaluateLiteral(arg, env);
        } else {
          await evaluateExpression(arg, env);
        }
        args.push(env.getLastResult());
      }
      args.push(env);
    }
    const r: Result = await invokeModuleFn(fnName, args, isAsync);
    env.setLastResult(r);
  }
}

async function realizeArray(array: ArrayLiteral, env: Environment): Promise<void> {
  const result: Array<Result> = new Array<Result>();
  for (let i = 0; i < array.vals.length; ++i) {
    await evaluateStatement(array.vals[i], env);
    result.push(env.getLastResult());
  }
  env.setLastResult(result);
}

async function realizeMap(mapLiteral: MapLiteral, env: Environment): Promise<void> {
  const result: Map<string, Result> = new Map();
  for (let i = 0; i < mapLiteral.entries.length; ++i) {
    const entry = mapLiteral.entries[i];
    const k = getMapKey(entry.key);
    await evaluateExpression(entry.value, env);
    result.set(k, env.getLastResult());
  }
  env.setLastResult(Object.fromEntries(result.entries()));
}

export async function callPostEventOnSubscription(
  crudType: CrudType,
  inst: Instance,
  env?: Environment
): Promise<any> {
  const localEnv = env === undefined;
  const newEnv = env ? env : new Environment('onSubs.env');
  try {
    await runPrePostEvents(crudType, false, inst, newEnv);
    if (localEnv) {
      await newEnv.commitAllTransactions();
    }
    return newEnv.getLastResult();
  } catch (reason: any) {
    if (localEnv) {
      await newEnv.rollbackAllTransactions();
      logger.error(
        `callPostEventOnSubscription failed for ${crudType} ${inst.getFqName()} - ${reason}`
      );
    }
  }
  return undefined;
}

async function runPrePostEvents(
  crudType: CrudType,
  pre: boolean,
  inst: Instance,
  env: Environment
) {
  const trigInfo = pre
    ? inst.record.getPreTriggerInfo(crudType)
    : inst.record.getPostTriggerInfo(crudType);
  if (trigInfo) {
    const p = nameToPath(trigInfo.eventName);
    const moduleName = p.hasModule() ? p.getModuleName() : inst.record.moduleName;
    const eventInst: Instance = makeInstance(
      moduleName,
      p.getEntryName(),
      newInstanceAttributes().set(inst.record.name, inst)
    );
    const authContext = env.getActiveAuthContext();
    if (authContext) eventInst.setAuthContext(authContext);
    const prefix = `${pre ? 'Pre' : 'Post'}-${CrudType[crudType]} ${inst.record.getFqName()}`;
    const callback = (value: Result) => {
      logger.debug(`${prefix}: ${value}`);
    };
    const catchHandler = (reason: any) => {
      if (env.hasHandlers()) {
        throw reason;
      } else {
        throw new Error(`${prefix}: ${reason}`);
      }
    };
    if (trigInfo.async) {
      evaluate(eventInst, callback, bindAliasesForPrePost(env, inst, prefix)).catch(catchHandler);
    } else {
      await evaluate(eventInst, callback, bindAliasesForPrePost(env, inst, prefix)).catch(
        catchHandler
      );
    }
  }
}

function bindAliasesForPrePost(env: Environment, inst: Instance, prefix: string): Environment {
  const newEnv = new Environment(`${prefix}.env`, env);
  const fullAlias = inst.getFqName();
  newEnv.bind('this', inst);
  newEnv.bind(fullAlias, inst);
  newEnv.bind(inst.name, inst);
  return newEnv;
}

async function runPreCreateEvents(inst: Instance, env: Environment) {
  await runPrePostEvents(CrudType.CREATE, true, inst, env);
}

export async function runPostCreateEvents(inst: Instance, env: Environment) {
  if (inst.requireAudit()) {
    await addCreateAudit(inst.getPath(), env, { original: inst.userAttributesAsObject() });
  }
  await runPrePostEvents(CrudType.CREATE, false, inst, env);
}

async function runPreUpdateEvents(inst: Instance, env: Environment) {
  await runPrePostEvents(CrudType.UPDATE, true, inst, env);
}

export async function runPostUpdateEvents(
  inst: Instance,
  oldInst: Instance | undefined,
  env: Environment
) {
  if (inst.requireAudit()) {
    let diff: object | undefined;
    if (oldInst !== undefined) {
      const oldAttrs = oldInst.userAttributesAsObject();
      const d = detailedDiff(oldAttrs, inst.userAttributesAsObject());
      diff = { original: oldAttrs, updated: d.updated };
    }
    await addUpdateAudit(inst.getPath(), diff, env);
  }
  await runPrePostEvents(CrudType.UPDATE, false, inst, env);
}

async function runPreDeleteEvents(inst: Instance, env: Environment) {
  await runPrePostEvents(CrudType.DELETE, true, inst, env);
}

export async function runPostDeleteEvents(inst: Instance, env: Environment) {
  if (inst.requireAudit()) {
    await addDeleteAudit(inst.getPath(), { deleted: inst.userAttributesAsObject() }, env);
  }
  await runPrePostEvents(CrudType.DELETE, false, inst, env);
}

export async function fetchConfig(configEntityName: string): Promise<any> {
  const rs: Instance[] | null = await parseAndEvaluateStatement(`{${configEntityName}? {}}`);
  if (rs && rs !== null && rs.length > 0) {
    return preprocessRawConfig(Object.fromEntries(rs[0].attributes));
  }
  return undefined;
}
