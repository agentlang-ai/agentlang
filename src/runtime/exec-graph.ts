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
import { ExecGraph } from './defs.js';
import { Environment, evaluatePattern, PatternHandler } from './interpreter.js';
import { getWorkflowForEvent, isEmptyWorkflow } from './module.js';

export async function generateExecutionGraph(eventName: string): Promise<any> {
  const wf = getWorkflowForEvent(eventName);
  if (!isEmptyWorkflow(wf)) {
    return await graphFromStatements(wf.statements);
  }
  return undefined;
}

class GraphGenerator extends PatternHandler {
  private graph: ExecGraph = new ExecGraph();
  private activeOffset = 0;

  private genericHandler(env: Environment) {
    this.graph.pushNode({ statement: env.activeUserData, next: ++this.activeOffset });
  }

  override async handleExpression(_: Expr, env: Environment) {
    this.genericHandler(env);
  }

  override async handleCrudMap(_: CrudMap, env: Environment) {
    this.genericHandler(env);
  }

  override async handleForEach(forEach: ForEach, env: Environment) {
    const handler = new GraphGenerator();
    await evaluatePattern(forEach.src, env, handler);
    const srcg = handler.getGraph();
    const g = await graphFromStatements(forEach.statements);
    srcg.pushSubGraph(g, 0);
    this.graph.pushSubGraph(srcg, this.activeOffset);
    this.graph.pushNode({
      statement: env.activeUserData,
      subGraphIndex: this.graph.subGraphLength() - 1,
      next: ++this.activeOffset,
    });
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
    this.graph.pushSubGraph(cond, this.activeOffset);
    this.graph.pushNode({
      statement: env.activeUserData,
      subGraphIndex: this.graph.subGraphLength() - 1,
      next: ++this.activeOffset,
    });
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
