import {
  CrudMap,
  Delete,
  Expr,
  ForEach,
  FullTextSearch,
  If,
  Purge,
  Return,
  Statement,
} from '../language/generated/ast.js';
import { ExecGraph, ExecGraphWalker } from './defs.js';
import {
  DocEventName,
  Environment,
  evaluatePattern,
  evaluateStatement,
  PatternHandler,
} from './interpreter.js';
import {
  fetchModule,
  getWorkflowForEvent,
  isAgentEvent,
  isEmptyWorkflow,
  RecordType,
} from './module.js';
import { isOpenApiModule } from './openapi.js';
import { splitFqName } from './util.js';

export async function generateExecutionGraph(eventName: string): Promise<ExecGraph | undefined> {
  const wf = getWorkflowForEvent(eventName);
  if (!isEmptyWorkflow(wf)) {
    return await graphFromStatements(wf.statements);
  }
  return undefined;
}

class GraphGenerator extends PatternHandler {
  private graph: ExecGraph = new ExecGraph();
  private activeOffset = 0;

  private genericHandler(env: Environment, generic: boolean = true) {
    this.graph.pushNode({
      statement: env.activeUserData,
      next: ++this.activeOffset,
      generic: generic,
    });
  }

  override async handleExpression(_: Expr, env: Environment) {
    this.genericHandler(env);
  }

  override async handleCrudMap(crudMap: CrudMap, env: Environment) {
    if (crudMap.name == DocEventName) {
      return this.genericHandler(env);
    }
    const parts = splitFqName(crudMap.name);
    const moduleName = parts.getModuleName();
    if (isOpenApiModule(moduleName)) {
      return this.genericHandler(env);
    }
    const module = fetchModule(moduleName);
    const record = module.getRecord(parts.getEntryName());
    if (record.type == RecordType.EVENT) {
      if (isAgentEvent(record)) {
        return this.genericHandler(env, false);
      }
      const g = await generateExecutionGraph(crudMap.name);
      if (g) {
        return this.addSubGraph(g, env);
      }
    }
    this.genericHandler(env);
  }

  override async handleForEach(forEach: ForEach, env: Environment) {
    const handler = new GraphGenerator();
    await evaluatePattern(forEach.src, env, handler);
    const srcg = handler.getGraph();
    const g = await graphFromStatements(forEach.statements);
    srcg.pushSubGraph(g, 0);
    this.addSubGraph(srcg, env);
  }

  override async handleIf(ifStmt: If, env: Environment) {
    const handler = new GraphGenerator();
    await handler.handleExpression(ifStmt.cond, env);
    const cond = handler.getGraph();
    const conseq = await graphFromStatements(ifStmt.statements);
    if (ifStmt.else != undefined) {
      const alter = await graphFromStatements(ifStmt.else.statements);
      conseq.pushSubGraph(alter, 0);
    }
    cond.pushSubGraph(conseq, 0);
    this.addSubGraph(cond, env);
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

  private addSubGraph(g: ExecGraph, env: Environment) {
    this.graph.pushSubGraph(g, this.activeOffset);
    this.graph.pushNode({
      statement: env.activeUserData,
      subGraphIndex: this.graph.subGraphLength() - 1,
      next: ++this.activeOffset,
      generic: false,
    });
  }
}

async function graphFromStatements(stmts: Statement[]): Promise<ExecGraph> {
  const handler = new GraphGenerator();
  const env = Environment.EmptyEnvironment;
  for (let i = 0; i < stmts.length; ++i) {
    const stmt = stmts[i];
    env.activeUserData = stmt;
    await evaluatePattern(stmt.pattern, env, handler);
  }
  return handler.getGraph();
}

export async function executeGraph(execGraph: ExecGraph, env: Environment): Promise<any> {
  const walker = new ExecGraphWalker(execGraph);
  while (walker.hasNext()) {
    const node = walker.nextNode();
    if (node.generic) {
      await evaluateStatement(node.statement, env);
    } else {
      // TODO: deal with special handling of graph-node
    }
  }
}
