import { Expr, Pattern, Statement } from '../language/generated/ast.js';

export const PathAttributeName: string = '__path__';
export const PathAttributeNameQuery: string = '__path__?';
export const ParentAttributeName: string = '__parent__';
export const DeletedFlagAttributeName: string = '__is_deleted__';

export type UnautInfo = {
  opr: string;
  entity: string;
};

function asUnauthMessage(obj: string | UnautInfo): string {
  if (typeof obj == 'string') {
    return obj;
  } else {
    return `User not authorised to perform '${obj.opr}' on ${obj.entity}`;
  }
}

export class UnauthorisedError extends Error {
  constructor(message?: string | UnautInfo, options?: ErrorOptions) {
    super(
      message ? asUnauthMessage(message) : 'User not authorised to perform this operation',
      options
    );
  }
}

export class BadRequestError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message ? asUnauthMessage(message) : 'BadRequest', options);
  }
}

export class UserNotFoundError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message || 'User not found', options);
  }
}

export class UserNotConfirmedError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(
      message || 'User account is not confirmed. Please check your email for verification code.',
      options
    );
  }
}

export class PasswordResetRequiredError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message || 'Password reset is required for this account', options);
  }
}

export class TooManyRequestsError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message || 'Too many requests. Please try again later.', options);
  }
}

export class InvalidParameterError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message || 'Invalid parameters provided', options);
  }
}

export class ExpiredCodeError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message || 'The verification code has expired. Please request a new one.', options);
  }
}

export class CodeMismatchError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message || 'The verification code is incorrect. Please try again.', options);
  }
}

export let FetchModuleFn: any = undefined;

export function setModuleFnFetcher(f: Function) {
  FetchModuleFn = f;
}

export let SetSubscription: any = undefined;

export function setSubscriptionFn(f: Function) {
  SetSubscription = f;
}

export const ForceReadPermFlag = 'f-r-f';
export const FlowSuspensionTag = `--`;

export enum SubGraphType {
  EVENT,
  IF,
  FOR_EACH,
  DELETE,
  PURGE,
  RETURN,
  AGENT,
  NONE,
}

export class ExecGraphNode {
  code: Statement | Pattern | Expr;
  codeAtr: string | undefined;
  subGraphIndex: number;
  subGraphType: SubGraphType;

  constructor(
    statement: Statement | Pattern | Expr,
    subGraphIndex: number = -1,
    subGraphType: SubGraphType = SubGraphType.NONE
  ) {
    this.code = statement;
    this.codeAtr = this.code.$cstNode?.text;
    this.subGraphType = subGraphType;
    this.subGraphIndex = subGraphIndex;
  }
}

export class ExecGraph {
  private rootNodes: ExecGraphNode[];
  private subGraphs: ExecGraph[];
  private parentGraph: ExecGraph | undefined = undefined;
  private activeModuleName: string | undefined;

  static Empty = new ExecGraph();

  static isEmpty(g: ExecGraph): boolean {
    return Object.is(ExecGraph.Empty, g);
  }

  constructor() {
    this.rootNodes = new Array<ExecGraphNode>();
    this.subGraphs = new Array<ExecGraph>();
  }

  pushNode(node: ExecGraphNode): ExecGraph {
    this.rootNodes.push(node);
    return this;
  }

  pushSubGraph(execGraph: ExecGraph): ExecGraph {
    execGraph.parentGraph = this;
    this.subGraphs.push(execGraph);
    return this;
  }

  getSubGraphsLength(): number {
    return this.subGraphs.length;
  }

  fetchSubGraphAt(index: number): ExecGraph {
    if (index < 0 || index >= this.subGraphs.length) {
      throw new Error(`Invalid sub-graph index: ${index}`);
    }
    return this.subGraphs[index];
  }

  fetchForEachBodySubGraph(): ExecGraph {
    return this.fetchSubGraphAt(this.subGraphs.length - 1);
  }

  fetchIfConsequentSubGraph(): ExecGraph {
    return this.fetchSubGraphAt(this.subGraphs.length - 2);
  }

  fetchIfAlternativeSubGraph(): ExecGraph {
    return this.fetchSubGraphAt(this.subGraphs.length - 1);
  }

  getRootNodes(): ExecGraphNode[] {
    return this.rootNodes;
  }

  setActiveModuleName(moduleName: string | undefined): ExecGraph {
    if (moduleName) this.activeModuleName = moduleName;
    return this;
  }

  getActiveModuleName(): string | undefined {
    return this.activeModuleName;
  }

  getParentGraph(): ExecGraph | undefined {
    return this.parentGraph;
  }
}

export class ExecGraphWalker {
  private offset = 0;
  private maxOffset: number;
  private rootNodes;

  constructor(execGraph: ExecGraph) {
    this.rootNodes = execGraph.getRootNodes();
    this.maxOffset = this.rootNodes.length;
  }

  hasNext(): boolean {
    return this.offset < this.maxOffset;
  }

  nextNode(): ExecGraphNode {
    if (this.offset < this.maxOffset) {
      return this.rootNodes[this.offset++];
    }
    throw new Error('End of execution-graph');
  }
}
