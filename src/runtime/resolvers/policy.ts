import { JoinSpec } from '../../language/generated/ast.js';
import { Instance, InstanceAttributes, Relationship } from '../module.js';
import { logger } from '../logger.js';
import { Resolver, JoinInfo, WhereClause } from './interface.js';
import { Environment } from '../interpreter.js';
import { ResolverAuthInfo } from './authinfo.js';
import { AppConfig } from '../state.js';

// ---------------------------------------------------------------------------
// Part A: Policy Model & Parser
// ---------------------------------------------------------------------------

export interface TimeoutPolicy {
  connectTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface RetryBackoff {
  strategy: 'exponential' | 'linear' | 'constant';
  delayMs: number;
  factor: number;
  maxDelayMs: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: RetryBackoff;
}

export interface CircuitBreakerPolicy {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

// Hardcoded fallbacks (used when AppConfig has no connectionPolicy section)
const FALLBACK_TIMEOUT: TimeoutPolicy = {
  connectTimeoutMs: 5000,
  requestTimeoutMs: 30000,
};

const FALLBACK_BACKOFF: RetryBackoff = {
  strategy: 'exponential',
  delayMs: 1000,
  factor: 2,
  maxDelayMs: 30000,
};

const FALLBACK_RETRY: RetryPolicy = {
  maxAttempts: 3,
  backoff: { ...FALLBACK_BACKOFF },
};

const FALLBACK_CIRCUIT_BREAKER: CircuitBreakerPolicy = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  halfOpenMaxAttempts: 1,
};

function getDefaultTimeout(): TimeoutPolicy {
  const cfg = AppConfig?.resolver?.connectionPolicy?.timeout;
  return {
    connectTimeoutMs: cfg?.connectTimeoutMs ?? FALLBACK_TIMEOUT.connectTimeoutMs,
    requestTimeoutMs: cfg?.requestTimeoutMs ?? FALLBACK_TIMEOUT.requestTimeoutMs,
  };
}

function getDefaultBackoff(): RetryBackoff {
  const cfg = AppConfig?.resolver?.connectionPolicy?.retry?.backoff;
  return {
    strategy: cfg?.strategy ?? FALLBACK_BACKOFF.strategy,
    delayMs: cfg?.delayMs ?? FALLBACK_BACKOFF.delayMs,
    factor: cfg?.factor ?? FALLBACK_BACKOFF.factor,
    maxDelayMs: cfg?.maxDelayMs ?? FALLBACK_BACKOFF.maxDelayMs,
  };
}

function getDefaultRetry(): RetryPolicy {
  const cfg = AppConfig?.resolver?.connectionPolicy?.retry;
  return {
    maxAttempts: cfg?.maxAttempts ?? FALLBACK_RETRY.maxAttempts,
    backoff: getDefaultBackoff(),
  };
}

function getDefaultCircuitBreaker(): CircuitBreakerPolicy {
  const cfg = AppConfig?.resolver?.connectionPolicy?.circuitBreaker;
  return {
    failureThreshold: cfg?.failureThreshold ?? FALLBACK_CIRCUIT_BREAKER.failureThreshold,
    resetTimeoutMs: cfg?.resetTimeoutMs ?? FALLBACK_CIRCUIT_BREAKER.resetTimeoutMs,
    halfOpenMaxAttempts: cfg?.halfOpenMaxAttempts ?? FALLBACK_CIRCUIT_BREAKER.halfOpenMaxAttempts,
  };
}

export class ConnectionPolicy {
  resolverName: string;
  timeout?: TimeoutPolicy;
  retry?: RetryPolicy;
  circuitBreaker?: CircuitBreakerPolicy;

  constructor(resolverName: string) {
    this.resolverName = resolverName;
  }

  hasAnyPolicy(): boolean {
    return (
      this.timeout !== undefined || this.retry !== undefined || this.circuitBreaker !== undefined
    );
  }

  toJSON(): object {
    const result: any = {};
    if (this.timeout) result.timeout = { ...this.timeout };
    if (this.retry) {
      result.retry = {
        maxAttempts: this.retry.maxAttempts,
        backoff: { ...this.retry.backoff },
      };
    }
    if (this.circuitBreaker) result.circuitBreaker = { ...this.circuitBreaker };
    return result;
  }

  static fromJSON(resolverName: string, json: any): ConnectionPolicy {
    const policy = new ConnectionPolicy(resolverName);
    if (json.timeout) {
      const defaults = getDefaultTimeout();
      policy.timeout = {
        connectTimeoutMs: json.timeout.connectTimeoutMs ?? defaults.connectTimeoutMs,
        requestTimeoutMs: json.timeout.requestTimeoutMs ?? defaults.requestTimeoutMs,
      };
    }
    if (json.retry) {
      const retryDefaults = getDefaultRetry();
      const backoffDefaults = getDefaultBackoff();
      const backoffJson = json.retry.backoff || {};
      policy.retry = {
        maxAttempts: json.retry.maxAttempts ?? retryDefaults.maxAttempts,
        backoff: {
          strategy: backoffJson.strategy ?? backoffDefaults.strategy,
          delayMs: backoffJson.delayMs ?? backoffDefaults.delayMs,
          factor: backoffJson.factor ?? backoffDefaults.factor,
          maxDelayMs: backoffJson.maxDelayMs ?? backoffDefaults.maxDelayMs,
        },
      };
    }
    if (json.circuitBreaker) {
      const defaults = getDefaultCircuitBreaker();
      policy.circuitBreaker = {
        failureThreshold: json.circuitBreaker.failureThreshold ?? defaults.failureThreshold,
        resetTimeoutMs: json.circuitBreaker.resetTimeoutMs ?? defaults.resetTimeoutMs,
        halfOpenMaxAttempts:
          json.circuitBreaker.halfOpenMaxAttempts ?? defaults.halfOpenMaxAttempts,
      };
    }
    return policy;
  }
}

function mapGet(map: Map<any, any>, key: string): any {
  // normalizeMetaValue produces Maps with MapKey objects as keys;
  // the MapKey has a .str property for string keys
  for (const [k, v] of map.entries()) {
    const keyStr = typeof k === 'string' ? k : k?.str;
    if (keyStr === key) return v;
  }
  return undefined;
}

function resolveMapValue(val: any, key: string): any {
  if (val instanceof Map) return mapGet(val, key);
  if (val && typeof val === 'object' && !(val instanceof Map)) return val[key];
  return undefined;
}

export function parseConnectionPolicy(
  resolverName: string,
  metaMap: Map<any, any>
): ConnectionPolicy | undefined {
  const cpRaw = mapGet(metaMap, 'connectionPolicy');
  if (!cpRaw) return undefined;

  const policy = new ConnectionPolicy(resolverName);

  // Parse timeout
  const timeoutRaw = resolveMapValue(cpRaw, 'timeout');
  if (timeoutRaw) {
    const defaults = getDefaultTimeout();
    policy.timeout = {
      connectTimeoutMs:
        resolveMapValue(timeoutRaw, 'connectTimeoutMs') ?? defaults.connectTimeoutMs,
      requestTimeoutMs:
        resolveMapValue(timeoutRaw, 'requestTimeoutMs') ?? defaults.requestTimeoutMs,
    };
  }

  // Parse retry
  const retryRaw = resolveMapValue(cpRaw, 'retry');
  if (retryRaw) {
    const retryDefaults = getDefaultRetry();
    const backoffDefaults = getDefaultBackoff();
    const backoffRaw = resolveMapValue(retryRaw, 'backoff') || {};
    policy.retry = {
      maxAttempts: resolveMapValue(retryRaw, 'maxAttempts') ?? retryDefaults.maxAttempts,
      backoff: {
        strategy: resolveMapValue(backoffRaw, 'strategy') ?? backoffDefaults.strategy,
        delayMs: resolveMapValue(backoffRaw, 'delayMs') ?? backoffDefaults.delayMs,
        factor: resolveMapValue(backoffRaw, 'factor') ?? backoffDefaults.factor,
        maxDelayMs: resolveMapValue(backoffRaw, 'maxDelayMs') ?? backoffDefaults.maxDelayMs,
      },
    };
  }

  // Parse circuit breaker
  const cbRaw = resolveMapValue(cpRaw, 'circuitBreaker');
  if (cbRaw) {
    const defaults = getDefaultCircuitBreaker();
    policy.circuitBreaker = {
      failureThreshold: resolveMapValue(cbRaw, 'failureThreshold') ?? defaults.failureThreshold,
      resetTimeoutMs: resolveMapValue(cbRaw, 'resetTimeoutMs') ?? defaults.resetTimeoutMs,
      halfOpenMaxAttempts:
        resolveMapValue(cbRaw, 'halfOpenMaxAttempts') ?? defaults.halfOpenMaxAttempts,
    };
  }

  return policy.hasAnyPolicy() ? policy : undefined;
}

// ---------------------------------------------------------------------------
// Policy Cache
// ---------------------------------------------------------------------------

const policyCache = new Map<string, ConnectionPolicy>();

export function registerConnectionPolicy(resolverName: string, policy: ConnectionPolicy): void {
  policyCache.set(resolverName, policy);
}

export function getConnectionPolicy(resolverName: string): ConnectionPolicy | undefined {
  return policyCache.get(resolverName);
}

export function resetPolicyCache(): void {
  policyCache.clear();
}

// ---------------------------------------------------------------------------
// Part B: Policy Enforcement Engine
// ---------------------------------------------------------------------------

export class TimeoutError extends Error {
  constructor(operationName: string, timeoutMs: number) {
    super(`Operation '${operationName}' timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export class CircuitOpenError extends Error {
  constructor(resolverName: string) {
    super(`Circuit breaker is open for resolver '${resolverName}'`);
    this.name = 'CircuitOpenError';
  }
}

export function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new TimeoutError(operationName, timeoutMs));
      }
    }, timeoutMs);

    fn()
      .then(result => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      })
      .catch(err => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

export function calculateDelay(attempt: number, backoff: RetryBackoff): number {
  let delay: number;
  switch (backoff.strategy) {
    case 'exponential':
      delay = backoff.delayMs * Math.pow(backoff.factor, attempt);
      break;
    case 'linear':
      delay = backoff.delayMs * (attempt + 1);
      break;
    case 'constant':
      delay = backoff.delayMs;
      break;
    default:
      delay = backoff.delayMs;
  }
  return Math.min(delay, backoff.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retryPolicy: RetryPolicy,
  operationName: string
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < retryPolicy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retryPolicy.maxAttempts - 1) {
        const delay = calculateDelay(attempt, retryPolicy.backoff);
        logger.debug(
          `Retry ${attempt + 1}/${retryPolicy.maxAttempts} for '${operationName}' after ${delay}ms`
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// Circuit breaker states
export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export class CircuitBreakerState {
  state: CircuitState = CircuitState.CLOSED;
  failureCount: number = 0;
  lastFailureTime: number = 0;
  halfOpenAttempts: number = 0;
}

const circuitStates = new Map<string, CircuitBreakerState>();

export function getCircuitBreakerState(resolverName: string): CircuitBreakerState {
  let state = circuitStates.get(resolverName);
  if (!state) {
    state = new CircuitBreakerState();
    circuitStates.set(resolverName, state);
  }
  return state;
}

export function resetCircuitBreakerState(resolverName: string): void {
  circuitStates.delete(resolverName);
}

export function resetAllCircuitBreakerStates(): void {
  circuitStates.clear();
}

export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  cbPolicy: CircuitBreakerPolicy,
  resolverName: string,
  operationName: string
): Promise<T> {
  const cbState = getCircuitBreakerState(resolverName);

  // Check if circuit should transition from open to half-open
  if (cbState.state === CircuitState.OPEN) {
    const elapsed = Date.now() - cbState.lastFailureTime;
    if (elapsed >= cbPolicy.resetTimeoutMs) {
      cbState.state = CircuitState.HALF_OPEN;
      cbState.halfOpenAttempts = 0;
      logger.debug(`Circuit breaker for '${resolverName}' transitioning to half-open`);
    } else {
      throw new CircuitOpenError(resolverName);
    }
  }

  // In half-open state, only allow limited attempts
  if (cbState.state === CircuitState.HALF_OPEN) {
    if (cbState.halfOpenAttempts >= cbPolicy.halfOpenMaxAttempts) {
      throw new CircuitOpenError(resolverName);
    }
    cbState.halfOpenAttempts++;
  }

  try {
    const result = await fn();
    // Success: reset to closed state
    if (cbState.state === CircuitState.HALF_OPEN || cbState.state === CircuitState.CLOSED) {
      cbState.state = CircuitState.CLOSED;
      cbState.failureCount = 0;
      cbState.halfOpenAttempts = 0;
    }
    return result;
  } catch (err) {
    cbState.failureCount++;
    cbState.lastFailureTime = Date.now();

    if (cbState.state === CircuitState.HALF_OPEN) {
      // Failure in half-open: go back to open
      cbState.state = CircuitState.OPEN;
      logger.debug(
        `Circuit breaker for '${resolverName}' reopened after half-open failure in '${operationName}'`
      );
    } else if (cbState.failureCount >= cbPolicy.failureThreshold) {
      cbState.state = CircuitState.OPEN;
      logger.debug(
        `Circuit breaker for '${resolverName}' opened after ${cbState.failureCount} failures in '${operationName}'`
      );
    }

    throw err;
  }
}

export function applyPolicies<T>(
  policy: ConnectionPolicy,
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  // Build middleware chain: operation -> timeout -> retry -> circuit breaker (inner to outer)
  let wrapped = operation;

  if (policy.timeout) {
    const timeoutMs = policy.timeout.requestTimeoutMs;
    const inner = wrapped;
    wrapped = () => withTimeout(inner, timeoutMs, operationName);
  }

  if (policy.retry) {
    const retryPolicy = policy.retry;
    const inner = wrapped;
    wrapped = () => withRetry(inner, retryPolicy, operationName);
  }

  if (policy.circuitBreaker) {
    const cbPolicy = policy.circuitBreaker;
    const resolverName = policy.resolverName;
    const inner = wrapped;
    wrapped = () => withCircuitBreaker(inner, cbPolicy, resolverName, operationName);
  }

  return wrapped();
}

// ---------------------------------------------------------------------------
// Part C: PolicyResolver Decorator
// ---------------------------------------------------------------------------

export class PolicyResolver extends Resolver {
  private inner: Resolver;
  private policy: ConnectionPolicy;

  constructor(inner: Resolver, policy: ConnectionPolicy) {
    super(inner.getName());
    this.inner = inner;
    this.policy = policy;
  }

  // --- Pass-through methods (no policy wrapping) ---

  public override setAuthInfo(authInfo: ResolverAuthInfo): Resolver {
    this.inner.setAuthInfo(authInfo);
    return this;
  }

  public override setEnvironment(env: Environment): Resolver {
    this.inner.setEnvironment(env);
    return this;
  }

  public override getEnvironment(): Environment | undefined {
    return this.inner.getEnvironment();
  }

  public override suspend(): Resolver {
    this.inner.suspend();
    return this;
  }

  public override onSetPath(moduleName: string, entryName: string): any {
    return this.inner.onSetPath(moduleName, entryName);
  }

  public override async startTransaction(): Promise<any> {
    return this.inner.startTransaction();
  }

  public override async commitTransaction(txnId: string): Promise<any> {
    return this.inner.commitTransaction(txnId);
  }

  public override async rollbackTransaction(txnId: string): Promise<any> {
    return this.inner.rollbackTransaction(txnId);
  }

  public override async subscribe(): Promise<any> {
    return this.inner.subscribe();
  }

  public override async onSubscription(
    result: any,
    callPostCrudEvent: boolean = false
  ): Promise<any> {
    return this.inner.onSubscription(result, callPostCrudEvent);
  }

  // --- Policy-wrapped methods ---

  public override async createInstance(inst: Instance): Promise<any> {
    return applyPolicies(this.policy, () => this.inner.createInstance(inst), 'createInstance');
  }

  public override async upsertInstance(inst: Instance): Promise<any> {
    return applyPolicies(this.policy, () => this.inner.upsertInstance(inst), 'upsertInstance');
  }

  public override async updateInstance(inst: Instance, newAttrs: InstanceAttributes): Promise<any> {
    return applyPolicies(
      this.policy,
      () => this.inner.updateInstance(inst, newAttrs),
      'updateInstance'
    );
  }

  public override async queryInstances(
    inst: Instance,
    queryAll: boolean,
    distinct: boolean = false
  ): Promise<any> {
    return applyPolicies(
      this.policy,
      () => this.inner.queryInstances(inst, queryAll, distinct),
      'queryInstances'
    );
  }

  public override async queryChildInstances(parentPath: string, inst: Instance): Promise<any> {
    return applyPolicies(
      this.policy,
      () => this.inner.queryChildInstances(parentPath, inst),
      'queryChildInstances'
    );
  }

  public override async queryConnectedInstances(
    relationship: Relationship,
    connectedInstance: Instance,
    inst: Instance,
    connectedAlias?: string
  ): Promise<any> {
    return applyPolicies(
      this.policy,
      () =>
        this.inner.queryConnectedInstances(relationship, connectedInstance, inst, connectedAlias),
      'queryConnectedInstances'
    );
  }

  public override async queryByJoin(
    inst: Instance,
    joinInfo: JoinInfo[],
    intoSpec: Map<string, string>,
    distinct: boolean = false,
    rawJoinSpec?: JoinSpec[],
    whereClauses?: WhereClause[]
  ): Promise<any> {
    return applyPolicies(
      this.policy,
      () => this.inner.queryByJoin(inst, joinInfo, intoSpec, distinct, rawJoinSpec, whereClauses),
      'queryByJoin'
    );
  }

  public override async deleteInstance(inst: Instance | Instance[], purge: boolean): Promise<any> {
    return applyPolicies(
      this.policy,
      () => this.inner.deleteInstance(inst, purge),
      'deleteInstance'
    );
  }

  public override async handleInstancesLink(
    node1: Instance,
    otherNodeOrNodes: Instance | Instance[],
    relEntry: Relationship,
    orUpdate: boolean,
    inDeleteMode: boolean
  ): Promise<any> {
    return applyPolicies(
      this.policy,
      () =>
        this.inner.handleInstancesLink(node1, otherNodeOrNodes, relEntry, orUpdate, inDeleteMode),
      'handleInstancesLink'
    );
  }

  public override async fullTextSearch(
    entryName: string,
    moduleName: string,
    query: string,
    options?: any
  ): Promise<any> {
    return applyPolicies(
      this.policy,
      () => this.inner.fullTextSearch(entryName, moduleName, query, options),
      'fullTextSearch'
    );
  }
}
