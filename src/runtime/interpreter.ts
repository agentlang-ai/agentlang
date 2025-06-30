import {
  ArrayLiteral,
  CrudMap,
  Delete,
  Expr,
  FnCall,
  ForEach,
  FullTextSearch,
  If,
  isBinExpr,
  isGroup,
  isLiteral,
  isNegExpr,
  isNotExpr,
  Literal,
  MapLiteral,
  Pattern,
  Purge,
  RelationshipPattern,
  SelectIntoEntry,
  SelectIntoSpec,
  SetAttribute,
  Statement,
  Upsert,
} from '../language/generated/ast.js';
import {
  defineAgentEvent,
  getRelationship,
  getWorkflow,
  Instance,
  InstanceAttributes,
  isAgentEvent,
  isBetweenRelationship,
  isContainsRelationship,
  isEmptyWorkflow,
  isEntityInstance,
  isEventInstance,
  isInstanceOfType,
  makeInstance,
  newInstanceAttributes,
  PlaceholderRecordEntry,
  Relationship,
  Workflow,
} from './module.js';
import { Resolver, ResolverAuthInfo } from './resolvers/interface.js';
import { SqlDbResolver } from './resolvers/sqldb/impl.js';
import { PathAttributeName } from './resolvers/sqldb/database.js';
import {
  DefaultModuleName,
  escapeFqName,
  escapeQueryName,
  invokeModuleFn,
  isFqName,
  isString,
  makeFqName,
  Path,
  QuerySuffix,
  splitFqName,
  splitRefs,
} from './util.js';
import { getResolver, getResolverNameForPath } from './resolvers/registry.js';
import { parseStatement, parseWorkflow } from '../language/parser.js';
import { ActiveSessionInfo, AdminSession, AdminUserId } from './auth/defs.js';
import { Agent, AgentFqName, findAgentByName } from './modules/ai.js';
import { logger } from './logger.js';

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

export class Environment extends Instance {
  parent: Environment | undefined;

  private activeModule: string;
  private activeEventInstance: Instance | undefined;
  private activeUser: string = AdminUserId;
  private activeUserSet: boolean = false;
  private lastResult: Result;
  private parentPath: string | undefined;
  private betweenRelInfo: BetweenRelInfo | undefined;
  private activeResolvers: Map<string, Resolver>;
  private activeTransactions: Map<string, string>;
  private inUpsertMode: boolean = false;
  private inDeleteMode: boolean = false;
  private inKernelMode: boolean = false;

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
    } else {
      this.activeModule = DefaultModuleName;
      this.activeResolvers = new Map<string, Resolver>();
      this.activeTransactions = new Map<string, string>();
    }
  }

  static from(parent: Environment): Environment {
    return new Environment(undefined, parent);
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
      return r.setUserData(this);
    }
    return undefined;
  }

  async addResolver(resolver: Resolver): Promise<Environment> {
    this.getActiveResolvers().set(resolver.getName(), resolver);
    await this.ensureTransactionForResolver(resolver);
    resolver.setUserData(this);
    return this;
  }

  setActiveTransactions(txns: Map<string, string>): Environment {
    this.activeTransactions = txns;
    return this;
  }

  getActiveTransactions(): Map<string, string> {
    return this.activeTransactions;
  }

  async getTransactionForResolver(resolver: Resolver): Promise<string> {
    const n: string = resolver.getName();
    let txnId: string | undefined = this.getActiveTransactions().get(n);
    if (txnId) {
      return txnId;
    } else {
      txnId = await resolver.startTransaction();
      if (txnId) {
        this.getActiveTransactions().set(n, txnId);
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
    const txns: Map<string, string> = this.getActiveTransactions();
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
      throw new Error(result);
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
}

export const GlobalEnvironment = new Environment();

export async function evaluate(
  eventInstance: Instance,
  continuation?: Function,
  activeEnv?: Environment,
  kernelCall?: boolean
): Promise<void> {
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
      }
    } else {
      throw new Error('Not an event - ' + eventInstance.name);
    }
  } catch (err) {
    if (env != undefined && activeEnv == undefined) {
      await env.rollbackAllTransactions().then(() => {
        txnRolledBack = true;
      });
    }
    throw err;
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

export async function evaluateStatements(
  stmts: Statement[],
  env: Environment,
  continuation?: Function
) {
  for (let i = 0; i < stmts.length; ++i) {
    await evaluateStatement(stmts[i], env);
  }
  if (continuation != undefined) {
    continuation(env.getLastResult());
  }
}

async function evaluateStatement(stmt: Statement, env: Environment): Promise<void> {
  await evaluatePattern(stmt.pattern, env);
  if (stmt.alias != undefined || stmt.aliases.length > 0) {
    const result: Result = env.getLastResult();
    const alias: string | undefined = stmt.alias;
    if (alias != undefined) {
      env.bind(alias, result);
    } else {
      const aliases: string[] = stmt.aliases;
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
  if (pat.literal) {
    await evaluateLiteral(pat.literal, env);
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
  } else if (pat.upsert) {
    await evaluateUpsert(pat.upsert, env);
  } else if (pat.fullTextSearch) {
    await evaluateFullTextSearch(pat.fullTextSearch, env);
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
  else if (lit.ref != undefined) env.setLastResult(followReference(env, lit.ref));
  else if (lit.fnCall != undefined) await applyFn(lit.fnCall, env, false);
  else if (lit.asyncFnCall != undefined) await applyFn(lit.asyncFnCall.fnCall, env, true);
  else if (lit.array != undefined) await realizeArray(lit.array, env);
  else if (lit.map != undefined) await realizeMap(lit.map, env);
  else if (lit.num != undefined) env.setLastResult(lit.num);
  else if (lit.str != undefined) env.setLastResult(lit.str);
  else if (lit.bool != undefined) env.setLastResult(lit.bool == 'true' ? true : false);
}

const DefaultResolverName: string = '--default-resolver--';

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

async function patternToInstance(entryName: string, attributes: SetAttribute[], env: Environment): Promise<Instance> {
  const attrs: InstanceAttributes = newInstanceAttributes();
  let qattrs: InstanceAttributes | undefined;
  let qattrVals: InstanceAttributes | undefined;
  const isQueryAll: boolean = entryName.endsWith(QuerySuffix);
  if (isQueryAll) {
    entryName = entryName.slice(0, entryName.length - 1);
  }
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
  let moduleName = env.getActiveModuleName()
  if (isFqName(entryName)) {
    const p: Path = splitFqName(entryName);
    if (p.hasModule()) moduleName = p.getModuleName();
    if (p.hasEntry()) entryName = p.getEntryName();
  }
  return makeInstance(moduleName, entryName, attrs, qattrs, qattrVals);
}

async function evaluateCrudMap(crud: CrudMap, env: Environment): Promise<void> {
  const inst: Instance = await patternToInstance(crud.name, crud.attributes, env)
  const entryName = inst.name
  const moduleName = inst.moduleName
  const attrs = inst.attributes
  const qattrs = inst.queryAttributes
  const isQueryAll = crud.name.endsWith(QuerySuffix);
  if (crud.into) {
    if (attrs.size > 0) {
      throw new Error(`Query pattern for ${entryName} with 'into' clause cannot be used to update attributes`)
    }
    if (qattrs == undefined || !isQueryAll) {
      throw new Error(`Pattern for ${entryName} with 'into' clause must be a query`)
    }
    await evaluateJoinQuery(crud.into, inst, crud.relationships, env)
    return
  }
  if (isEntityInstance(inst) || isBetweenRelationship(inst.name, inst.moduleName)) {
    if (qattrs == undefined && !isQueryAll) {
      const parentPath: string | undefined = env.getParentPath();
      if (parentPath) inst.attributes.set(PathAttributeName, parentPath);
      const res: Resolver = await getResolverForPath(entryName, moduleName, env);
      let r: Instance | undefined;
      if (env.isInUpsertMode()) {
        r = await res.upsertInstance(inst);
      } else {
        r = await res.createInstance(inst);
      }
      if (r && entryName == 'agent') {
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
          const newEnv: Environment = Environment.from(env);
          if (isContainsRelationship(rel.name, moduleName)) {
            newEnv.setParentPath(
              `${inst.attributes.get(PathAttributeName)}/${escapeFqName(rel.name)}`
            );
            await evaluatePattern(rel.pattern, newEnv);
            const lastInst: Instance = env.getLastResult();
            lastInst.attachRelatedInstances(rel.name, newEnv.getLastResult());
          } else if (isBetweenRelationship(rel.name, moduleName)) {
            const lastInst: Instance = env.getLastResult() as Instance;
            const relEntry: Relationship = getRelationship(rel.name, moduleName);
            if (!relEntry.isManyToMany()) {
              newEnv.setBetweenRelInfo({ relationship: relEntry, connectedInstance: lastInst });
            }
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
        const insts: Instance[] = await res.queryInstances(inst, isQueryAll);
        env.setLastResult(insts);
      }
      if (crud.relationships != undefined) {
        const lastRes: Instance[] = env.getLastResult();
        for (let i = 0; i < crud.relationships.length; ++i) {
          const rel: RelationshipPattern = crud.relationships[i];
          for (let j = 0; j < lastRes.length; ++j) {
            const newEnv: Environment = Environment.from(env);
            if (isContainsRelationship(rel.name, moduleName)) {
              newEnv.setParentPath(lastRes[j].attributes.get(PathAttributeName) + '/' + rel.name);
              await evaluatePattern(rel.pattern, newEnv);
              lastRes[j].attachRelatedInstances(rel.name, newEnv.getLastResult());
            } else if (isBetweenRelationship(rel.name, moduleName)) {
              const relEntry: Relationship = getRelationship(rel.name, moduleName);
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
              const finalInst: Instance = await resolver.updateInstance(lastRes[i], attrs);
              res.push(finalInst);
            }
            env.setLastResult(res);
          } else {
            env.setLastResult(lastRes);
          }
        } else {
          const res: Resolver = await getResolverForPath(lastRes.name, lastRes.moduleName, env);
          const finalInst: Instance = await res.updateInstance(lastRes, attrs);
          env.setLastResult(finalInst);
        }
      }
    }
  } else if (isEventInstance(inst)) {
    if (isAgentEvent(inst)) await handleAgentInvocation(inst, env);
    else await evaluate(inst, (result: Result) => env.setLastResult(result), env);
  } else {
    env.setLastResult(inst);
  }
}

async function evaluateJoinQuery(intoSpec: SelectIntoSpec, inst: Instance, relationships: RelationshipPattern[], env: Environment): Promise<void> {
  const normIntoSpec = new Map<string, string>()
  intoSpec.entries.forEach((entry: SelectIntoEntry) => {
    normIntoSpec.set(entry.alias, entry.attribute)
  })
  relationships.forEach((rp: RelationshipPattern) => {

  })
  //const resolver = await getResolverForPath(inst.name, inst.moduleName, env)
  const result: Result = [] //await resolver.queryByJoin(inst, intoSpec)
  env.setLastResult(result)
}

async function handleAgentInvocation(agentEventInst: Instance, env: Environment): Promise<void> {
  const agent: Agent = await findAgentByName(agentEventInst.name, env);
  await agent.invoke(agentEventInst.lookup('message'), env);
  const result: string = env.getLastResult();
  if (agent.isPlanner()) {
    logger.debug(`Agent ${agent.name} generated pattern: ${result}`);
    if (result.trimStart().startsWith('workflow')) {
      await parseWorkflow(result); // check for errors
      return;
    } else {
      env.setLastResult(await parseAndEvaluateStatement(result, undefined, env));
    }
  }
}

async function evaluateUpsert(upsert: Upsert, env: Environment): Promise<void> {
  env.setInUpsertMode(true);
  try {
    await evaluateCrudMap(upsert.pattern, env);
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
    for (let i = 0; i < src.length; ++i) {
      loopEnv.bind(loopVar, src[i]);
      await evaluateStatements(forEach.statements, loopEnv);
    }
    env.setLastResult(loopEnv.getLastResult());
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
        const r: any = await resolver.deleteInstance(inst[i], purge);
        finalResult.push(r);
      }
      newEnv.setLastResult(finalResult);
    } else {
      newEnv.setLastResult(inst);
    }
  } else {
    resolver = await getResolverForPath(inst.name, inst.moduleName, newEnv);
    const r: Instance | null = await resolver.deleteInstance(inst, purge);
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

function getRef(r: string, src: any): Result | undefined {
  if (src instanceof Instance) return src.lookup(r);
  else if (src instanceof Map) return src.get(r);
  else if (src instanceof Object) return src[r];
  else return undefined;
}

function followReference(env: Environment, s: string): Result {
  const refs: string[] = splitRefs(s);
  let result: Result = EmptyResult;
  let src: any = env;
  for (let i = 0; i < refs.length; ++i) {
    const r: string = refs[i];
    const v: Result | undefined = getRef(r, src);
    if (v == undefined) return EmptyResult;
    result = v;
    src = v;
  }
  return result;
}

async function applyFn(fnCall: FnCall, env: Environment, isAsync: boolean): Promise<void> {
  const fnName: string | undefined = fnCall.name;
  if (fnName != undefined) {
    let args: Array<Result> | null = null;
    if (fnCall.args != undefined) {
      args = new Array<Result>();
      for (let i = 0; i < fnCall.args.length; ++i) {
        await evaluateLiteral(fnCall.args[i], env);
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
    await evaluateLiteral(entry.value, env);
    result.set(entry.key, env.getLastResult());
  }
  env.setLastResult(result);
}
