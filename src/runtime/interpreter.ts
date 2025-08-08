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
  isBinExpr,
  isGroup,
  isLiteral,
  isNegExpr,
  isNotExpr,
  isReturn,
  Literal,
  MapKey,
  MapLiteral,
  Pattern,
  Purge,
  RelationshipPattern,
  RuntimeHint,
  SelectIntoEntry,
  SelectIntoSpec,
  SetAttribute,
  Statement,
} from '../language/generated/ast.js';
import {
  defineAgentEvent,
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
  isTimer,
  makeInstance,
  newInstanceAttributes,
  PlaceholderRecordEntry,
  Relationship,
  Workflow,
} from './module.js';
import { JoinInfo, Resolver, ResolverAuthInfo } from './resolvers/interface.js';
import { SqlDbResolver } from './resolvers/sqldb/impl.js';
import {
  CrudType,
  DefaultModuleName,
  escapeFqName,
  escapeQueryName,
  escapeSpecialChars,
  fqNameFromPath,
  isFqName,
  isPath,
  isString,
  makeFqName,
  Path,
  QuerySuffix,
  restoreSpecialChars,
  splitFqName,
  splitRefs,
} from './util.js';
import { getResolver, getResolverNameForPath } from './resolvers/registry.js';
import { parseStatement, parseWorkflow } from '../language/parser.js';
import { ActiveSessionInfo, AdminSession, AdminUserId } from './auth/defs.js';
import { AgentInstance, AgentEntityName, AgentFqName, findAgentByName } from './modules/ai.js';
import { logger } from './logger.js';
import { ParentAttributeName, PathAttributeName, PathAttributeNameQuery } from './defs.js';
import {
  addCreateAudit,
  addDeleteAudit,
  addUpdateAudit,
  createSuspension,
  maybeCancelTimer,
  setTimerRunning,
} from './modules/core.js';
import { invokeModuleFn } from './jsmodules.js';

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
  private activeCatchHandlers: Array<CatchHandlers>;

  constructor(name?: string, parent?: Environment) {
    super(
      PlaceholderRecordEntry,
      DefaultModuleName,
      mkEnvName(name, parent),
      newInstanceAttributes()
    );
    if (parent != undefined) {
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
    } else {
      this.activeModule = DefaultModuleName;
      this.activeResolvers = new Map<string, Resolver>();
      this.activeTransactions = new Map<string, string>();
      this.activeCatchHandlers = new Array<CatchHandlers>();
    }
  }

  static from(parent: Environment): Environment {
    return new Environment(undefined, parent);
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
    if (v == undefined) {
      if (this.parent != undefined) {
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
    return this.suspensionId != undefined;
  }

  suspend(): string {
    if (this.suspensionId == undefined) {
      const id = crypto.randomUUID();
      this.propagateSuspension(id);
      return id;
    } else {
      return this.suspensionId;
    }
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
    this.lastResult = result;
    return this;
  }

  getLastResult(): Result {
    return this.lastResult;
  }

  getActiveModuleName(): string {
    return this.activeModule;
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
    if (r == undefined) {
      throw new Error(`No more handlers to pop`);
    }
    return r;
  }
}

export const GlobalEnvironment = new Environment();

export async function evaluate(
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
        if (kernelCall) {
          env.setInKernelMode(true);
        }
        await evaluateStatements(wf.statements, env, continuation);
        return env.getLastResult();
      }
    } else {
      throw new Error('Not an event - ' + eventInstance.name);
    }
  } catch (err) {
    if (env && env.hasHandlers()) {
      throw err;
    } else {
      if (env != undefined && activeEnv == undefined) {
        await env.rollbackAllTransactions().then(() => {
          txnRolledBack = true;
        });
      }
      throw err;
    }
  } finally {
    if (!txnRolledBack && env != undefined && activeEnv == undefined) {
      await env.commitAllTransactions();
    }
  }
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

function statemtentString(stmt: Statement): string {
  if (stmt.$cstNode) {
    return stmt.$cstNode.text;
  } else {
    throw new Error(`Failed to fetch text for statement - ${stmt}`);
  }
}

async function saveSuspension(cont: Statement[], env: Environment) {
  if (cont.length > 0) {
    const suspId = await createSuspension(
      env.getSuspensionId(),
      cont.map((stmt: Statement) => {
        return statemtentString(stmt);
      }),
      env
    );
    env.setLastResult({ suspension: suspId || 'null' });
  }
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
  if (continuation != undefined) {
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
      await saveSuspension(thenStmts, env);
    } else {
      await evaluateStatements(thenStmts, env);
    }
  } catch (reason: any) {
    await maybeHandleError(handlers, reason, env);
  }
}

async function evaluateStatement(stmt: Statement, env: Environment): Promise<void> {
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
      new Environment(env.name + 'async', env)
    );
    if (isReturn(stmt.pattern)) {
      env.markForReturn();
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
    lastResult == null ||
    lastResult == undefined ||
    (lastResult instanceof Array && lastResult.length == 0)
  ) {
    const onNotFound = handlers ? handlers.get('not_found') : undefined;
    if (onNotFound) {
      await evaluateStatement(onNotFound, env);
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
    await evaluateStatement(handler, env);
  } else {
    throw reason;
  }
}

function maybeBindStatementResultToAlias(hints: RuntimeHint[], env: Environment) {
  for (let i = 0; i < hints.length; ++i) {
    const rh = hints[i];
    if (rh.aliasSpec) {
      if (rh.aliasSpec.alias != undefined || rh.aliasSpec.aliases.length > 0) {
        const result: Result = env.getLastResult();
        const alias: string | undefined = rh.aliasSpec.alias;
        if (alias != undefined) {
          env.bind(alias, result);
        } else {
          const aliases: string[] = rh.aliasSpec.aliases;
          if (result instanceof Array) {
            const resArr: Array<any> = result as Array<any>;
            for (let i = 0; i < aliases.length; ++i) {
              const k: string = aliases[i];
              if (k == '_') {
                env.bind(aliases[i + 1], resArr.splice(i));
                break;
              } else {
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

export async function parseAndEvaluateStatement(
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
}

async function evaluatePattern(pat: Pattern, env: Environment): Promise<void> {
  if (pat.expr) {
    await evaluateExpression(pat.expr, env);
  } else if (pat.crudMap) {
    await evaluateCrudMap(pat.crudMap, env);
  } else if (pat.forEach) {
    await evaluateForEach(pat.forEach, env);
  } else if (pat.if) {
    await evaluateIf(pat.if, env);
  } else if (pat.delete) {
    await evaluateDelete(pat.delete, env);
  } else if (pat.purge) {
    await evaluatePurge(pat.purge, env);
  } else if (pat.fullTextSearch) {
    await evaluateFullTextSearch(pat.fullTextSearch, env);
  } else if (pat.return) {
    await evaluatePattern(pat.return.pat, env);
    env.markForReturn();
  }
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
  const path = splitFqName(n);
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
  if (lit.id != undefined) env.setLastResult(env.lookup(lit.id));
  else if (lit.ref != undefined) env.setLastResult(await followReference(env, lit.ref));
  else if (lit.fnCall != undefined) await applyFn(lit.fnCall, env, false);
  else if (lit.asyncFnCall != undefined) await applyFn(lit.asyncFnCall.fnCall, env, true);
  else if (lit.array != undefined) await realizeArray(lit.array, env);
  else if (lit.map != undefined) await realizeMap(lit.map, env);
  else if (lit.num != undefined) env.setLastResult(lit.num);
  else if (lit.str != undefined) env.setLastResult(restoreSpecialChars(lit.str));
  else if (lit.bool != undefined) env.setLastResult(lit.bool == 'true' ? true : false);
}

function getMapKey(k: MapKey): Result {
  if (k.str != undefined) return k.str;
  else if (k.num != undefined) return k.num;
  else if (k.bool != undefined) k.bool == 'true' ? true : false;
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
  if (resN == undefined) {
    res = env.getResolver(DefaultResolverName);
    if (res == undefined) {
      res = new SqlDbResolver(DefaultResolverName);
      await env.addResolver(res);
    }
  } else {
    res = env.getResolver(resN);
    if (res == undefined) {
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

async function patternToInstance(
  entryName: string,
  attributes: SetAttribute[] | undefined,
  env: Environment
): Promise<Instance> {
  const attrs: InstanceAttributes = newInstanceAttributes();
  let qattrs: InstanceAttributes | undefined;
  let qattrVals: InstanceAttributes | undefined;
  const isQueryAll: boolean = entryName.endsWith(QuerySuffix);
  if (isQueryAll) {
    entryName = entryName.slice(0, entryName.length - 1);
  }
  if (attributes) {
    for (let i = 0; i < attributes.length; ++i) {
      const a: SetAttribute = attributes[i];
      await evaluateExpression(a.value, env);
      const v: Result = env.getLastResult();
      let aname: string = a.name;
      if (aname.endsWith(QuerySuffix)) {
        if (isQueryAll) {
          throw new Error(`Cannot specifiy query attribute ${aname} here`);
        }
        if (qattrs == undefined) qattrs = newInstanceAttributes();
        if (qattrVals == undefined) qattrVals = newInstanceAttributes();
        aname = aname.slice(0, aname.length - 1);
        qattrs.set(aname, a.op == undefined ? '=' : a.op);
        qattrVals.set(aname, v);
      } else {
        attrs.set(aname, v);
      }
    }
  }
  let moduleName = env.getActiveModuleName();
  if (isFqName(entryName)) {
    const p: Path = splitFqName(entryName);
    if (p.hasModule()) moduleName = p.getModuleName();
    if (p.hasEntry()) entryName = p.getEntryName();
  }
  return makeInstance(moduleName, entryName, attrs, qattrs, qattrVals, isQueryAll);
}

async function instanceFromSource(crud: CrudMap, env: Environment): Promise<Instance> {
  if (crud.source) {
    await evaluateLiteral(crud.source, env);
    const attrsSrc = env.getLastResult();
    if (attrsSrc && attrsSrc instanceof Object) {
      const attrs: InstanceAttributes = new Map(Object.entries(attrsSrc));
      const nparts = splitFqName(crud.name);
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
    if (v == undefined) continue;
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

async function evaluateCrudMap(crud: CrudMap, env: Environment): Promise<void> {
  if (!env.isInUpsertMode() && crud.upsert.length > 0) {
    return await evaluateUpsert(crud, env);
  }
  const inst: Instance = crud.source
    ? await instanceFromSource(crud, env)
    : await patternToInstance(crud.name, crud.body?.attributes, env);
  const entryName = inst.name;
  const moduleName = inst.moduleName;
  const attrs = inst.attributes;
  const qattrs = inst.queryAttributes;
  const isQueryAll = crud.name.endsWith(QuerySuffix);
  const distinct: boolean = crud.distinct.length > 0;
  if (attrs.size > 0) {
    await maybeValidateOneOfRefs(inst, env);
  }
  if (crud.into) {
    if (attrs.size > 0) {
      throw new Error(
        `Query pattern for ${entryName} with 'into' clause cannot be used to update attributes`
      );
    }
    if (qattrs == undefined && !isQueryAll) {
      throw new Error(`Pattern for ${entryName} with 'into' clause must be a query`);
    }
    await evaluateJoinQuery(crud.into, inst, crud.relationships, distinct, env);
    return;
  }
  if (isEntityInstance(inst) || isBetweenRelationship(inst.name, inst.moduleName)) {
    if (qattrs == undefined && !isQueryAll) {
      const parentPath: string | undefined = env.getParentPath();
      if (parentPath) {
        inst.attributes.set(PathAttributeName, parentPath);
        inst.attributes.set(ParentAttributeName, env.getNormalizedParentPath() || '');
      }
      const res: Resolver = await getResolverForPath(entryName, moduleName, env);
      let r: Instance | undefined;
      await computeExprAttributes(inst, env);
      if (env.isInUpsertMode()) {
        await runPreUpdateEvents(inst, env);
        r = await res.upsertInstance(inst);
        await runPostUpdateEvents(inst, env);
      } else {
        await runPreCreateEvents(inst, env);
        if (isTimer(inst)) triggerTimer(inst);
        r = await res.createInstance(inst);
        await runPostCreateEvents(inst, env);
      }
      if (r && entryName == AgentEntityName) {
        defineAgentEvent(env.getActiveModuleName(), r.lookup('name'));
      }
      env.setLastResult(r);
      const betRelInfo: BetweenRelInfo | undefined = env.getBetweenRelInfo();
      if (betRelInfo) {
        await res.connectInstances(
          betRelInfo.connectedInstance,
          env.getLastResult(),
          betRelInfo.relationship,
          env.isInUpsertMode()
        );
      }
      if (crud.relationships != undefined) {
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
            await res.connectInstances(lastInst, relResult, relEntry, env.isInUpsertMode());
            lastInst.attachRelatedInstances(rel.name, newEnv.getLastResult());
          }
        }
      }
    } else {
      const parentPath: string | undefined = env.getParentPath();
      const betRelInfo: BetweenRelInfo | undefined = env.getBetweenRelInfo();
      const isReadForUpdate = attrs.size > 0;
      let res: Resolver = Resolver.Default;
      if (parentPath != undefined) {
        res = await getResolverForPath(inst.name, inst.moduleName, env);
        const insts: Instance[] = await res.queryChildInstances(parentPath, inst);
        env.setLastResult(insts);
      } else if (betRelInfo != undefined) {
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
        const insts: Instance[] = await res.queryInstances(inst, isQueryAll, distinct);
        env.setLastResult(insts);
      }
      if (crud.relationships != undefined) {
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
              await computeExprAttributes(lastRes[i], env);
              await runPreUpdateEvents(lastRes[i], env);
              const finalInst: Instance = await resolver.updateInstance(lastRes[i], attrs);
              await runPostUpdateEvents(finalInst, env);
              res.push(finalInst);
            }
            env.setLastResult(res);
          } else {
            env.setLastResult(lastRes);
          }
        } else {
          const res: Resolver = await getResolverForPath(lastRes.name, lastRes.moduleName, env);
          await computeExprAttributes(lastRes, env);
          await runPreUpdateEvents(lastRes, env);
          const finalInst: Instance = await res.updateInstance(lastRes, attrs);
          await runPostUpdateEvents(finalInst, env);
          env.setLastResult(finalInst);
        }
      }
    }
  } else if (isEventInstance(inst)) {
    if (isAgentEventInstance(inst)) await handleAgentInvocation(inst, env);
    else await evaluate(inst, (result: Result) => env.setLastResult(result), env);
  } else {
    env.setLastResult(inst);
  }
}

function triggerTimer(timerInst: Instance): Instance {
  const dur = timerInst.lookup('duration');
  const unit = timerInst.lookup('unit');
  let millisecs = 0;
  switch (unit) {
    case 'millisecond': {
      millisecs = dur;
      break;
    }
    case 'second': {
      millisecs = dur * 1000;
      break;
    }
    case 'minute': {
      millisecs = dur * 60 * 1000;
      break;
    }
    case 'hour': {
      millisecs = dur * 60 * 60 * 1000;
      break;
    }
  }
  const eventName = splitFqName(timerInst.lookup('trigger'));
  const m = eventName.hasModule() ? eventName.getModuleName() : timerInst.moduleName;
  const n = eventName.getEntryName();
  const inst = makeInstance(m, n, newInstanceAttributes());
  const name = timerInst.lookup('name');
  const timer = setInterval(async () => {
    const env = new Environment();
    try {
      await evaluate(
        inst,
        (result: Result) => logger.debug(`Timer ${name} ran with result ${result}`),
        env
      );
      await env.commitAllTransactions();
      await maybeCancelTimer(name, timer, env);
    } catch (reason: any) {
      logger.error(`Timer ${name} raised error: ${reason}`);
    }
  }, millisecs);
  setTimerRunning(timerInst);
  return timerInst;
}

async function computeExprAttributes(inst: Instance, env: Environment) {
  const exprAttrs = inst.getExprAttributes();
  if (exprAttrs) {
    const newEnv = new Environment('expr-env', env);
    inst.attributes.forEach((v: any, k: string) => {
      newEnv.bind(k, v);
    });
    const ks = [...exprAttrs.keys()];
    for (let i = 0; i < ks.length; ++i) {
      const n = ks[i];
      const expr: Expr | undefined = exprAttrs.get(n);
      if (expr) {
        await evaluateExpression(expr, newEnv);
        const v: Result = newEnv.getLastResult();
        newEnv.bind(n, v);
        inst.attributes.set(n, v);
      }
    }
  }
}

async function evaluateJoinQuery(
  intoSpec: SelectIntoSpec,
  inst: Instance,
  relationships: RelationshipPattern[],
  distinct: boolean,
  env: Environment
): Promise<void> {
  const normIntoSpec = new Map<string, string>();
  intoSpec.entries.forEach((entry: SelectIntoEntry) => {
    normIntoSpec.set(entry.alias, entry.attribute);
  });
  const moduleName = inst.moduleName;
  let joinsSpec = new Array<JoinInfo>();
  for (let i = 0; i < relationships.length; ++i) {
    joinsSpec = await walkJoinQueryPattern(relationships[i], joinsSpec, env);
  }
  const resolver = await getResolverForPath(inst.name, moduleName, env);
  const result: Result = await resolver.queryByJoin(inst, joinsSpec, normIntoSpec, distinct);
  env.setLastResult(result);
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

async function handleAgentInvocation(agentEventInst: Instance, env: Environment): Promise<void> {
  const agent: AgentInstance = await findAgentByName(agentEventInst.name, env);
  await agent.invoke(agentEventInst.lookup('message'), env);
  const r: string | undefined = env.getLastResult();
  const isPlanner = agent.isPlanner();
  const result: string | undefined = isPlanner ? cleanupAgentResponse(r) : r;
  if (result) {
    if (isPlanner) {
      logger.debug(`Agent ${agent.name} generated pattern: ${result}`);
      try {
        let rs = result.trim();
        let isWf = rs.startsWith('[');
        if (rs.indexOf(';') > 0) {
          rs = `[${rs}]`;
          isWf = true;
        }
        if (isWf) {
          const stmts = rs.substring(1, rs.length - 1);
          rs = `workflow T {${stmts}}`;
          const wf = await parseWorkflow(rs);
          if (agent.runWorkflows) {
            await evaluateStatements(wf.statements, env);
          }
        } else {
          env.setLastResult(await parseAndEvaluateStatement(rs, undefined, env));
        }
      } catch (err: any) {
        logger.error(
          `Failed to evaluate pattern generated by agent ${agent.name} - ${result}, ${err}`
        );
      }
    }
    if (agent.sink) {
      const lr = escapeSpecialChars(env.getLastResult());
      parseAndEvaluateStatement(`{${agent.sink} {message "${lr}"}}`, env.getActiveUser());
    }
  } else {
    logger.warn(`Agent ${agent.name} failed to generate a response`);
  }
}

function cleanupAgentResponse(response: string | undefined): string | undefined {
  if (response) {
    const resp = response.trim();
    if (resp.startsWith('[') && resp.endsWith(']')) {
      return resp;
    }
    const parts = resp.split('\n');
    const validated = parts.filter((s: string) => {
      let stmt = s.trim();
      if (stmt.endsWith(',')) {
        stmt = `${stmt.substring(0, stmt.length - 1)};`;
      }
      const r =
        stmt.startsWith('{') ||
        stmt.startsWith('}') ||
        stmt.startsWith('if') ||
        stmt.startsWith('for') ||
        stmt.startsWith('delete') ||
        stmt.startsWith('workflow');
      if (!r) {
        const i = stmt.indexOf('(');
        return i > 0 && stmt.indexOf(')') > i;
      } else {
        return r;
      }
    });
    return validated.join('\n');
  } else {
    return response;
  }
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
  } else if (ifStmt.else != undefined) {
    await evaluateStatements(ifStmt.else.statements, env);
  }
}

async function evaluateDeleteHelper(
  pattern: Pattern,
  purge: boolean,
  env: Environment
): Promise<void> {
  const newEnv = Environment.from(env).setInDeleteMode(true);
  await evaluatePattern(pattern, newEnv);
  const inst: Instance[] | Instance = newEnv.getLastResult();
  let resolver: Resolver = Resolver.Default;
  if (inst instanceof Array) {
    if (inst.length > 0) {
      resolver = await getResolverForPath(inst[0].name, inst[0].moduleName, newEnv);
      const finalResult: Array<any> = new Array<any>();
      for (let i = 0; i < inst.length; ++i) {
        await runPreDeleteEvents(inst[i], env);
        const r: any = await resolver.deleteInstance(inst[i], purge);
        await runPostDeleteEvents(inst[i], env);
        finalResult.push(r);
      }
      newEnv.setLastResult(finalResult);
    } else {
      newEnv.setLastResult(inst);
    }
  } else {
    resolver = await getResolverForPath(inst.name, inst.moduleName, newEnv);
    await runPreDeleteEvents(inst, env);
    const r: Instance | null = await resolver.deleteInstance(inst, purge);
    await runPostDeleteEvents(inst, env);
    newEnv.setLastResult(r);
  }
  env.setLastResult(newEnv.getLastResult());
}

async function evaluateDelete(delStmt: Delete, env: Environment): Promise<void> {
  await evaluateDeleteHelper(delStmt.pattern, false, env);
}

async function evaluatePurge(purgeStmt: Purge, env: Environment): Promise<void> {
  await evaluateDeleteHelper(purgeStmt.pattern, true, env);
}

async function evaluateExpression(expr: Expr, env: Environment): Promise<void> {
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
    await evaluateExpression(expr.e2, env);
    const v2 = env.getLastResult();
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
      case '=':
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
  if (src instanceof Instance) return src.lookup(r);
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
    if (v == undefined) return EmptyResult;
    result = v;
    src = result;
  }
  return result;
}

async function dereferencePath(path: string, env: Environment): Promise<Result> {
  const fqName = fqNameFromPath(path);
  if (fqName == undefined) {
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
  if (fnName != undefined) {
    let args: Array<Result> | null = null;
    if (fnCall.args != undefined) {
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
    const p = splitFqName(trigInfo.eventName);
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
        logger.error(`${prefix}: ${reason}`);
      }
    };
    if (trigInfo.async) {
      evaluate(eventInst, callback).catch(catchHandler);
    } else {
      await evaluate(eventInst, callback, env).catch(catchHandler);
    }
  }
}

async function runPreCreateEvents(inst: Instance, env: Environment) {
  await runPrePostEvents(CrudType.CREATE, true, inst, env);
}

async function runPostCreateEvents(inst: Instance, env: Environment) {
  if (inst.requireAudit()) {
    await addCreateAudit(inst.getPath(), env);
  }
  await runPrePostEvents(CrudType.CREATE, false, inst, env);
}

async function runPreUpdateEvents(inst: Instance, env: Environment) {
  await runPrePostEvents(CrudType.UPDATE, true, inst, env);
}

async function runPostUpdateEvents(inst: Instance, env: Environment) {
  if (inst.requireAudit()) {
    await addUpdateAudit(inst.getPath(), undefined, env);
  }
  await runPrePostEvents(CrudType.UPDATE, false, inst, env);
}

async function runPreDeleteEvents(inst: Instance, env: Environment) {
  await runPrePostEvents(CrudType.DELETE, true, inst, env);
}

async function runPostDeleteEvents(inst: Instance, env: Environment) {
  if (inst.requireAudit()) {
    await addDeleteAudit(inst.getPath(), undefined, env);
  }
  await runPrePostEvents(CrudType.DELETE, false, inst, env);
}
