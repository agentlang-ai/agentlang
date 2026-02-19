import { assert, describe, test, beforeAll, afterAll, beforeEach } from 'vitest';
import { doInternModule, doPreInit } from '../../util.js';
import {
  initDatabase,
  resetDefaultDatabase,
} from '../../../src/runtime/resolvers/sqldb/database.js';
import { parseAndEvaluateStatement } from '../../../src/runtime/interpreter.js';
import { Instance } from '../../../src/runtime/module.js';
import {
  GenericResolver,
  GenericResolverMethods,
  setSubscriptionEvent,
  getSubscriptionEvent,
} from '../../../src/runtime/resolvers/interface.js';
import {
  registerResolver,
  setResolver,
  resetResolverRegistry,
} from '../../../src/runtime/resolvers/registry.js';

describe('Resolver Edge Cases', () => {
  let originalDbType: string | undefined;

  beforeAll(async () => {
    originalDbType = process.env.AL_DB_TYPE;
    process.env.AL_DB_TYPE = 'sqljs';
    await doPreInit();
  });

  afterAll(async () => {
    if (originalDbType !== undefined) {
      process.env.AL_DB_TYPE = originalDbType;
    } else {
      delete process.env.AL_DB_TYPE;
    }
    await resetDefaultDatabase();
  });

  beforeEach(async () => {
    resetResolverRegistry();
    await resetDefaultDatabase();
    await initDatabase({ type: 'sqljs' });
  });

  describe('Error handling', () => {
    test('create method throwing error propagates to caller', async () => {
      const methods: GenericResolverMethods = {
        create: async () => {
          throw new Error('create failed');
        },
        upsert: undefined,
        update: undefined,
        query: undefined,
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('err-create', () => new GenericResolver('err-create', methods));

      await doInternModule('ErrMod1', 'entity ErrEnt {id Int @id, name String}');
      setResolver('ErrMod1/ErrEnt', 'err-create');

      try {
        await parseAndEvaluateStatement('{ErrMod1/ErrEnt {id 1, name "fail"}}');
        assert.fail('Should have thrown');
      } catch (err: any) {
        assert(err.message.includes('create failed'));
      }
    });

    test('query method throwing error propagates to caller', async () => {
      const methods: GenericResolverMethods = {
        create: undefined,
        upsert: undefined,
        update: undefined,
        query: async () => {
          throw new Error('query failed');
        },
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('err-query', () => new GenericResolver('err-query', methods));

      await doInternModule('ErrMod2', 'entity ErrQEnt {id Int @id, name String}');
      setResolver('ErrMod2/ErrQEnt', 'err-query');

      try {
        await parseAndEvaluateStatement('{ErrMod2/ErrQEnt? {}}');
        assert.fail('Should have thrown');
      } catch (err: any) {
        assert(err.message.includes('query failed'));
      }
    });

    test('resolver returning null from create', async () => {
      const methods: GenericResolverMethods = {
        create: async () => null,
        upsert: undefined,
        update: undefined,
        query: undefined,
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('null-create', () => new GenericResolver('null-create', methods));

      await doInternModule('NullMod', 'entity NullEnt {id Int @id, name String}');
      setResolver('NullMod/NullEnt', 'null-create');

      const result = await parseAndEvaluateStatement('{NullMod/NullEnt {id 1, name "test"}}');
      assert.equal(result, null);
    });

    test('resolver returning empty array from query', async () => {
      const methods: GenericResolverMethods = {
        create: undefined,
        upsert: undefined,
        update: undefined,
        query: async () => [],
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('empty-query', () => new GenericResolver('empty-query', methods));

      await doInternModule('EmMod', 'entity EmEnt {id Int @id, name String}');
      setResolver('EmMod/EmEnt', 'empty-query');

      const results = (await parseAndEvaluateStatement('{EmMod/EmEnt? {}}')) as Instance[];
      assert.equal(results.length, 0);
    });
  });

  describe('Transaction methods', () => {
    test('custom startTransaction returns custom transaction id', async () => {
      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => inst,
        upsert: undefined,
        update: undefined,
        query: undefined,
        delete: undefined,
        startTransaction: async () => 'custom-txn-99',
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      const resolver = new GenericResolver('txn-test', methods);
      const txnId = await resolver.startTransaction();
      assert.equal(txnId, 'custom-txn-99');
    });

    test('custom commitTransaction receives correct txnId', async () => {
      const receivedTxnId: string[] = [];
      const methods: GenericResolverMethods = {
        create: undefined,
        upsert: undefined,
        update: undefined,
        query: undefined,
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: async (_res: any, txnId: string) => {
          receivedTxnId.push(txnId);
        },
        rollbackTransaction: undefined,
      };
      const resolver = new GenericResolver('commit-test', methods);
      await resolver.commitTransaction('txn-42');
      assert.equal(receivedTxnId.length, 1);
      assert.equal(receivedTxnId[0], 'txn-42');
    });

    test('custom rollbackTransaction receives correct txnId', async () => {
      const receivedTxnId: string[] = [];
      const methods: GenericResolverMethods = {
        create: undefined,
        upsert: undefined,
        update: undefined,
        query: undefined,
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: async (_res: any, txnId: string) => {
          receivedTxnId.push(txnId);
        },
      };
      const resolver = new GenericResolver('rollback-test', methods);
      await resolver.rollbackTransaction('txn-99');
      assert.equal(receivedTxnId.length, 1);
      assert.equal(receivedTxnId[0], 'txn-99');
    });
  });

  describe('Auth info propagation', () => {
    test('authInfo.userId is set on resolver during CRUD operations', async () => {
      let capturedUserId: string | undefined;
      const methods: GenericResolverMethods = {
        create: async (resolver: any, inst: Instance) => {
          capturedUserId = resolver.authInfo?.userId;
          return inst;
        },
        upsert: undefined,
        update: undefined,
        query: undefined,
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('auth-test', () => new GenericResolver('auth-test', methods));

      await doInternModule('AuthMod', 'entity AuthEnt {id Int @id, name String}');
      setResolver('AuthMod/AuthEnt', 'auth-test');

      await parseAndEvaluateStatement('{AuthMod/AuthEnt {id 1, name "test"}}');
      assert(capturedUserId !== undefined, 'userId should be set');
      assert(typeof capturedUserId === 'string');
      assert(capturedUserId.length > 0);
    });
  });

  describe('Subscription events', () => {
    test('setSubscriptionEvent/getSubscriptionEvent store and retrieve correctly', () => {
      setSubscriptionEvent('MyModule/MyEvent', 'my-resolver');
      assert.equal(getSubscriptionEvent('my-resolver'), 'MyModule/MyEvent');
    });

    test('getSubscriptionEvent returns undefined for unknown resolver', () => {
      assert.equal(getSubscriptionEvent('nonexistent-resolver'), undefined);
    });
  });
});
