import {
  ArrayLiteral,
  ComparisonExpression,
  CrudMap,
  Delete,
  Expr,
  FnCall,
  ForEach,
  If,
  isBinExpr,
  isComparisonExpression,
  isGroup,
  isLiteral,
  isNegExpr,
  isOrAnd,
  Literal,
  LogicalExpression,
  OrAnd,
  Pattern,
  RelationshipPattern,
  SetAttribute,
  Statement,
  Upsert,
} from '../language/generated/ast.js';
import {
  getRelationship,
  getWorkflow,
  Instance,
  InstanceAttributes,
  isBetweenRelationship,
  isContainsRelationship,
  isEmptyWorkflow,
  isEntityInstance,
  isEventInstance,
  makeInstance,
  newInstanceAttributes,
  PlaceholderRecordEntry,
  RelationshipEntry,
  WorkflowEntry,
} from './module.js';
import { Resolver, ResolverAuthInfo } from './resolvers/interface.js';
import { SqlDbResolver } from './resolvers/sqldb/impl.js';
import { PathAttributeName } from './resolvers/sqldb/database.js';
import {
  DefaultModuleName,
  escapeFqName,
  invokeModuleFn,
  isFqName,
  makeFqName,
  Path,
  QuerySuffix,
  splitFqName,
  splitRefs,
} from './util.js';
import { getResolver, getResolverNameForPath } from './resolvers/registry.js';
import { AdminUserId } from './modules/auth.js';
import { parseStatement } from '../language/parser.js';

export type Result = any;

const EmptyResult: Result = null;

export function isEmptyResult(r: Result): boolean {
  return r == EmptyResult;
}

type BetweenRelInfo = {
  relationship: RelationshipEntry;
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
      } else return EmptyResult;
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

  setActiveEvent(eventInst: Instance | undefined): Environment {
    if (eventInst) {
      if (!isEventInstance(eventInst)) throw new Error(`Not an event instance - ${eventInst.name}`);
      this.bindInstance(eventInst);
      this.activeModule = eventInst.moduleName;
      this.activeEventInstance = eventInst;
    }
    return this;
  }

  protected getActiveEventInstance(): Instance | undefined {
    return this.activeEventInstance;
  }

  setActiveUser(userId: string): Environment {
    this.activeUser = userId;
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

  addResolver(resolver: Resolver): Environment {
    this.getActiveResolvers().set(resolver.getName(), resolver);
    this.ensureTransactionForResolver(resolver);
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

  getTransactionForResolver(resolver: Resolver): string {
    const n: string = resolver.getName();
    let txnId: string | undefined = this.getActiveTransactions().get(n);
    if (txnId) {
      return txnId;
    } else {
      txnId = resolver.startTransaction();
      this.getActiveTransactions().set(n, txnId);
      return txnId;
    }
  }

  ensureTransactionForResolver(resolver: Resolver): Environment {
    this.getTransactionForResolver(resolver);
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
      const wf: WorkflowEntry = getWorkflow(eventInstance);
      if (!isEmptyWorkflow(wf)) {
        env = new Environment(eventInstance.name + '.env', activeEnv);
        env.setActiveEvent(eventInstance);
        if (kernelCall) env.setInKernelMode(true);
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
  activeUserId?: string,
  env?: Environment,
  kernelCall?: boolean
): Promise<Result> {
  const finalAttrs: Map<string, any> =
    attrs instanceof Array ? new Map(attrs) : new Map(Object.entries(attrs));
  const eventInst: Instance = makeInstance(moduleName, eventName, finalAttrs).setAuthContext(
    activeUserId || AdminUserId
  );
  let result: any;
  await evaluate(eventInst, (r: any) => (result = r), env, kernelCall);
  return result;
}

async function evaluateStatements(stmts: Statement[], env: Environment, continuation?: Function) {
  for (let i = 0; i < stmts.length; ++i) {
    await evaluateStatement(stmts[i], env);
  }
  if (continuation != undefined) {
    continuation(env.getLastResult());
  }
}

async function evaluateStatement(stmt: Statement, env: Environment): Promise<void> {
  await evaluatePattern(stmt.pattern, env).then((_: void) => {
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
  });
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
    let stmt: Statement | undefined;
    await parseStatement(stmtString).then((s: Statement) => {
      stmt = s;
    });
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
        env.commitAllTransactions();
      } else {
        env.rollbackAllTransactions();
      }
    }
  }
}

async function evaluatePattern(pat: Pattern, env: Environment): Promise<void> {
  if (pat.literal != undefined) {
    await evaluateLiteral(pat.literal, env);
  } else if (pat.crudMap != undefined) {
    await evaluateCrudMap(pat.crudMap, env);
  } else if (pat.forEach != undefined) {
    await evaluateForEach(pat.forEach, env);
  } else if (pat.if != undefined) {
    await evaluateIf(pat.if, env);
  } else if (pat.delete != undefined) {
    await evaluateDelete(pat.delete, env);
  } else if (pat.upsert != undefined) {
    await evaluateUpsert(pat.upsert, env);
  }
}

async function evaluateLiteral(lit: Literal, env: Environment): Promise<void> {
  if (lit.id != undefined) env.setLastResult(env.lookup(lit.id));
  else if (lit.ref != undefined) env.setLastResult(followReference(env, lit.ref));
  else if (lit.fnCall != undefined) await applyFn(lit.fnCall, env);
  else if (lit.array != undefined) await realizeArray(lit.array, env);
  else if (lit.num != undefined) env.setLastResult(lit.num);
  else if (lit.str != undefined) env.setLastResult(lit.str);
  else if (lit.bool != undefined) env.setLastResult(lit.bool);
}

const DefaultResolverName: string = '--default-resolver--';

function getResolverForPath(
  entryName: string,
  moduleName: string,
  env: Environment,
  isReadForUpdate: boolean = false,
  isReadForDelete: boolean = false
): Resolver {
  const fqEntryName: string = isFqName(entryName) ? entryName : makeFqName(moduleName, entryName);
  const resN: string | undefined = getResolverNameForPath(fqEntryName);
  let res: Resolver | undefined;
  if (resN == undefined) {
    res = env.getResolver(DefaultResolverName);
    if (res == undefined) {
      res = new SqlDbResolver(DefaultResolverName);
      env.addResolver(res);
    }
  } else {
    res = env.getResolver(resN);
    if (res == undefined) {
      res = getResolver(fqEntryName);
      env.addResolver(res);
    }
  }

  const authInfo: ResolverAuthInfo = new ResolverAuthInfo(
    env.getActiveUser(),
    isReadForUpdate,
    isReadForDelete
  );
  return res.setKernelMode(env.isInKernelMode()).setAuthInfo(authInfo);
}

async function evaluateCrudMap(crud: CrudMap, env: Environment): Promise<void> {
  const attrs: InstanceAttributes = newInstanceAttributes();
  let qattrs: InstanceAttributes | undefined;
  let qattrVals: InstanceAttributes | undefined;
  let moduleName: string = env.getActiveModuleName();
  let entryName: string = crud.name;
  const isQueryAll: boolean = entryName.endsWith(QuerySuffix);
  if (isQueryAll) {
    entryName = entryName.slice(0, entryName.length - 1);
  }
  for (let i = 0; i < crud.attributes.length; ++i) {
    const a: SetAttribute = crud.attributes[i];
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
  if (isFqName(entryName)) {
    const p: Path = splitFqName(entryName);
    if (p.hasModule()) moduleName = p.getModuleName();
    if (p.hasEntry()) entryName = p.getEntryName();
  }
  const inst: Instance = makeInstance(moduleName, entryName, attrs, qattrs, qattrVals);
  if (isEntityInstance(inst) || isBetweenRelationship(inst.name, inst.moduleName)) {
    if (qattrs == undefined && !isQueryAll) {
      const parentPath: string | undefined = env.getParentPath();
      if (parentPath != undefined) inst.attributes.set(PathAttributeName, parentPath);
      const res: Resolver = getResolverForPath(entryName, moduleName, env);
      const betRelInfo: BetweenRelInfo | undefined = env.getBetweenRelInfo();
      if (betRelInfo != undefined && res.getName() == DefaultResolverName) {
        betRelInfo.relationship.setBetweenRef(
          inst,
          betRelInfo.connectedInstance.attributes.get(PathAttributeName)
        );
      }
      if (env.isInUpsertMode()) {
        await res.upsertInstance(inst).then((inst: Instance) => env.setLastResult(inst));
      } else {
        await res.createInstance(inst).then((inst: Instance) => env.setLastResult(inst));
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
            const relEntry: RelationshipEntry = getRelationship(rel.name, moduleName);
            if (relEntry.isOneToOne() || relEntry.isOneToMany()) {
              newEnv.setBetweenRelInfo({ relationship: relEntry, connectedInstance: lastInst });
            }
            await evaluatePattern(rel.pattern, newEnv);
            if (relEntry.isManyToMany()) {
              const relResult: any = newEnv.getLastResult();
              await getResolverForPath(rel.name, moduleName, env).connectInstances(
                lastInst,
                relResult,
                relEntry,
                env.isInUpsertMode()
              );
            }
            lastInst.attachRelatedInstances(rel.name, newEnv.getLastResult());
          }
        }
      }
    } else {
      const parentPath: string | undefined = env.getParentPath();
      const betRelInfo: BetweenRelInfo | undefined = env.getBetweenRelInfo();
      const isReadForUpdate = attrs.size > 0;
      if (parentPath != undefined) {
        await getResolverForPath(inst.name, inst.moduleName, env)
          .queryChildInstances(parentPath, inst)
          .then((insts: Instance[]) => env.setLastResult(insts));
      } else if (betRelInfo != undefined) {
        await getResolverForPath(
          betRelInfo.relationship.name,
          betRelInfo.relationship.moduleName,
          env
        )
          .queryConnectedInstances(betRelInfo.relationship, betRelInfo.connectedInstance, inst)
          .then((insts: Instance[]) => env.setLastResult(insts));
      } else {
        await getResolverForPath(
          inst.name,
          inst.moduleName,
          env,
          isReadForUpdate,
          env.isInDeleteMode()
        )
          .queryInstances(inst, isQueryAll)
          .then((insts: Instance[]) => env.setLastResult(insts));
      }
      if (crud.relationships != undefined) {
        const lastRes: Instance[] = env.getLastResult();
        for (let i = 0; i < crud.relationships.length; ++i) {
          const rel: RelationshipPattern = crud.relationships[i];
          for (let j = 0; j < lastRes.length; ++j) {
            const newEnv: Environment = Environment.from(env);
            if (isContainsRelationship(rel.name, moduleName)) {
              newEnv.setParentPath(
                lastRes[j].attributes.get(PathAttributeName) + '/' + rel.name + '/'
              );
              await evaluatePattern(rel.pattern, newEnv);
              lastRes[j].attachRelatedInstances(rel.name, newEnv.getLastResult());
            } else if (isBetweenRelationship(rel.name, moduleName)) {
              const relEntry: RelationshipEntry = getRelationship(rel.name, moduleName);
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
            const resolver: Resolver = getResolverForPath(
              lastRes[0].name,
              lastRes[0].moduleName,
              env
            );
            const res: Array<Instance> = new Array<Instance>();
            for (let i = 0; i < lastRes.length; ++i) {
              await resolver.updateInstance(lastRes[i], attrs).then((finalInst: Instance) => {
                res.push(finalInst);
              });
            }
            env.setLastResult(res);
          } else {
            env.setLastResult(lastRes);
          }
        } else {
          await getResolverForPath(lastRes.name, lastRes.moduleName, env)
            .updateInstance(lastRes, attrs)
            .then((finalInst: Instance) => {
              env.setLastResult(finalInst);
            });
        }
      }
    }
  } else if (isEventInstance(inst)) {
    await evaluate(inst, (result: Result) => env.setLastResult(result), env);
  } else {
    env.setLastResult(inst);
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
  await evaluateLogicalExpression(ifStmt.cond, env);
  if (env.getLastResult()) {
    await evaluateStatements(ifStmt.statements, env);
  } else if (ifStmt.elseif != undefined) {
    await evaluateIf(ifStmt.elseif, env);
  } else if (ifStmt.else != undefined) {
    await evaluateStatements(ifStmt.else.statements, env);
  }
}

async function evaluateDelete(delStmt: Delete, env: Environment): Promise<void> {
  const newEnv = Environment.from(env).setInDeleteMode(true);
  await evaluatePattern(delStmt.pattern, newEnv);
  const inst: Instance[] | Instance = newEnv.getLastResult();
  if (inst instanceof Array) {
    if (inst.length > 0) {
      const resolver: Resolver = getResolverForPath(inst[0].name, inst[0].moduleName, newEnv);
      const finalResult: Array<any> = new Array<any>();
      for (let i = 0; i < inst.length; ++i) {
        await resolver.deleteInstance(inst[i]).then((r: any) => {
          finalResult.push(r);
        });
      }
      newEnv.setLastResult(finalResult);
    } else {
      newEnv.setLastResult(inst);
    }
  } else {
    await getResolverForPath(inst.name, inst.moduleName, newEnv)
      .deleteInstance(inst)
      .then((inst: Instance | null) => {
        newEnv.setLastResult(inst);
      });
  }
}

async function evaluateLogicalExpression(
  logExpr: LogicalExpression,
  env: Environment
): Promise<void> {
  if (isComparisonExpression(logExpr.expr)) {
    await evaluateComparisonExpression(logExpr.expr, env);
  } else if (isOrAnd(logExpr.expr)) {
    await evaluateOrAnd(logExpr.expr, env);
  }
}

async function evaluateComparisonExpression(
  cmprExpr: ComparisonExpression,
  env: Environment
): Promise<void> {
  await evaluateExpression(cmprExpr.e1, env);
  const v1 = env.getLastResult();
  await evaluateExpression(cmprExpr.e2, env);
  const v2 = env.getLastResult();
  let result: Result = EmptyResult;
  switch (cmprExpr.op) {
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
      throw new Error(`Invalid comparison operator ${cmprExpr.op}`);
  }
  env.setLastResult(result);
}

async function evaluateExpression(expr: Expr, env: Environment): Promise<void> {
  let result: Result = EmptyResult;
  if (isBinExpr(expr)) {
    await evaluateExpression(expr.e1, env);
    const v1 = env.getLastResult();
    await evaluateExpression(expr.e2, env);
    const v2 = env.getLastResult();
    switch (expr.op) {
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
  }
  env.setLastResult(result);
}

async function evaluateOrAnd(orAnd: OrAnd, env: Environment): Promise<void> {
  switch (orAnd.op) {
    case 'or':
      await evaluateOr(orAnd.exprs, env);
      break;
    case 'and':
      await evaluateAnd(orAnd.exprs, env);
      break;
    default:
      throw new Error(`Invalid logical operator: ${orAnd.op}`);
  }
}

async function evaluateOr(exprs: LogicalExpression[], env: Environment): Promise<void> {
  for (let i = 0; i < exprs.length; ++i) {
    await evaluateLogicalExpression(exprs[i], env);
    if (env.getLastResult()) return;
  }
  env.setLastResult(false);
}

async function evaluateAnd(exprs: LogicalExpression[], env: Environment): Promise<void> {
  for (let i = 0; i < exprs.length; ++i) {
    await evaluateLogicalExpression(exprs[i], env);
    if (!env.getLastResult()) return;
  }
  env.setLastResult(true);
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

async function applyFn(fnCall: FnCall, env: Environment): Promise<void> {
  const fnName: string | undefined = fnCall.name;
  if (fnName != undefined) {
    let args: Array<Result> | null = null;
    if (fnCall.args != undefined) {
      args = new Array<Result>();
      for (let i = 0; i < fnCall.args.length; ++i) {
        await evaluateLiteral(fnCall.args[i], env);
        args.push(env.getLastResult());
      }
    }
    const r: Result = invokeModuleFn(fnName, args);
    env.setLastResult(r);
  }
}

async function realizeArray(array: ArrayLiteral, env: Environment): Promise<void> {
  const result: Array<Result> = new Array<Result>();
  for (let i = 0; i < array.vals.length; ++i) {
    await evaluateStatement(array.vals[i], env).then((_: void) => result.push(env.getLastResult()));
  }
  env.setLastResult(result);
}
