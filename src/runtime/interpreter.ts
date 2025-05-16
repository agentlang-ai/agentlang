import {
  ArrayLiteral,
  ComparisonExpression,
  CrudMap,
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
import { Resolver } from './resolvers/interface.js';
import { SqlDbResolver } from './resolvers/sqldb/impl.js';
import { PathAttributeName } from './resolvers/sqldb/schema.js';
import { escapeFqName, invokeModuleFn, isFqName, Path, splitFqName, splitRefs } from './util.js';

export type Result = any;

const EmptyResult: Result = null;

export function isEmptyResult(r: Result): boolean {
  return r == EmptyResult;
}

class Environment extends Instance {
  parent: Environment | undefined;

  private static ActiveModuleKey: string = '--active-module--';
  private static ActiveEventKey: string = '--active-event--';
  private static ActiveEventInstanceKey: string = '--active-event-instance--';
  private static LastResultKey: string = '--last-result--';
  private static ParentPathKey: string = '--parent-path--';

  constructor(name: string, parent?: Environment) {
    super(PlaceholderRecordEntry, 'agentlang', name, newInstanceAttributes());
    if (parent != undefined) {
      this.parent = parent;
      this.bindActiveEvent(parent.getActiveEventInstance());
      this.bindLastResult(parent.getLastResult());
    }
  }

  override lookup(k: string): Result {
    const v = this.attributes.get(k);
    if (v == undefined) {
      if (this.parent != undefined) {
        return this.parent.lookup(k);
      } else return EmptyResult;
    } else return v;
  }

  bind(k: string, v: any) {
    this.attributes.set(k, v);
  }

  bindInstance(inst: Instance): void {
    const n: string = inst.name;
    this.attributes.set(n, inst);
  }

  bindActiveEvent(eventInst: Instance): void {
    if (!isEventInstance(eventInst)) throw new Error(`Not an event instance - ${eventInst.name}`);
    this.bindInstance(eventInst);
    this.attributes.set(Environment.ActiveModuleKey, eventInst.moduleName);
    this.attributes.set(Environment.ActiveEventKey, eventInst.name);
    this.attributes.set(Environment.ActiveEventInstanceKey, eventInst);
  }

  protected getActiveEventInstance(): Instance {
    return this.attributes.get(Environment.ActiveEventInstanceKey);
  }

  bindLastResult(result: Result): void {
    this.attributes.set(Environment.LastResultKey, result);
  }

  getLastResult(): Result | undefined {
    return this.attributes.get(Environment.LastResultKey);
  }

  getActiveModuleName(): string {
    return this.attributes.get(Environment.ActiveModuleKey);
  }

  getActiveEvent(): Instance {
    return this.attributes.get(this.attributes.get(Environment.ActiveEventKey));
  }

  bindParentPath(path: string): void {
    this.attributes.set(Environment.ParentPathKey, path);
  }

  getParentPath(): string | undefined {
    return this.attributes.get(Environment.ParentPathKey);
  }
}

export async function evaluate(
  eventInstance: Instance,
  continuation?: Function,
  activeEnv?: Environment
): Promise<void> {
  if (isEventInstance(eventInstance)) {
    const wf: WorkflowEntry = getWorkflow(eventInstance);
    if (!isEmptyWorkflow(wf)) {
      const env: Environment = new Environment(eventInstance.name + '.env', activeEnv);
      env.bindActiveEvent(eventInstance);
      await evaluateStatements(wf.statements, env, continuation);
    }
  } else {
    throw new Error('Not an event - ' + eventInstance.name);
  }
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

async function evaluatePattern(pat: Pattern, env: Environment): Promise<void> {
  if (pat.literal != undefined) {
    await evaluateLiteral(pat.literal, env);
  } else if (pat.crudMap != undefined) {
    await evaluateCrudMap(pat.crudMap, env);
  } else if (pat.forEach != undefined) {
    await evaluateForEach(pat.forEach, env);
  } else if (pat.if != undefined) {
    await evaluateIf(pat.if, env);
  }
}

async function evaluateLiteral(lit: Literal, env: Environment): Promise<void> {
  if (lit.id != undefined) env.bindLastResult(env.lookup(lit.id));
  else if (lit.ref != undefined) env.bindLastResult(followReference(env, lit.ref));
  else if (lit.fnCall != undefined) await applyFn(lit.fnCall, env);
  else if (lit.array != undefined) await realizeArray(lit.array, env);
  else if (lit.num != undefined) env.bindLastResult(lit.num);
  else if (lit.str != undefined) env.bindLastResult(lit.str);
  else if (lit.bool != undefined) env.bindLastResult(lit.bool);
}

const defaultResolver: Resolver = new SqlDbResolver();

async function evaluateCrudMap(crud: CrudMap, env: Environment): Promise<void> {
  const attrs: InstanceAttributes = newInstanceAttributes();
  let qattrs: InstanceAttributes | undefined;
  let qattrVals: InstanceAttributes | undefined;
  for (let i = 0; i < crud.attributes.length; ++i) {
    const a: SetAttribute = crud.attributes[i];
    await evaluateExpression(a.value, env);
    const v: Result = env.getLastResult();
    let aname: string = a.name;
    if (aname.endsWith('?')) {
      if (qattrs == undefined) qattrs = newInstanceAttributes();
      if (qattrVals == undefined) qattrVals = newInstanceAttributes();
      aname = aname.slice(0, aname.length - 1);
      qattrs.set(aname, a.op == undefined ? '=' : a.op);
      qattrVals.set(aname, v);
    } else {
      attrs.set(aname, v);
    }
  }
  let moduleName: string = env.getActiveModuleName();
  let entryName: string = crud.name;
  if (isFqName(entryName)) {
    const p: Path = splitFqName(entryName);
    if (p.hasModule()) moduleName = p.getModuleName();
    if (p.hasEntry()) entryName = p.getEntryName();
  }
  const inst: Instance = makeInstance(moduleName, entryName, attrs, qattrs, qattrVals);
  if (isEntityInstance(inst)) {
    if (qattrs == undefined) {
      const parentPath: string | undefined = env.getParentPath();
      if (parentPath != undefined) inst.attributes.set(PathAttributeName, parentPath);
      await defaultResolver.createInstance(inst).then((inst: Instance) => env.bindLastResult(inst));
      if (crud.relationships != undefined) {
        for (let i = 0; i < crud.relationships.length; ++i) {
          const rel: RelationshipPattern = crud.relationships[i];
          if (isContainsRelationship(rel.name, moduleName)) {
            const newEnv: Environment = new Environment('relenv', env);
            newEnv.bindParentPath(
              `${inst.attributes.get(PathAttributeName)}/${escapeFqName(rel.name)}`
            );
            await evaluatePattern(rel.pattern, newEnv);
          } else if (isBetweenRelationship(rel.name, moduleName)) {
            const inst1: any = env.getLastResult();
            await evaluatePattern(rel.pattern, env);
            const relResult: any = env.getLastResult();
            const relEntry: RelationshipEntry = getRelationship(rel.name, moduleName);
            await defaultResolver.connectInstances(inst1, relResult, relEntry);
          }
        }
      }
    } else if (attrs.size == 0) {
      await defaultResolver
        .queryInstances(inst)
        .then((insts: Instance[]) => env.bindLastResult(insts));
    } else {
      await defaultResolver.updateInstance(inst).then((inst: Instance) => env.bindLastResult(inst));
    }
  } else if (isEventInstance(inst)) {
    await evaluate(inst, (result: Result) => env.bindLastResult(result), env);
  } else {
    env.bindLastResult(inst);
  }
}

async function evaluateForEach(forEach: ForEach, env: Environment): Promise<void> {
  const loopVar: string = forEach.var;
  await evaluatePattern(forEach.src, env);
  const src: Result = env.getLastResult();
  if (src instanceof Array && src.length > 0) {
    const loopEnv: Environment = new Environment(env.name + '.child', env);
    for (let i = 0; i < src.length; ++i) {
      loopEnv.bind(loopVar, src[i]);
      await evaluateStatements(forEach.statements, loopEnv);
    }
    env.bindLastResult(loopEnv.getLastResult());
  } else {
    env.bindLastResult(EmptyResult);
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
  env.bindLastResult(result);
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
  env.bindLastResult(result);
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
  env.bindLastResult(false);
}

async function evaluateAnd(exprs: LogicalExpression[], env: Environment): Promise<void> {
  for (let i = 0; i < exprs.length; ++i) {
    await evaluateLogicalExpression(exprs[i], env);
    if (!env.getLastResult()) return;
  }
  env.bindLastResult(true);
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
    env.bindLastResult(r);
  }
}

async function realizeArray(array: ArrayLiteral, env: Environment): Promise<void> {
  const result: Array<Result> = new Array<Result>();
  for (let i = 0; i < array.vals.length; ++i) {
    await evaluateStatement(array.vals[i], env).then((_: void) => result.push(env.getLastResult()));
  }
  env.bindLastResult(result);
}
