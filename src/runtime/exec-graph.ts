import {
  CrudMap,
  Delete,
  Expr,
  ForEach,
  FullTextSearch,
  If,
  isWorkflowDefinition,
  ModuleDefinition,
  Pattern,
  Purge,
  Return,
  Statement,
} from '../language/generated/ast.js';
import { parseModule } from '../language/parser.js';
import { ExecGraph, ExecGraphNode, ExecGraphWalker, SubGraphType } from './defs.js';
import {
  DocEventName,
  Environment,
  evaluateExpression,
  evaluatePattern,
  evaluateStatement,
  PatternHandler,
} from './interpreter.js';
import {
  fetchModule,
  getWorkflowForEvent,
  Instance,
  isAgentEvent,
  isEmptyWorkflow,
  RecordType,
} from './module.js';
import { isOpenApiModule } from './openapi.js';
import { escapeQueryName, splitFqName } from './util.js';

const GraphCache = new Map<string, ExecGraph>();

export async function generateExecutionGraph(eventName: string): Promise<ExecGraph | undefined> {
  const cg = GraphCache.get(eventName);
  if (cg) return cg;
  const wf = getWorkflowForEvent(eventName);
  const parts = splitFqName(eventName);
  const moduleName = parts.hasModule() ? parts.getModuleName() : undefined;
  if (!isEmptyWorkflow(wf)) {
    const g = await graphFromStatements(wf.statements, moduleName);
    GraphCache.set(eventName, g);
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
    if (crudMap.name == DocEventName) {
      return this.genericHandler(env);
    }
    const parts = splitFqName(crudMap.name);
    const moduleName = parts.hasModule() ? parts.getModuleName() : env.getActiveModuleName();
    if (isOpenApiModule(moduleName)) {
      return this.genericHandler(env);
    }
    const module = fetchModule(moduleName);
    const record = module.getRecord(escapeQueryName(parts.getEntryName()));
    if (record.type == RecordType.EVENT) {
      if (isAgentEvent(record)) {
        this.graph.pushNode(new ExecGraphNode(env.getActiveUserData(), -1, SubGraphType.AGENT));
        return;
      } else {
        const g = await generateExecutionGraph(crudMap.name);
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
    const g = await graphFromStatements(forEach.statements);
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
    const conseq = await graphFromStatements(ifStmt.statements);
    cond.pushSubGraph(conseq);
    if (ifStmt.else != undefined) {
      const alter = await graphFromStatements(ifStmt.else.statements);
      cond.pushSubGraph(alter);
    } else {
      cond.pushSubGraph(ExecGraph.Empty);
    }
    this.addSubGraph(SubGraphType.IF, cond, env);
  }

  override async handleDelete(_: Delete, env: Environment) {
    this.genericHandler(env);
  }

  override async handlePurge(_: Purge, env: Environment) {
    this.genericHandler(env);
  }

  override async handleFullTextSearch(_: FullTextSearch, env: Environment) {
    this.genericHandler(env);
  }

  override async handleReturn(_: Return, env: Environment) {
    this.genericHandler(env);
  }

  getGraph(): ExecGraph {
    return this.graph;
  }

  private addSubGraph(subGraphType: SubGraphType, g: ExecGraph, env: Environment) {
    this.graph.pushSubGraph(g);
    this.graph.pushNode(
      new ExecGraphNode(env.getActiveUserData(), this.graph.getSubGraphsLength() - 1, subGraphType)
    );
  }
}

async function graphFromStatements(
  stmts: Statement[],
  activeModuleName?: string
): Promise<ExecGraph> {
  const handler = new GraphGenerator();
  const env = Environment.EmptyEnvironment;
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

export async function executeGraph(execGraph: ExecGraph, env: Environment): Promise<any> {
  const activeModuleName = execGraph.getActiveModuleName();
  env.setGraphExecMode(true);
  let oldModule: string | undefined = undefined;
  if (activeModuleName) {
    oldModule = env.switchActiveModuleName(activeModuleName);
  }
  try {
    const walker = new ExecGraphWalker(execGraph);
    while (walker.hasNext()) {
      const node = walker.nextNode();
      if (node.subGraphIndex == -1) {
        await evaluateStatement(node.code as Statement, env);
      } else {
        const subg = execGraph.fetchSubGraphAt(node.subGraphIndex);
        switch (node.subGraphType) {
          case SubGraphType.EVENT:
            await executeEventSubGraph(subg, node, env);
            break;
          case SubGraphType.IF:
            await executeIfSubGraph(subg, env);
            break;
          case SubGraphType.FOR_EACH:
            await executeForEachSubGraph(subg, node, env);
            break;
          case SubGraphType.AGENT:
            await executeAgentSubGraph(subg, node, env);
            break;
          default:
            throw new Error(`Invalid sub-graph type: ${node.subGraphType}`);
        }
      }
    }
  } finally {
    if (oldModule) {
      env.switchActiveModuleName(oldModule);
    }
  }
}

async function executeEventSubGraph(
  subGraph: ExecGraph,
  triggeringNode: ExecGraphNode,
  env: Environment
) {
  await evaluateStatement(triggeringNode.code as Statement, env);
  const eventInst: Instance = env.getLastResult();
  const newEnv = new Environment(`${eventInst.name}-env`, env);
  newEnv.bind(eventInst.name, eventInst);
  await executeGraph(subGraph, newEnv);
  env.setLastResult(newEnv.getLastResult());
}

async function executeForEachSubGraph(
  subGraph: ExecGraph,
  triggeringNode: ExecGraphNode,
  env: Environment
) {
  await evaluatePattern(subGraph.getRootNodes()[0].code as Pattern, env);
  const rs: any[] = env.getLastResult();
  if (rs.length > 0) {
    const stmt = triggeringNode.code as Statement;
    const loopVar = stmt.pattern.forEach?.var || 'x';
    const loopEnv: Environment = Environment.from(env);
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
  const newEnv = Environment.from(env);
  if (env.getLastResult()) {
    const conseq = subGraph.fetchIfConsequentSubGraph();
    await executeGraph(conseq, newEnv);
  } else {
    const alter = subGraph.fetchIfAlternativeSubGraph();
    if (ExecGraph.isEmpty(alter)) {
      newEnv.setLastResult(false);
    } else {
      await executeGraph(alter, newEnv);
    }
  }
  env.setLastResult(newEnv.getLastResult());
}

async function executeAgentSubGraph(
  subGraph: ExecGraph,
  triggeringNode: ExecGraphNode,
  env: Environment
) {
  // TODO: planner agents should be allowed to extend the exec-graph
  await evaluateStatement(triggeringNode.code as Statement, env);
}

export async function executeEvent(eventInstance: Instance, env?: Environment): Promise<any> {
  const fqn = eventInstance.getFqName();
  let isLocalEnv = false;
  if (env == undefined) {
    env = new Environment(`${fqn}-env`);
    isLocalEnv = true;
  }
  const g = await generateExecutionGraph(fqn);
  if (!g) {
    throw new Error(`Failed to generate graph for event ${fqn}`);
  }
  const oldModuleName = env.switchActiveModuleName(eventInstance.moduleName);
  env.bind(eventInstance.name, eventInstance);
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
    if (!isLocalEnv) env.switchActiveModuleName(oldModuleName);
  }
}

export async function executeStatment(
  stmt: string,
  env?: Environment,
  activeModule?: string
): Promise<any> {
  return await excuteStatements([stmt], env, activeModule);
}

export async function excuteStatements(
  stmts: string[],
  env?: Environment,
  activeModule?: string
): Promise<any> {
  const mod: ModuleDefinition = await parseModule(
    `module Temp\nworkflow TempEvent { ${stmts.join(';')} }`
  );
  if (isWorkflowDefinition(mod.defs[0])) {
    const g = await graphFromStatements(mod.defs[0].statements);
    let isLocalEnv = false;
    if (env == undefined) {
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
  } else {
    throw new Error('Failed to extract workflow-statement');
  }
}
