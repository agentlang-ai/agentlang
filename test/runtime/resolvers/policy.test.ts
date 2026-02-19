import { describe, test, assert, beforeEach, vi } from 'vitest';
// Import interpreter first to establish correct module loading order (breaks circular dep)
import '../../../src/runtime/interpreter.js';
import {
  ConnectionPolicy,
  parseConnectionPolicy,
  registerConnectionPolicy,
  getConnectionPolicy,
  resetPolicyCache,
  withTimeout,
  withRetry,
  withCircuitBreaker,
  applyPolicies,
  calculateDelay,
  TimeoutError,
  CircuitOpenError,
  CircuitState,
  getCircuitBreakerState,
  resetCircuitBreakerState,
  resetAllCircuitBreakerStates,
  PolicyResolver,
} from '../../../src/runtime/resolvers/policy.js';
import { createInMemoryResolver } from './utils.js';
import { Instance } from '../../../src/runtime/module.js';
import {
  startPolicyRefreshTimer,
  stopPolicyRefreshTimer,
} from '../../../src/runtime/modules/policy.js';

function mockInstance(id: string): Instance {
  const attrs = new Map<string, any>([['id', id]]);
  // Use Object.create so instanceof Instance returns true
  const inst = Object.create(Instance.prototype) as Instance;
  inst.attributes = attrs;
  inst.moduleName = 'test';
  inst.name = 'Entity';
  (inst as any).lookup = (key: string) => attrs.get(key);
  return inst;
}

function mockQueryInstance(id?: string): Instance {
  const inst = mockInstance(id || '');
  if (id) {
    inst.queryAttributeValues = new Map([['id', id]]);
  }
  return inst;
}

// ---------------------------------------------------------------------------
// ConnectionPolicy model
// ---------------------------------------------------------------------------
describe('ConnectionPolicy model', () => {
  test('parse valid policy from Map with all fields', () => {
    const meta = new Map<string, any>();
    const timeoutMap = new Map<string, any>();
    timeoutMap.set('connectTimeoutMs', 3000);
    timeoutMap.set('requestTimeoutMs', 15000);

    const backoffMap = new Map<string, any>();
    backoffMap.set('strategy', 'linear');
    backoffMap.set('delayMs', 500);
    backoffMap.set('factor', 3);
    backoffMap.set('maxDelayMs', 10000);

    const retryMap = new Map<string, any>();
    retryMap.set('maxAttempts', 5);
    retryMap.set('backoff', backoffMap);

    const cbMap = new Map<string, any>();
    cbMap.set('failureThreshold', 10);
    cbMap.set('resetTimeoutMs', 30000);
    cbMap.set('halfOpenMaxAttempts', 2);

    const cpMap = new Map<string, any>();
    cpMap.set('timeout', timeoutMap);
    cpMap.set('retry', retryMap);
    cpMap.set('circuitBreaker', cbMap);

    meta.set('connectionPolicy', cpMap);

    const policy = parseConnectionPolicy('test/resolver', meta);
    assert.ok(policy);
    assert.equal(policy!.resolverName, 'test/resolver');
    assert.deepEqual(policy!.timeout, { connectTimeoutMs: 3000, requestTimeoutMs: 15000 });
    assert.equal(policy!.retry!.maxAttempts, 5);
    assert.equal(policy!.retry!.backoff.strategy, 'linear');
    assert.equal(policy!.retry!.backoff.delayMs, 500);
    assert.equal(policy!.retry!.backoff.factor, 3);
    assert.equal(policy!.retry!.backoff.maxDelayMs, 10000);
    assert.deepEqual(policy!.circuitBreaker, {
      failureThreshold: 10,
      resetTimeoutMs: 30000,
      halfOpenMaxAttempts: 2,
    });
  });

  test('parse partial policy - only timeout', () => {
    const meta = new Map<string, any>();
    const timeoutMap = new Map<string, any>();
    timeoutMap.set('connectTimeoutMs', 2000);

    const cpMap = new Map<string, any>();
    cpMap.set('timeout', timeoutMap);
    meta.set('connectionPolicy', cpMap);

    const policy = parseConnectionPolicy('test/resolver', meta);
    assert.ok(policy);
    assert.ok(policy!.timeout);
    assert.equal(policy!.timeout!.connectTimeoutMs, 2000);
    assert.equal(policy!.timeout!.requestTimeoutMs, 30000); // default
    assert.equal(policy!.retry, undefined);
    assert.equal(policy!.circuitBreaker, undefined);
  });

  test('parse partial policy - only retry', () => {
    const meta = new Map<string, any>();
    const retryMap = new Map<string, any>();
    retryMap.set('maxAttempts', 4);

    const cpMap = new Map<string, any>();
    cpMap.set('retry', retryMap);
    meta.set('connectionPolicy', cpMap);

    const policy = parseConnectionPolicy('test/resolver', meta);
    assert.ok(policy);
    assert.equal(policy!.timeout, undefined);
    assert.ok(policy!.retry);
    assert.equal(policy!.retry!.maxAttempts, 4);
    // defaults for backoff
    assert.equal(policy!.retry!.backoff.strategy, 'exponential');
    assert.equal(policy!.retry!.backoff.delayMs, 1000);
  });

  test('parse partial policy - only circuit breaker', () => {
    const meta = new Map<string, any>();
    const cbMap = new Map<string, any>();
    cbMap.set('failureThreshold', 3);

    const cpMap = new Map<string, any>();
    cpMap.set('circuitBreaker', cbMap);
    meta.set('connectionPolicy', cpMap);

    const policy = parseConnectionPolicy('test/resolver', meta);
    assert.ok(policy);
    assert.equal(policy!.timeout, undefined);
    assert.equal(policy!.retry, undefined);
    assert.ok(policy!.circuitBreaker);
    assert.equal(policy!.circuitBreaker!.failureThreshold, 3);
    assert.equal(policy!.circuitBreaker!.resetTimeoutMs, 60000); // default
    assert.equal(policy!.circuitBreaker!.halfOpenMaxAttempts, 1); // default
  });

  test('parse empty/missing connectionPolicy returns undefined', () => {
    const meta = new Map<string, any>();
    assert.equal(parseConnectionPolicy('test/resolver', meta), undefined);

    const meta2 = new Map<string, any>();
    meta2.set('someOtherKey', 'value');
    assert.equal(parseConnectionPolicy('test/resolver', meta2), undefined);
  });

  test('default values applied correctly', () => {
    const meta = new Map<string, any>();
    const cpMap = new Map<string, any>();
    // Empty sub-maps to trigger defaults
    cpMap.set('timeout', new Map<string, any>());
    cpMap.set('retry', new Map<string, any>());
    cpMap.set('circuitBreaker', new Map<string, any>());
    meta.set('connectionPolicy', cpMap);

    const policy = parseConnectionPolicy('test/resolver', meta);
    assert.ok(policy);
    assert.deepEqual(policy!.timeout, { connectTimeoutMs: 5000, requestTimeoutMs: 30000 });
    assert.equal(policy!.retry!.maxAttempts, 3);
    assert.equal(policy!.retry!.backoff.strategy, 'exponential');
    assert.equal(policy!.retry!.backoff.delayMs, 1000);
    assert.equal(policy!.retry!.backoff.factor, 2);
    assert.equal(policy!.retry!.backoff.maxDelayMs, 30000);
    assert.deepEqual(policy!.circuitBreaker, {
      failureThreshold: 5,
      resetTimeoutMs: 60000,
      halfOpenMaxAttempts: 1,
    });
  });

  test('toJSON / fromJSON round-trip', () => {
    const policy = new ConnectionPolicy('test/resolver');
    policy.timeout = { connectTimeoutMs: 3000, requestTimeoutMs: 15000 };
    policy.retry = {
      maxAttempts: 5,
      backoff: { strategy: 'linear', delayMs: 500, factor: 3, maxDelayMs: 10000 },
    };
    policy.circuitBreaker = { failureThreshold: 10, resetTimeoutMs: 30000, halfOpenMaxAttempts: 2 };

    const json = policy.toJSON();
    const restored = ConnectionPolicy.fromJSON('test/resolver', json);

    assert.deepEqual(restored.timeout, policy.timeout);
    assert.deepEqual(restored.retry, policy.retry);
    assert.deepEqual(restored.circuitBreaker, policy.circuitBreaker);
    assert.equal(restored.resolverName, 'test/resolver');
  });

  test('hasAnyPolicy returns false for empty policy', () => {
    const policy = new ConnectionPolicy('test/resolver');
    assert.equal(policy.hasAnyPolicy(), false);
  });

  test('hasAnyPolicy returns true when any policy is set', () => {
    const p1 = new ConnectionPolicy('test/resolver');
    p1.timeout = { connectTimeoutMs: 5000, requestTimeoutMs: 30000 };
    assert.equal(p1.hasAnyPolicy(), true);

    const p2 = new ConnectionPolicy('test/resolver');
    p2.retry = {
      maxAttempts: 3,
      backoff: { strategy: 'exponential', delayMs: 1000, factor: 2, maxDelayMs: 30000 },
    };
    assert.equal(p2.hasAnyPolicy(), true);

    const p3 = new ConnectionPolicy('test/resolver');
    p3.circuitBreaker = { failureThreshold: 5, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 };
    assert.equal(p3.hasAnyPolicy(), true);
  });
});

// ---------------------------------------------------------------------------
// Policy Cache
// ---------------------------------------------------------------------------
describe('Policy cache', () => {
  beforeEach(() => {
    resetPolicyCache();
  });

  test('register and retrieve policy', () => {
    const policy = new ConnectionPolicy('test/resolver');
    policy.timeout = { connectTimeoutMs: 1000, requestTimeoutMs: 5000 };
    registerConnectionPolicy('test/resolver', policy);
    const retrieved = getConnectionPolicy('test/resolver');
    assert.ok(retrieved);
    assert.equal(retrieved!.resolverName, 'test/resolver');
  });

  test('returns undefined for unregistered resolver', () => {
    assert.equal(getConnectionPolicy('nonexistent'), undefined);
  });

  test('reset clears all entries', () => {
    const policy = new ConnectionPolicy('test/resolver');
    policy.timeout = { connectTimeoutMs: 1000, requestTimeoutMs: 5000 };
    registerConnectionPolicy('test/resolver', policy);
    resetPolicyCache();
    assert.equal(getConnectionPolicy('test/resolver'), undefined);
  });
});

// ---------------------------------------------------------------------------
// Timeout enforcer
// ---------------------------------------------------------------------------
describe('withTimeout', () => {
  test('completes within limit', async () => {
    const result = await withTimeout(async () => 'ok', 1000, 'test-op');
    assert.equal(result, 'ok');
  });

  test('exceeds limit and rejects', async () => {
    try {
      await withTimeout(
        () => new Promise(resolve => setTimeout(() => resolve('late'), 500)),
        50,
        'test-op'
      );
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.ok(err instanceof TimeoutError);
      assert.ok(err.message.includes('test-op'));
      assert.ok(err.message.includes('50ms'));
    }
  });
});

// ---------------------------------------------------------------------------
// Retry enforcer
// ---------------------------------------------------------------------------
describe('withRetry', () => {
  const fastRetryPolicy = {
    maxAttempts: 3,
    backoff: { strategy: 'constant' as const, delayMs: 10, factor: 1, maxDelayMs: 100 },
  };

  test('succeeds first try', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return 'ok';
      },
      fastRetryPolicy,
      'test-op'
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  test('fails then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('fail');
        return 'ok';
      },
      fastRetryPolicy,
      'test-op'
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
  });

  test('exhausts all attempts', async () => {
    let calls = 0;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new Error('always fail');
        },
        fastRetryPolicy,
        'test-op'
      );
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.message, 'always fail');
      assert.equal(calls, 3);
    }
  });
});

// ---------------------------------------------------------------------------
// Backoff delay calculation
// ---------------------------------------------------------------------------
describe('calculateDelay', () => {
  test('exponential backoff', () => {
    const backoff = {
      strategy: 'exponential' as const,
      delayMs: 1000,
      factor: 2,
      maxDelayMs: 30000,
    };
    assert.equal(calculateDelay(0, backoff), 1000); // 1000 * 2^0 = 1000
    assert.equal(calculateDelay(1, backoff), 2000); // 1000 * 2^1 = 2000
    assert.equal(calculateDelay(2, backoff), 4000); // 1000 * 2^2 = 4000
    assert.equal(calculateDelay(3, backoff), 8000); // 1000 * 2^3 = 8000
  });

  test('linear backoff', () => {
    const backoff = { strategy: 'linear' as const, delayMs: 1000, factor: 2, maxDelayMs: 30000 };
    assert.equal(calculateDelay(0, backoff), 1000); // 1000 * 1
    assert.equal(calculateDelay(1, backoff), 2000); // 1000 * 2
    assert.equal(calculateDelay(2, backoff), 3000); // 1000 * 3
  });

  test('constant backoff', () => {
    const backoff = { strategy: 'constant' as const, delayMs: 500, factor: 2, maxDelayMs: 30000 };
    assert.equal(calculateDelay(0, backoff), 500);
    assert.equal(calculateDelay(1, backoff), 500);
    assert.equal(calculateDelay(5, backoff), 500);
  });

  test('respects maxDelayMs', () => {
    const backoff = {
      strategy: 'exponential' as const,
      delayMs: 1000,
      factor: 10,
      maxDelayMs: 5000,
    };
    assert.equal(calculateDelay(0, backoff), 1000);
    assert.equal(calculateDelay(1, backoff), 5000); // capped at maxDelayMs
    assert.equal(calculateDelay(2, backoff), 5000); // capped
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker enforcer
// ---------------------------------------------------------------------------
describe('withCircuitBreaker', () => {
  const cbPolicy = { failureThreshold: 3, resetTimeoutMs: 100, halfOpenMaxAttempts: 1 };
  const resolverName = 'test-cb-resolver';

  beforeEach(() => {
    resetCircuitBreakerState(resolverName);
  });

  test('closed state passes through', async () => {
    const result = await withCircuitBreaker(async () => 'ok', cbPolicy, resolverName, 'test-op');
    assert.equal(result, 'ok');
    const state = getCircuitBreakerState(resolverName);
    assert.equal(state.state, CircuitState.CLOSED);
    assert.equal(state.failureCount, 0);
  });

  test('opens after threshold failures', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await withCircuitBreaker(
          async () => {
            throw new Error('fail');
          },
          cbPolicy,
          resolverName,
          'test-op'
        );
      } catch {}
    }
    const state = getCircuitBreakerState(resolverName);
    assert.equal(state.state, CircuitState.OPEN);
    assert.equal(state.failureCount, 3);
  });

  test('rejects in open state', async () => {
    // Force open
    const state = getCircuitBreakerState(resolverName);
    state.state = CircuitState.OPEN;
    state.lastFailureTime = Date.now();

    try {
      await withCircuitBreaker(async () => 'ok', cbPolicy, resolverName, 'test-op');
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.ok(err instanceof CircuitOpenError);
    }
  });

  test('transitions to half-open after reset timeout', async () => {
    const state = getCircuitBreakerState(resolverName);
    state.state = CircuitState.OPEN;
    state.lastFailureTime = Date.now() - 200; // well past the 100ms reset timeout

    const result = await withCircuitBreaker(async () => 'ok', cbPolicy, resolverName, 'test-op');
    assert.equal(result, 'ok');
    assert.equal(state.state, CircuitState.CLOSED); // success closes it
  });

  test('closes on half-open success', async () => {
    const state = getCircuitBreakerState(resolverName);
    state.state = CircuitState.OPEN;
    state.lastFailureTime = Date.now() - 200;

    await withCircuitBreaker(async () => 'ok', cbPolicy, resolverName, 'test-op');
    assert.equal(state.state, CircuitState.CLOSED);
    assert.equal(state.failureCount, 0);
  });

  test('reopens on half-open failure', async () => {
    const state = getCircuitBreakerState(resolverName);
    state.state = CircuitState.OPEN;
    state.lastFailureTime = Date.now() - 200;

    try {
      await withCircuitBreaker(
        async () => {
          throw new Error('fail in half-open');
        },
        cbPolicy,
        resolverName,
        'test-op'
      );
    } catch {}

    assert.equal(state.state, CircuitState.OPEN);
  });
});

// ---------------------------------------------------------------------------
// applyPolicies
// ---------------------------------------------------------------------------
describe('applyPolicies', () => {
  test('chains timeout + retry + circuit breaker correctly', async () => {
    resetAllCircuitBreakerStates();
    const policy = new ConnectionPolicy('test/resolver');
    policy.timeout = { connectTimeoutMs: 5000, requestTimeoutMs: 1000 };
    policy.retry = {
      maxAttempts: 2,
      backoff: { strategy: 'constant', delayMs: 10, factor: 1, maxDelayMs: 100 },
    };
    policy.circuitBreaker = { failureThreshold: 5, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 };

    let calls = 0;
    const result = await applyPolicies(
      policy,
      async () => {
        calls++;
        if (calls < 2) throw new Error('transient');
        return 'success';
      },
      'test-op'
    );
    assert.equal(result, 'success');
    assert.equal(calls, 2);
  });

  test('applies only timeout when only timeout is set', async () => {
    const policy = new ConnectionPolicy('test/resolver');
    policy.timeout = { connectTimeoutMs: 5000, requestTimeoutMs: 500 };

    const result = await applyPolicies(policy, async () => 'ok', 'test-op');
    assert.equal(result, 'ok');
  });

  test('applies no wrapping for empty policy', async () => {
    const policy = new ConnectionPolicy('test/resolver');
    const result = await applyPolicies(policy, async () => 'ok', 'test-op');
    assert.equal(result, 'ok');
  });
});

// ---------------------------------------------------------------------------
// PolicyResolver
// ---------------------------------------------------------------------------
describe('PolicyResolver', () => {
  test('CRUD operations pass through with policies active', async () => {
    const { resolver: inner, store } = createInMemoryResolver('test-inner');
    const policy = new ConnectionPolicy('test-inner');
    policy.timeout = { connectTimeoutMs: 5000, requestTimeoutMs: 5000 };
    const wrapped = new PolicyResolver(inner, policy);

    // Create
    const inst = mockInstance('1');
    const created = await wrapped.createInstance(inst);
    assert.ok(created);
    assert.equal(store.size, 1);

    // Query
    const queryInst = mockQueryInstance('1');
    const results = await wrapped.queryInstances(queryInst, false);
    assert.ok(results instanceof Array);
    assert.equal(results.length, 1);

    // Upsert
    const upsertInst = mockInstance('2');
    await wrapped.upsertInstance(upsertInst);
    assert.equal(store.size, 2);

    // Delete
    const delInst = mockInstance('1');
    await wrapped.deleteInstance(delInst, false);
    assert.equal(store.size, 1);
  });

  test('timeout causes failure propagation', async () => {
    const { resolver: inner } = createInMemoryResolver('test-inner-timeout');
    const policy = new ConnectionPolicy('test-inner-timeout');
    policy.timeout = { connectTimeoutMs: 1000, requestTimeoutMs: 50 };
    const wrapped = new PolicyResolver(inner, policy);

    // Override the inner resolver's query to be slow
    inner.implementation!.query = async () => {
      return new Promise(resolve => setTimeout(() => resolve([]), 500));
    };

    const queryInst = mockQueryInstance();
    try {
      await wrapped.queryInstances(queryInst, true);
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.ok(err instanceof TimeoutError);
    }
  });

  test('transaction methods pass through without policy wrapping', async () => {
    const { resolver: inner } = createInMemoryResolver('test-inner-txn');
    const policy = new ConnectionPolicy('test-inner-txn');
    policy.timeout = { connectTimeoutMs: 100, requestTimeoutMs: 100 };
    const wrapped = new PolicyResolver(inner, policy);

    // These should not throw even though they are "not implemented" - they just pass through
    const txnId = await wrapped.startTransaction();
    await wrapped.commitTransaction(String(txnId));
    await wrapped.rollbackTransaction(String(txnId));
  });

  test('setEnvironment and setAuthInfo pass through to inner', () => {
    const { resolver: inner } = createInMemoryResolver('test-inner-env');
    const policy = new ConnectionPolicy('test-inner-env');
    const wrapped = new PolicyResolver(inner, policy);

    // These should not throw and should delegate to inner
    wrapped.setAuthInfo({ user: 'test', role: 'admin' } as any);
    assert.equal(wrapped.getEnvironment(), undefined);
  });
});

// ---------------------------------------------------------------------------
// Policy refresh timer
// ---------------------------------------------------------------------------
describe('Policy refresh timer', () => {
  beforeEach(() => {
    stopPolicyRefreshTimer();
    vi.restoreAllMocks();
  });

  test('startPolicyRefreshTimer starts an interval', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    startPolicyRefreshTimer(60);
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(spy.mock.calls[0][1], 60000); // 60 seconds in ms
    stopPolicyRefreshTimer();
  });

  test('startPolicyRefreshTimer uses default 300s when no arg', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    startPolicyRefreshTimer();
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(spy.mock.calls[0][1], 300000); // 300 seconds in ms
    stopPolicyRefreshTimer();
  });

  test('calling startPolicyRefreshTimer twice clears previous timer', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    startPolicyRefreshTimer(10);
    startPolicyRefreshTimer(20);
    // Second call should have cleared the first timer
    assert.equal(clearIntervalSpy.mock.calls.length, 1);
    assert.equal(setIntervalSpy.mock.calls.length, 2);
    stopPolicyRefreshTimer();
  });

  test('stopPolicyRefreshTimer clears the timer', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    startPolicyRefreshTimer(10);
    stopPolicyRefreshTimer();
    assert.equal(clearIntervalSpy.mock.calls.length, 1);
    // Calling stop again should be a no-op (no extra clearInterval)
    stopPolicyRefreshTimer();
    assert.equal(clearIntervalSpy.mock.calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Dynamic cache propagation to factory
// ---------------------------------------------------------------------------
describe('Dynamic cache propagation', () => {
  beforeEach(() => {
    resetPolicyCache();
  });

  test('updating the policy cache changes what a factory would produce', () => {
    // Simulate: factory reads from cache, not a closure variable
    const resolverName = 'test/dynamic-resolver';

    // No policy registered yet
    assert.equal(getConnectionPolicy(resolverName), undefined);

    // Register a policy (simulates DB refresh)
    const policy = new ConnectionPolicy(resolverName);
    policy.timeout = { connectTimeoutMs: 1000, requestTimeoutMs: 5000 };
    registerConnectionPolicy(resolverName, policy);

    // Now the cache returns it
    const fetched = getConnectionPolicy(resolverName);
    assert.ok(fetched);
    assert.equal(fetched!.timeout!.requestTimeoutMs, 5000);

    // Update the cache with a new policy (simulates next refresh cycle)
    const updated = new ConnectionPolicy(resolverName);
    updated.timeout = { connectTimeoutMs: 2000, requestTimeoutMs: 10000 };
    registerConnectionPolicy(resolverName, updated);

    const refetched = getConnectionPolicy(resolverName);
    assert.ok(refetched);
    assert.equal(refetched!.timeout!.requestTimeoutMs, 10000);
  });
});
