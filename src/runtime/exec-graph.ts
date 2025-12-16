import {
  CrudMap,
  Delete,
  Expr,
  ForEach,
  FullTextSearch,
  If,
  isPattern,
  isStatement,
  isWorkflowDefinition,
  ModuleDefinition,
  Pattern,
  Purge,
  Return,
  Statement,
  ThrowError,
} from '../language/generated/ast.js';
import { parseModule, parseStatement } from '../language/parser.js';
import { ExecGraph, ExecGraphNode, ExecGraphWalker, SubGraphType } from './defs.js';
import {
  DocEventName,
  Environment,
  evaluateExpression,
  evaluatePattern,
  evaluateStatement,
  handleAgentInvocation,
  handleOpenApiEvent,
  maybeBindStatementResultToAlias,
  maybeDeleteQueriedInstances,
  PatternHandler,
  setEvaluateFn,
  setParseAndEvaluateStatementFn,
} from './interpreter.js';
import {
  fetchModule,
  getWorkflowForEvent,
  Instance,
  isAgentEvent,
  isAgentEventInstance,
  isEmptyWorkflow,
  isEventInstance,
  RecordType,
} from './module.js';
import { flushMonitoringData } from './modules/core.js';
import { isOpenApiEventInstance, isOpenApiModule } from './openapi.js';
import { isMonitoringEnabled } from './state.js';
import {
  escapeQueryName,
  isCoreDefinition,
  isCoreModule,
  isFqName,
  makeFqName,
  nameToPath,
} from './util.js';

const GraphCache = new Map<string, ExecGraph>();

export async function generateExecutionGraph(eventName: string): Promise<ExecGraph | undefined> {
  const cg = GraphCache.get(eventName);
  if (cg) return cg;
  const wf = getWorkflowForEvent(eventName);
  const parts = nameToPath(eventName);
  const moduleName = parts.hasModule() ? parts.getModuleName() : undefined;
  if (!isEmptyWorkflow(wf)) {
    const g = (await graphFromStatements(wf.statements, moduleName)).setEventName(eventName);
    if (g.canCache()) GraphCache.set(eventName, g);
    return g;
  }
  return undefined;
}

class GraphGenerator extends PatternHandler {
  private graph: ExecGraph = new ExecGraph();

  private genericHandler(env: Environment) {
    this.graph.pushNode(new ExecGraphNode(env.getActiveUserData()));
  }

  override async handleExpression(_: Expr, env: Environment) {
    this.genericHandler(env);
  }

  override async handleCrudMap(crudMap: CrudMap, env: Environment) {
    const parts = nameToPath(crudMap.name);
    const moduleName = parts.hasModule() ? parts.getModuleName() : env.getActiveModuleName();
    const crudName = makeFqName(moduleName, parts.getEntryName());
    if (crudName == DocEventName) {
      return this.genericHandler(env);
    }
    if (isOpenApiModule(moduleName)) {
      return this.genericHandler(env);
    }
    const module = fetchModule(moduleName);
    const record = module.getRecord(escapeQueryName(parts.getEntryName()));
    if (record.type == RecordType.EVENT) {
      if (isAgentEvent(record)) {
        this.graph.pushNode(new ExecGraphNode(env.getActiveUserData(), -2, SubGraphType.AGENT));
        this.graph.setHasAgents(true);
        return;
      } else {
        const g = await generateExecutionGraph(crudName);
        if (g) {
          return this.addSubGraph(SubGraphType.EVENT, g, env);
        }
      }
    }
    this.genericHandler(env);
  }

  override async handleForEach(forEach: ForEach, env: Environment) {
    const handler = new GraphGenerator();
    const srcEnv = Environment.from(env).setActiveUserData(forEach.src);
    await evaluatePattern(forEach.src, srcEnv, handler);
    const srcg = handler.getGraph();
    const g = await graphFromStatements(forEach.statements, env.getActiveModuleName());
    srcg.pushSubGraph(g);
    this.addSubGraph(SubGraphType.FOR_EACH, srcg, env);
  }

  override async handleIf(ifStmt: If, env: Environment) {
    const handler = new GraphGenerator();
    await handler.handleExpression(
      ifStmt.cond,
      Environment.from(env).setActiveUserData(ifStmt.cond)
    );
    const cond = handler.getGraph();
    const conseq = await graphFromStatements(ifStmt.statements, env.getActiveModuleName());
    cond.pushSubGraph(conseq);
    if (ifStmt.else !== undefined) {
      const alter = await graphFromStatements(ifStmt.else.statements, env.getActiveModuleName());
      cond.pushSubGraph(alter);
    } else {
      cond.pushSubGraph(ExecGraph.Empty);
    }
    this.addSubGraph(SubGraphType.IF, cond, env);
  }

  private async handleSubPattern(subGraphType: SubGraphType, pat: Pattern, env: Environment) {
    const newEnv = Environment.from(env).setActiveUserData(pat);
    const handler = new GraphGenerator();
    await evaluatePattern(pat, newEnv, handler);
    this.addSubGraph(subGraphType, handler.getGraph(), env);
  }

  override async handleDelete(del: Delete, env: Environment) {
    this.handleSubPattern(SubGraphType.DELETE, del.pattern, env);
  }

  override async handlePurge(purge: Purge, env: Environment) {
    this.handleSubPattern(SubGraphType.PURGE, purge.pattern, env);
  }

  override async handleFullTextSearch(_: FullTextSearch, env: Environment) {
    this.genericHandler(env);
  }

  override async handleReturn(ret: Return, env: Environment) {
    this.handleSubPattern(SubGraphType.RETURN, ret.pattern, env);
  }

  override async handleThrow(throwErr: ThrowError, env: Environment) {
    const handler = new GraphGenerator();
    await handler.handleExpression(
      throwErr.reason,
      Environment.from(env).setActiveUserData(throwErr.reason)
    );
    this.addSubGraph(SubGraphType.THROW, handler.getGraph(), env);
  }

  getGraph(): ExecGraph {
    return this.graph;
  }

  private addSubGraph(subGraphType: SubGraphType, g: ExecGraph, env: Environment) {
    this.graph.pushSubGraph(g);
    this.graph.pushNode(
      new ExecGraphNode(env.getActiveUserData(), this.graph.getLastSubGraphIndex(), subGraphType)
    );
  }
}

async function graphFromStatements(
  stmts: Statement[],
  activeModuleName?: string
): Promise<ExecGraph> {
  const handler = new GraphGenerator();
  const env = new Environment();
  if (activeModuleName) {
    env.switchActiveModuleName(activeModuleName);
  }
  for (let i = 0; i < stmts.length; ++i) {
    const stmt = stmts[i];
    env.setActiveUserData(stmt);
    await evaluatePattern(stmt.pattern, env, handler);
  }
  return handler.getGraph().setActiveModuleName(activeModuleName);
}

function makeStatementsExecutor(execGraph: ExecGraph, triggeringNode: ExecGraphNode): Function {
  return async (stmts: Statement[], env: Environment): Promise<any> => {
    const g = await graphFromStatements(stmts, env.getActiveModuleName());
    if (execGraph && triggeringNode) {
      execGraph.pushSubGraph(g);
      triggeringNode.subGraphIndex = execGraph.getLastSubGraphIndex();
    }
    await executeGraph(g, env);
    return env.getLastResult();
  };
}

export async function executeGraph(execGraph: ExecGraph, env: Environment): Promise<any> {
  const activeModuleName = execGraph.getActiveModuleName();
  env.setEventExecutor(executeEventHelper);
  let oldModule: string | undefined = undefined;
  if (activeModuleName) {
    oldModule = env.switchActiveModuleName(activeModuleName);
  }
  const coreMod = activeModuleName ? isCoreModule(activeModuleName) : false;
  const monitoringEnabled = !coreMod && isMonitoringEnabled();
  try {
    const walker = new ExecGraphWalker(execGraph);
    while (walker.hasNext()) {
      if (env.isMarkedForReturn()) {
        break;
      }
      const node = walker.nextNode();

      const monitorIncr =
        monitoringEnabled &&
        node.subGraphIndex !== -1 &&
        (node.subGraphType == SubGraphType.AGENT || node.subGraphType == SubGraphType.EVENT);

      if (node.codeStr && monitoringEnabled) {
        if (!isSystemCrudPattern(node.code, activeModuleName)) {
          if (monitorIncr) {
            env.incrementMonitor();
          }
          env.appendEntryToMonitor(node.codeStr);
        }
      }
      try {
        if (node.subGraphIndex == -1) {
          await evaluateStatement(node.code as Statement, env);
        } else {
          if (node.subGraphType == SubGraphType.AGENT) {
            await executeAgent(node, execGraph, env);
          } else {
            const subg = execGraph.fetchSubGraphAt(node.subGraphIndex);
            switch (node.subGraphType) {
              case SubGraphType.EVENT:
                await evaluateStatement(node.code as Statement, env);
                break;
              case SubGraphType.IF: {
                const newEnv = new Environment(`${env.name}-if`, env);
                await executeIfSubGraph(subg, newEnv);
                env.setLastResult(newEnv.getLastResult());
                break;
              }
              case SubGraphType.FOR_EACH: {
                const newEnv = new Environment(`${env.name}-forEach`, env);
                await executeForEachSubGraph(subg, node, newEnv);
                env.setLastResult(newEnv.getLastResult());
                break;
              }
              case SubGraphType.DELETE:
                await executeDeleteSubGraph(subg, node, env);
                break;
              case SubGraphType.PURGE:
                await executePurgeSubGraph(subg, node, env);
                break;
              case SubGraphType.RETURN:
                await executeReturnSubGraph(subg, env);
                return;
              case SubGraphType.THROW:
                await evaluateExpression(subg.getRootNodes()[0].code as Expr, env);
                throw new Error(env.getLastResult());
              default:
                throw new Error(`Invalid sub-graph type: ${node.subGraphType}`);
            }
          }
          maybeSetAlias(node, env);
        }
      } catch (reason: any) {
        if (monitoringEnabled) env.setMonitorEntryError(reason);
        throw reason;
      } finally {
        if (monitoringEnabled) {
          if (monitorIncr) env.decrementMonitor();
          env.setMonitorEntryResult(env.getLastResult());
        }
      }
    }
  } finally {
    if (oldModule) {
      env.switchActiveModuleName(oldModule);
    }
  }
}

function isSystemCrudPattern(
  code: Statement | Pattern | Expr,
  activeModuleName: string | undefined
): boolean {
  if (isStatement(code)) {
    return isSystemCrudPattern(code.pattern, activeModuleName);
  } else if (isPattern(code)) {
    const crud = code.crudMap;
    if (crud) {
      if (isFqName(crud.name)) return isCoreDefinition(crud.name);
      else if (activeModuleName) return isCoreModule(activeModuleName);
    }
  }
  return false;
}

async function evaluateFirstPattern(g: ExecGraph, env: Environment) {
  await evaluatePattern(g.getRootNodes()[0].code as Pattern, env);
}

async function executeForEachSubGraph(
  subGraph: ExecGraph,
  triggeringNode: ExecGraphNode,
  env: Environment
) {
  await evaluateFirstPattern(subGraph, env);
  const rs: any[] = env.getLastResult();
  if (rs.length > 0) {
    const stmt = triggeringNode.code as Statement;
    const loopVar = stmt.pattern.forEach?.var || 'x';
    const loopEnv: Environment = new Environment('for-each-body-env', env);
    const loopg = subGraph.fetchForEachBodySubGraph();
    const finalResult = new Array<any>();
    for (let i = 0; i < rs.length; ++i) {
      loopEnv.bind(loopVar, rs[i]);
      await executeGraph(loopg, loopEnv);
      finalResult.push(loopEnv.getLastResult());
    }
    env.setLastResult(finalResult);
  } else {
    env.setLastResult([]);
  }
}

async function executeIfSubGraph(subGraph: ExecGraph, env: Environment) {
  await evaluateExpression(subGraph.getRootNodes()[0].code as Expr, env);
  const newEnv = new Environment('cond-env', env);
  if (env.getLastResult()) {
    const conseq = subGraph.fetchIfConsequentSubGraph();
    await executeGraph(conseq, newEnv);
  } else {
    const alter = subGraph.fetchIfAlternativeSubGraph();
    if (alter) {
      if (ExecGraph.isEmpty(alter)) {
        newEnv.setLastResult(false);
      } else {
        await executeGraph(alter, newEnv);
      }
    }
  }
  env.setLastResult(newEnv.getLastResult());
}

async function executeAgent(triggeringNode: ExecGraphNode, execGraph: ExecGraph, env: Environment) {
  await env.callWithStatementsExecutor(
    makeStatementsExecutor(execGraph, triggeringNode),
    async () => {
      await evaluateStatement(triggeringNode.code as Statement, env);
      return env.getLastResult();
    }
  );
}

async function executeReturnSubGraph(subGraph: ExecGraph, env: Environment) {
  await evaluateFirstPattern(subGraph, env);
  env.markForReturn();
}

async function executeDeleteSubGraph(subGraph: ExecGraph, node: ExecGraphNode, env: Environment) {
  const newEnv = new Environment(`delete-env`, env).setInDeleteMode(true);
  await evaluateFirstPattern(subGraph, newEnv);
  await maybeDeleteQueriedInstances(newEnv, env, false);
  maybeSetAlias(node, env);
}

async function executePurgeSubGraph(subGraph: ExecGraph, node: ExecGraphNode, env: Environment) {
  const newEnv = new Environment(`purge-env`, env).setInDeleteMode(true);
  await evaluateFirstPattern(subGraph, newEnv);
  await maybeDeleteQueriedInstances(newEnv, env, true);
  maybeSetAlias(node, env);
}

export async function executeEvent(
  eventInstance: Instance,
  continuation?: Function,
  activeEnv?: Environment,
  kernelCall?: boolean
): Promise<any> {
  const env: Environment = new Environment(eventInstance.name + '.env', activeEnv);
  env.setStatementsExecutor(executeStatementsHelper);
  let txnRolledBack: boolean = false;
  try {
    if (isEventInstance(eventInstance)) {
      if (kernelCall) {
        env.setInKernelMode(true);
      }
      env.setActiveEvent(eventInstance);
      await executeEventHelper(eventInstance, env);
    } else if (isAgentEventInstance(eventInstance)) {
      await handleAgentInvocation(eventInstance, env);
    }
    const r = env.getLastResult();
    if (continuation) continuation(r);
    return r;
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
    if (!txnRolledBack && env !== undefined && activeEnv === undefined) {
      await env.commitAllTransactions();
    }
    if (isMonitoringEnabled()) {
      await flushMonitoringData(eventInstance.getId());
    }
  }
}

export async function executeEventHelper(eventInstance: Instance, env?: Environment): Promise<any> {
  if (isOpenApiEventInstance(eventInstance)) {
    env = env || new Environment();
    await handleOpenApiEvent(eventInstance, env);
    return env.getLastResult();
  }
  const fqn = eventInstance.getFqName();
  let isLocalEnv = false;
  if (env === undefined) {
    env = new Environment(`${fqn}-env`);
    isLocalEnv = true;
  }
  let g: ExecGraph | undefined;
  if (!isAgentEventInstance(eventInstance)) {
    g = await generateExecutionGraph(fqn);
    if (!g) {
      throw new Error(`Failed to generate graph for event ${fqn}`);
    }
  }
  const oldModuleName = env.switchActiveModuleName(eventInstance.moduleName);
  env.bind(eventInstance.name, eventInstance);
  try {
    if (g) {
      await executeGraph(g, env);
    } else {
      if (isMonitoringEnabled()) {
        env.appendEntryToMonitor(
          `{${eventInstance.getFqName()} {message "${eventInstance.lookup('message')}"}}`
        );
      }
      await handleAgentInvocation(eventInstance, env);
    }
    if (isLocalEnv) {
      await env.commitAllTransactions();
    }
    return env.getLastResult();
  } catch (err: any) {
    if (isLocalEnv) {
      await env.rollbackAllTransactions();
    }
    throw err;
  } finally {
    if (!isLocalEnv) env.switchActiveModuleName(oldModuleName);
  }
}

export async function executeStatement(
  stmt: string,
  env?: Environment,
  activeModule?: string
): Promise<any> {
  return await executeStatements([stmt], env, activeModule);
}

export async function executeStatements(
  stmts: string[],
  env?: Environment,
  activeModule?: string
): Promise<any> {
  const mod: ModuleDefinition = await parseModule(
    `module Temp\nworkflow TempEvent { ${stmts.join(';')} }`
  );
  if (isWorkflowDefinition(mod.defs[0])) {
    return await executeStatementsHelper(mod.defs[0].statements, env, activeModule);
  } else {
    throw new Error('Failed to extract workflow-statement');
  }
}

async function executeStatementsHelper(
  stmts: Statement[],
  env?: Environment,
  activeModule?: string
): Promise<any> {
  const g = await graphFromStatements(stmts);
  let isLocalEnv = false;
  if (env === undefined) {
    env = new Environment(`stmt-exec-env`);
    isLocalEnv = true;
  }
  let oldModuleName: string | undefined = undefined;
  if (activeModule) {
    oldModuleName = env.switchActiveModuleName(activeModule);
  }
  try {
    await executeGraph(g, env);
    if (isLocalEnv) {
      await env.commitAllTransactions();
    }
    return env.getLastResult();
  } catch (err: any) {
    if (isLocalEnv) {
      await env.rollbackAllTransactions();
    }
    throw err;
  } finally {
    if (oldModuleName) {
      env.switchActiveModuleName(oldModuleName);
    }
  }
}

async function executeStatementHelper(stmt: Statement, env: Environment): Promise<any> {
  return await executeStatementsHelper([stmt], env);
}

export async function parseAndExecuteStatement(
  stmtString: string,
  activeUserId?: string,
  actievEnv?: Environment
): Promise<any> {
  const env = actievEnv ? actievEnv : new Environment();
  if (activeUserId) {
    env.setActiveUser(activeUserId);
  }
  let commit: boolean = true;
  try {
    const stmt: Statement = await parseStatement(stmtString);
    if (stmt) {
      await executeStatementHelper(stmt, env);
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

function maybeSetAlias(node: ExecGraphNode, env: Environment) {
  const stmt = node.code as Statement;
  const hints = stmt.hints;
  if (hints && hints.length > 0) {
    maybeBindStatementResultToAlias(hints, env);
  }
}

export type EvalFns = {
  evaluate: Function;
  parseAndEvaluateStatement: Function;
};

export function enableExecutionGraph(): EvalFns {
  const e = setEvaluateFn(executeEvent);
  const es = setParseAndEvaluateStatementFn(parseAndExecuteStatement);
  return { evaluate: e, parseAndEvaluateStatement: es };
}

export function disableExecutionGraph(oldFns: EvalFns): boolean {
  if (oldFns.evaluate && oldFns.parseAndEvaluateStatement) {
    setEvaluateFn(oldFns.evaluate);
    setParseAndEvaluateStatementFn(oldFns.parseAndEvaluateStatement);
    return true;
  }
  return false;
}
