import { describe, test, assert, vi } from 'vitest';
// Import interpreter first to establish correct module loading order (breaks circular dep)
import '../../../src/runtime/interpreter.js';
import {
  Resolver,
  GenericResolver,
  GenericResolverMethods,
} from '../../../src/runtime/resolvers/interface.js';
import { ResolverAuthInfo } from '../../../src/runtime/resolvers/authinfo.js';
import { Instance, InstanceAttributes } from '../../../src/runtime/module.js';

describe('Resolver base class', () => {
  test('Default static instance has name "default"', () => {
    assert.equal(Resolver.Default.getName(), 'default');
  });

  test('constructor without name uses "default"', () => {
    const r = new Resolver();
    assert.equal(r.getName(), 'default');
  });

  test('constructor with name uses provided name', () => {
    const r = new Resolver('custom');
    assert.equal(r.getName(), 'custom');
  });

  test('setAuthInfo returns self for chaining', () => {
    const r = new Resolver('chain');
    const auth = new ResolverAuthInfo('user-1');
    const result = r.setAuthInfo(auth);
    assert.equal(result, r);
  });

  test('setEnvironment/getEnvironment round-trip', () => {
    const r = new Resolver('env-test');
    assert.equal(r.getEnvironment(), undefined);
    const mockEnv = { suspend: vi.fn() } as any;
    const result = r.setEnvironment(mockEnv);
    assert.equal(result, r);
    assert.equal(r.getEnvironment(), mockEnv);
  });

  test('base CRUD methods return undefined (notImpl)', async () => {
    const r = new Resolver('base');
    const mockInst = {} as Instance;
    const mockAttrs = new Map() as InstanceAttributes;

    assert.equal(await r.createInstance(mockInst), undefined);
    assert.equal(await r.upsertInstance(mockInst), undefined);
    assert.equal(await r.updateInstance(mockInst, mockAttrs), undefined);
    assert.equal(await r.queryInstances(mockInst, false), undefined);
    assert.equal(await r.deleteInstance(mockInst, false), undefined);
  });

  test('startTransaction returns 1', async () => {
    const r = new Resolver('txn');
    const result = await r.startTransaction();
    assert.equal(result, 1);
  });

  test('subscribe returns undefined', async () => {
    const r = new Resolver('sub');
    const result = await r.subscribe();
    assert.equal(result, undefined);
  });

  test('suspend calls env.suspend() when env is set', () => {
    const r = new Resolver('susp');
    const mockEnv = { suspend: vi.fn() } as any;
    r.setEnvironment(mockEnv);
    r.suspend();
    assert.equal(mockEnv.suspend.mock.calls.length, 1);
  });

  test('suspend is no-op when env is not set', () => {
    const r = new Resolver('susp2');
    const result = r.suspend();
    assert.equal(result, r);
  });
});

describe('GenericResolver delegation', () => {
  function makeMethods(overrides: Partial<GenericResolverMethods> = {}): GenericResolverMethods {
    return {
      create: overrides.create ?? undefined,
      upsert: overrides.upsert ?? undefined,
      update: overrides.update ?? undefined,
      query: overrides.query ?? undefined,
      delete: overrides.delete ?? undefined,
      startTransaction: overrides.startTransaction ?? undefined,
      commitTransaction: overrides.commitTransaction ?? undefined,
      rollbackTransaction: overrides.rollbackTransaction ?? undefined,
    };
  }

  test('createInstance delegates to implementation when provided', async () => {
    const spy = vi.fn().mockResolvedValue('created');
    const gr = new GenericResolver('del', makeMethods({ create: spy }));
    const mockInst = { attributes: new Map() } as unknown as Instance;
    const result = await gr.createInstance(mockInst);
    assert.equal(result, 'created');
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(spy.mock.calls[0][0], gr);
    assert.equal(spy.mock.calls[0][1], mockInst);
  });

  test('createInstance falls back to base when implementation is undefined', async () => {
    const gr = new GenericResolver('fb', makeMethods());
    const mockInst = { attributes: new Map() } as unknown as Instance;
    const result = await gr.createInstance(mockInst);
    assert.equal(result, undefined);
  });

  test('upsertInstance delegates to implementation when provided', async () => {
    const spy = vi.fn().mockResolvedValue('upserted');
    const gr = new GenericResolver('del', makeMethods({ upsert: spy }));
    const mockInst = {} as Instance;
    const result = await gr.upsertInstance(mockInst);
    assert.equal(result, 'upserted');
    assert.equal(spy.mock.calls[0][0], gr);
    assert.equal(spy.mock.calls[0][1], mockInst);
  });

  test('upsertInstance falls back to base when implementation is undefined', async () => {
    const gr = new GenericResolver('fb', makeMethods());
    const result = await gr.upsertInstance({} as Instance);
    assert.equal(result, undefined);
  });

  test('updateInstance passes newAttrs as third argument', async () => {
    const spy = vi.fn().mockResolvedValue('updated');
    const gr = new GenericResolver('del', makeMethods({ update: spy }));
    const mockInst = { queryAttributes: null, queryAttributeValues: null } as unknown as Instance;
    const newAttrs: InstanceAttributes = new Map([['name', 'new']]);
    const result = await gr.updateInstance(mockInst, newAttrs);
    assert.equal(result, 'updated');
    assert.equal(spy.mock.calls[0][0], gr);
    assert.equal(spy.mock.calls[0][1], mockInst);
    assert.equal(spy.mock.calls[0][2], newAttrs);
  });

  test('updateInstance falls back to base when implementation is undefined', async () => {
    const gr = new GenericResolver('fb', makeMethods());
    const mockInst = { queryAttributes: null, queryAttributeValues: null } as unknown as Instance;
    const result = await gr.updateInstance(mockInst, new Map());
    assert.equal(result, undefined);
  });

  test('queryInstances delegates to implementation when provided', async () => {
    const spy = vi.fn().mockResolvedValue(['result']);
    const gr = new GenericResolver('del', makeMethods({ query: spy }));
    const mockInst = { queryAttributes: null, queryAttributeValues: null } as unknown as Instance;
    const result = await gr.queryInstances(mockInst, true);
    assert.deepEqual(result, ['result']);
    assert.equal(spy.mock.calls[0][0], gr);
    assert.equal(spy.mock.calls[0][1], mockInst);
    assert.equal(spy.mock.calls[0][2], true);
  });

  test('queryInstances falls back to base when implementation is undefined', async () => {
    const gr = new GenericResolver('fb', makeMethods());
    const mockInst = { queryAttributes: null, queryAttributeValues: null } as unknown as Instance;
    const result = await gr.queryInstances(mockInst, false);
    assert.equal(result, undefined);
  });

  test('deleteInstance delegates to implementation when provided', async () => {
    const spy = vi.fn().mockResolvedValue('deleted');
    const gr = new GenericResolver('del', makeMethods({ delete: spy }));
    const mockInsts = [] as Instance[];
    const result = await gr.deleteInstance(mockInsts, false);
    assert.equal(result, 'deleted');
    assert.equal(spy.mock.calls[0][0], gr);
    assert.equal(spy.mock.calls[0][1], mockInsts);
  });

  test('deleteInstance falls back to base when implementation is undefined', async () => {
    const gr = new GenericResolver('fb', makeMethods());
    const result = await gr.deleteInstance([] as Instance[], false);
    assert.equal(result, undefined);
  });

  test('startTransaction delegates to implementation', async () => {
    const spy = vi.fn().mockResolvedValue('txn-42');
    const gr = new GenericResolver('txn', makeMethods({ startTransaction: spy }));
    const result = await gr.startTransaction();
    assert.equal(result, 'txn-42');
    assert.equal(spy.mock.calls[0][0], gr);
  });

  test('startTransaction falls back to base (returns 1)', async () => {
    const gr = new GenericResolver('fb', makeMethods());
    const result = await gr.startTransaction();
    assert.equal(result, 1);
  });

  test('commitTransaction delegates to implementation', async () => {
    const spy = vi.fn().mockResolvedValue('committed');
    const gr = new GenericResolver('txn', makeMethods({ commitTransaction: spy }));
    const result = await gr.commitTransaction('txn-42');
    assert.equal(result, 'committed');
    assert.equal(spy.mock.calls[0][0], gr);
    assert.equal(spy.mock.calls[0][1], 'txn-42');
  });

  test('rollbackTransaction delegates to implementation', async () => {
    const spy = vi.fn().mockResolvedValue('rolledback');
    const gr = new GenericResolver('txn', makeMethods({ rollbackTransaction: spy }));
    const result = await gr.rollbackTransaction('txn-42');
    assert.equal(result, 'rolledback');
    assert.equal(spy.mock.calls[0][0], gr);
    assert.equal(spy.mock.calls[0][1], 'txn-42');
  });
});

describe('GenericResolver subscription retry', () => {
  test('succeeds on first try with no error', async () => {
    const spy = vi.fn();
    const gr = new GenericResolver('sub-ok');
    gr.subs = { subscribe: spy };
    await gr.subscribe();
    assert.equal(spy.mock.calls.length, 1);
  });

  test('retries up to MaxErrors then stops', async () => {
    const spy = vi.fn().mockRejectedValue(new Error('fail'));
    const gr = new GenericResolver('sub-fail');
    gr.subs = { subscribe: spy };
    await gr.subscribe();
    // MaxErrors = 3: initial + 3 retries = 4 total calls before breaking
    assert.equal(spy.mock.calls.length, 4);
  });

  test('recovers after transient error', async () => {
    let callCount = 0;
    const spy = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('transient');
      // succeeds on second call
    });
    const gr = new GenericResolver('sub-recover');
    gr.subs = { subscribe: spy };
    await gr.subscribe();
    assert.equal(spy.mock.calls.length, 2);
  });

  test('no-op when subs is undefined', async () => {
    const gr = new GenericResolver('sub-none');
    // subs is undefined by default
    await gr.subscribe(); // should not throw
  });
});
