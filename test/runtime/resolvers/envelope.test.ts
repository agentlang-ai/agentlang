import { describe, test, assert, vi } from 'vitest';
// Import interpreter first to establish correct module loading order (breaks circular dep)
import '../../../src/runtime/interpreter.js';
import {
  createSubscriptionEnvelope,
  isSubscriptionEnvelope,
  envelopeToSessionInfo,
} from '../../../src/runtime/resolvers/envelope.js';
import { Environment } from '../../../src/runtime/interpreter.js';
import { Resolver } from '../../../src/runtime/resolvers/interface.js';
import { createTestEnvelope } from './utils.js';
import { AdminUserId } from '../../../src/runtime/auth/defs.js';

describe('SubscriptionEnvelope', () => {
  describe('createSubscriptionEnvelope', () => {
    test('returns correct shape', () => {
      const envelope = createSubscriptionEnvelope('tenant-1', 'user-1', { key: 'value' });
      assert.equal(envelope.tenantId, 'tenant-1');
      assert.equal(envelope.userId, 'user-1');
      assert.deepEqual(envelope.data, { key: 'value' });
    });

    test('throws on empty tenantId', () => {
      assert.throws(() => createSubscriptionEnvelope('', 'user-1', {}), /non-empty tenantId/);
    });

    test('throws on whitespace-only tenantId', () => {
      assert.throws(() => createSubscriptionEnvelope('   ', 'user-1', {}), /non-empty tenantId/);
    });

    test('throws on empty userId', () => {
      assert.throws(() => createSubscriptionEnvelope('tenant-1', '', {}), /non-empty userId/);
    });

    test('throws on whitespace-only userId', () => {
      assert.throws(() => createSubscriptionEnvelope('tenant-1', '   ', {}), /non-empty userId/);
    });

    test('preserves data of various types', () => {
      const arrayData = [1, 2, 3];
      const e1 = createSubscriptionEnvelope('t', 'u', arrayData);
      assert.deepEqual(e1.data, [1, 2, 3]);

      const e2 = createSubscriptionEnvelope('t', 'u', 'string-data');
      assert.equal(e2.data, 'string-data');

      const e3 = createSubscriptionEnvelope('t', 'u', null);
      assert.equal(e3.data, null);
    });
  });

  describe('isSubscriptionEnvelope', () => {
    test('returns true for valid envelopes', () => {
      const envelope = createSubscriptionEnvelope('tenant-1', 'user-1', { x: 1 });
      assert.isTrue(isSubscriptionEnvelope(envelope));
    });

    test('returns true for manually constructed envelope-like objects', () => {
      assert.isTrue(isSubscriptionEnvelope({ tenantId: 'a', userId: 'b', data: 123 }));
    });

    test('returns true when data is null', () => {
      assert.isTrue(isSubscriptionEnvelope({ tenantId: 'a', userId: 'b', data: null }));
    });

    test('returns true when data is undefined', () => {
      assert.isTrue(isSubscriptionEnvelope({ tenantId: 'a', userId: 'b', data: undefined }));
    });

    test('returns false for null', () => {
      assert.isFalse(isSubscriptionEnvelope(null));
    });

    test('returns false for undefined', () => {
      assert.isFalse(isSubscriptionEnvelope(undefined));
    });

    test('returns false for plain objects without required fields', () => {
      assert.isFalse(isSubscriptionEnvelope({}));
      assert.isFalse(isSubscriptionEnvelope({ foo: 'bar' }));
    });

    test('returns false for partial objects', () => {
      assert.isFalse(isSubscriptionEnvelope({ tenantId: 'a' }));
      assert.isFalse(isSubscriptionEnvelope({ userId: 'b' }));
      assert.isFalse(isSubscriptionEnvelope({ data: 'c' }));
      assert.isFalse(isSubscriptionEnvelope({ tenantId: 'a', userId: 'b' }));
      assert.isFalse(isSubscriptionEnvelope({ tenantId: 'a', data: 'c' }));
      assert.isFalse(isSubscriptionEnvelope({ userId: 'b', data: 'c' }));
    });

    test('returns false for non-string tenantId or userId', () => {
      assert.isFalse(isSubscriptionEnvelope({ tenantId: 123, userId: 'b', data: null }));
      assert.isFalse(isSubscriptionEnvelope({ tenantId: 'a', userId: 456, data: null }));
    });

    test('returns false for primitives', () => {
      assert.isFalse(isSubscriptionEnvelope(42));
      assert.isFalse(isSubscriptionEnvelope('string'));
      assert.isFalse(isSubscriptionEnvelope(true));
    });
  });

  describe('envelopeToSessionInfo', () => {
    test('creates valid ActiveSessionInfo', () => {
      const envelope = createSubscriptionEnvelope('tenant-1', 'user-42', { key: 'val' });
      const session = envelopeToSessionInfo(envelope);
      assert.equal(session.userId, 'user-42');
      assert.isString(session.sessionId);
      assert.isTrue(session.sessionId.length > 0);
    });

    test('generates unique sessionIds across calls', () => {
      const envelope = createSubscriptionEnvelope('t', 'u', {});
      const s1 = envelopeToSessionInfo(envelope);
      const s2 = envelopeToSessionInfo(envelope);
      assert.notEqual(s1.sessionId, s2.sessionId);
    });
  });

  describe('createTestEnvelope helper', () => {
    test('creates envelope with defaults', () => {
      const envelope = createTestEnvelope();
      assert.isTrue(isSubscriptionEnvelope(envelope));
      assert.isString(envelope.tenantId);
      assert.isString(envelope.userId);
      assert.deepEqual(envelope.data, { foo: 'bar' });
    });

    test('creates envelope with custom values', () => {
      const envelope = createTestEnvelope('my-user', 'my-tenant', [1, 2]);
      assert.equal(envelope.userId, 'my-user');
      assert.equal(envelope.tenantId, 'my-tenant');
      assert.deepEqual(envelope.data, [1, 2]);
    });
  });

  describe('Environment.activeTenantId', () => {
    test('defaults to undefined', () => {
      const env = new Environment('test-env');
      assert.isUndefined(env.getActiveTenantId());
    });

    test('set/get round-trip', () => {
      const env = new Environment('test-env');
      env.setActiveTenantId('tenant-abc');
      assert.equal(env.getActiveTenantId(), 'tenant-abc');
    });

    test('propagates to child environments', () => {
      const parent = new Environment('parent');
      parent.setActiveTenantId('tenant-xyz');
      const child = new Environment('child', parent);
      assert.equal(child.getActiveTenantId(), 'tenant-xyz');
    });

    test('child can override parent tenantId', () => {
      const parent = new Environment('parent');
      parent.setActiveTenantId('tenant-parent');
      const child = new Environment('child', parent);
      child.setActiveTenantId('tenant-child');
      assert.equal(child.getActiveTenantId(), 'tenant-child');
      assert.equal(parent.getActiveTenantId(), 'tenant-parent');
    });
  });

  describe('onSubscription with envelope', () => {
    test('undefined result returns immediately', async () => {
      const resolver = new Resolver('test-sub');
      const result = await resolver.onSubscription(undefined);
      assert.isUndefined(result);
    });

    test('raw result (no envelope) with callPostCrudEvent=false works unchanged', async () => {
      const resolver = new Resolver('test-sub');
      // Without a subscription event registered, this should just return undefined
      const result = await resolver.onSubscription({ someData: 'value' }, false);
      assert.isUndefined(result);
    });
  });

  describe('Resolver.onCreate/onUpdate/onDelete with envelope', () => {
    function mockInstance(overrides?: Record<string, any>) {
      return {
        requireAudit: () => false,
        record: {
          getPostTriggerInfo: () => undefined,
          getPreTriggerInfo: () => undefined,
        },
        setAuthContext: vi.fn().mockReturnThis(),
        ...overrides,
      } as any;
    }

    test('without envelope, behavior is unchanged', async () => {
      const resolver = new Resolver('test');
      const env = new Environment('test-env');
      const inst = mockInstance();

      await resolver.onCreate(inst, env);
      assert.equal(env.getActiveUser(), AdminUserId);
      assert.isUndefined(env.getActiveTenantId());
    });

    test('with envelope, env gets correct activeUser and activeTenantId', async () => {
      const resolver = new Resolver('test');
      const env = new Environment('test-env');
      const inst = mockInstance();
      const envelope = createSubscriptionEnvelope('tenant-99', 'user-99', {});

      await resolver.onCreate(inst, env, envelope);
      assert.equal(env.getActiveUser(), 'user-99');
      assert.equal(env.getActiveTenantId(), 'tenant-99');
      assert.isTrue(inst.setAuthContext.mock.calls.length > 0);
      const sessionArg = inst.setAuthContext.mock.calls[0][0];
      assert.equal(sessionArg.userId, 'user-99');
    });

    test('onUpdate with envelope sets auth context', async () => {
      const resolver = new Resolver('test');
      const env = new Environment('test-env');
      const inst = mockInstance();
      const envelope = createSubscriptionEnvelope('tenant-u', 'user-u', {});

      await resolver.onUpdate(inst, env, envelope);
      assert.equal(env.getActiveUser(), 'user-u');
      assert.equal(env.getActiveTenantId(), 'tenant-u');
    });

    test('onDelete with envelope sets auth context', async () => {
      const resolver = new Resolver('test');
      const env = new Environment('test-env');
      const inst = mockInstance();
      const envelope = createSubscriptionEnvelope('tenant-d', 'user-d', {});

      await resolver.onDelete(inst, env, envelope);
      assert.equal(env.getActiveUser(), 'user-d');
      assert.equal(env.getActiveTenantId(), 'tenant-d');
    });
  });
});
