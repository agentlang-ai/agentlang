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
} from '../../../src/runtime/resolvers/interface.js';
import {
  registerResolver,
  setResolver,
  resetResolverRegistry,
} from '../../../src/runtime/resolvers/registry.js';

describe('Resolver Integration Tests', () => {
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

  describe('Custom resolver basic CRUD', () => {
    test('create: custom resolver receives instance and returns it', async () => {
      const received: Instance[] = [];
      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => {
          received.push(inst);
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
      registerResolver('create-test', () => new GenericResolver('create-test', methods));

      await doInternModule('CrMod', 'entity Item {id Int @id, name String}');
      setResolver('CrMod/Item', 'create-test');

      const result = await parseAndEvaluateStatement('{CrMod/Item {id 1, name "hello"}}');
      assert(result instanceof Instance);
      assert.equal(result.lookup('name'), 'hello');
      assert.equal(received.length, 1);
      assert.equal(received[0].lookup('id'), 1);
    });

    test('query: custom resolver returns instances from in-memory store', async () => {
      const store = new Map<string, Instance>();
      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => {
          store.set(String(inst.lookup('id')), inst);
          return inst;
        },
        upsert: undefined,
        update: undefined,
        query: async (_res: any, inst: Instance, queryAll: boolean) => {
          if (queryAll) return Array.from(store.values());
          const id = inst.queryAttributeValues?.get('id');
          if (id !== undefined) {
            const found = store.get(String(id));
            return found ? [found] : [];
          }
          return Array.from(store.values());
        },
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('query-test', () => new GenericResolver('query-test', methods));

      await doInternModule('QrMod', 'entity Widget {id Int @id, label String}');
      setResolver('QrMod/Widget', 'query-test');

      await parseAndEvaluateStatement('{QrMod/Widget {id 1, label "A"}}');
      await parseAndEvaluateStatement('{QrMod/Widget {id 2, label "B"}}');

      const all = (await parseAndEvaluateStatement('{QrMod/Widget? {}}')) as Instance[];
      assert.equal(all.length, 2);

      const one = (await parseAndEvaluateStatement('{QrMod/Widget {id? 1}}')) as Instance[];
      assert.equal(one.length, 1);
      assert.equal(one[0].lookup('label'), 'A');
    });

    test('upsert through custom resolver', async () => {
      const store = new Map<string, Instance>();
      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => {
          store.set(String(inst.lookup('id')), inst);
          return inst;
        },
        upsert: async (_res: any, inst: Instance) => {
          store.set(String(inst.lookup('id')), inst);
          return inst;
        },
        update: undefined,
        query: async (_res: any, inst: Instance, queryAll: boolean) => {
          if (queryAll) return Array.from(store.values());
          const id = inst.queryAttributeValues?.get('id');
          if (id !== undefined) {
            const found = store.get(String(id));
            return found ? [found] : [];
          }
          return Array.from(store.values());
        },
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('upsert-test', () => new GenericResolver('upsert-test', methods));

      await doInternModule('UpMod', 'entity Config {id Int @id, val String}');
      setResolver('UpMod/Config', 'upsert-test');

      await parseAndEvaluateStatement('{UpMod/Config {id 1, val "first"}, @upsert}');
      const first = (await parseAndEvaluateStatement('{UpMod/Config {id? 1}}')) as Instance[];
      assert.equal(first.length, 1);
      assert.equal(first[0].lookup('val'), 'first');

      await parseAndEvaluateStatement('{UpMod/Config {id 1, val "second"}, @upsert}');
      const second = (await parseAndEvaluateStatement('{UpMod/Config {id? 1}}')) as Instance[];
      assert.equal(second.length, 1);
      assert.equal(second[0].lookup('val'), 'second');
    });
  });

  describe('Data transformation', () => {
    test('resolver transforms data before returning on create', async () => {
      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => {
          const name = inst.lookup('name');
          if (typeof name === 'string') {
            inst.attributes.set('name', name.toUpperCase());
          }
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
      registerResolver('transform-test', () => new GenericResolver('transform-test', methods));

      await doInternModule('TrMod', 'entity Doc {id Int @id, name String}');
      setResolver('TrMod/Doc', 'transform-test');

      const result = (await parseAndEvaluateStatement(
        '{TrMod/Doc {id 1, name "hello"}}'
      )) as Instance;
      assert.equal(result.lookup('name'), 'HELLO');
    });

    test('resolver returns pre-seeded data from closure on query', async () => {
      const seededData: Instance[] = [];
      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => {
          seededData.push(inst);
          return inst;
        },
        upsert: undefined,
        update: undefined,
        query: async () => {
          return seededData;
        },
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('seed-test', () => new GenericResolver('seed-test', methods));

      await doInternModule('SdMod', 'entity Note {id Int @id, text String}');
      setResolver('SdMod/Note', 'seed-test');

      await parseAndEvaluateStatement('{SdMod/Note {id 1, text "first"}}');
      await parseAndEvaluateStatement('{SdMod/Note {id 2, text "second"}}');

      const results = (await parseAndEvaluateStatement('{SdMod/Note? {}}')) as Instance[];
      assert.equal(results.length, 2);
    });
  });

  describe('Multiple resolvers', () => {
    test('two entities use two different custom resolvers with isolated stores', async () => {
      const storeA = new Map<string, Instance>();
      const storeB = new Map<string, Instance>();

      function makeStoreMethods(store: Map<string, Instance>): GenericResolverMethods {
        return {
          create: async (_res: any, inst: Instance) => {
            store.set(String(inst.lookup('id')), inst);
            return inst;
          },
          upsert: undefined,
          update: undefined,
          query: async (_res: any, _inst: Instance, _queryAll: boolean) => {
            return Array.from(store.values());
          },
          delete: undefined,
          startTransaction: undefined,
          commitTransaction: undefined,
          rollbackTransaction: undefined,
        };
      }

      const methodsA = makeStoreMethods(storeA);
      const methodsB = makeStoreMethods(storeB);
      registerResolver('res-a', () => new GenericResolver('res-a', methodsA));
      registerResolver('res-b', () => new GenericResolver('res-b', methodsB));

      await doInternModule(
        'IsoMod',
        'entity Alpha {id Int @id, val String}\nentity Beta {id Int @id, val String}'
      );
      setResolver('IsoMod/Alpha', 'res-a');
      setResolver('IsoMod/Beta', 'res-b');

      await parseAndEvaluateStatement('{IsoMod/Alpha {id 1, val "a1"}}');
      await parseAndEvaluateStatement('{IsoMod/Beta {id 1, val "b1"}}');
      await parseAndEvaluateStatement('{IsoMod/Beta {id 2, val "b2"}}');

      const alphas = (await parseAndEvaluateStatement('{IsoMod/Alpha? {}}')) as Instance[];
      const betas = (await parseAndEvaluateStatement('{IsoMod/Beta? {}}')) as Instance[];

      assert.equal(alphas.length, 1);
      assert.equal(betas.length, 2);
      assert.equal(storeA.size, 1);
      assert.equal(storeB.size, 2);
    });

    test('one entity uses custom resolver, another uses default SQL resolver', async () => {
      const customStore = new Map<string, Instance>();
      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => {
          customStore.set(String(inst.lookup('id')), inst);
          return inst;
        },
        upsert: undefined,
        update: undefined,
        query: async () => {
          return Array.from(customStore.values());
        },
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('custom-only', () => new GenericResolver('custom-only', methods));

      await doInternModule(
        'MixMod',
        'entity Custom {id Int @id, val String}\nentity SqlBacked {id Int @id, val String}'
      );
      setResolver('MixMod/Custom', 'custom-only');
      // SqlBacked uses default SQL resolver (no setResolver call)

      await parseAndEvaluateStatement('{MixMod/Custom {id 1, val "custom"}}');
      await parseAndEvaluateStatement('{MixMod/SqlBacked {id 1, val "sql"}}');

      const customs = (await parseAndEvaluateStatement('{MixMod/Custom? {}}')) as Instance[];
      assert.equal(customs.length, 1);
      assert.equal(customs[0].lookup('val'), 'custom');

      const sqls = (await parseAndEvaluateStatement('{MixMod/SqlBacked? {}}')) as Instance[];
      assert.equal(sqls.length, 1);
      assert.equal(sqls[0].lookup('val'), 'sql');
    });

    test('same resolver mapped to two entities, receives correct entity names', async () => {
      const receivedEntities: string[] = [];
      const store = new Map<string, Instance>();

      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => {
          receivedEntities.push(`${inst.moduleName}/${inst.name}`);
          store.set(`${inst.moduleName}/${inst.name}:${inst.lookup('id')}`, inst);
          return inst;
        },
        upsert: undefined,
        update: undefined,
        query: async (_res: any, inst: Instance) => {
          return Array.from(store.values()).filter(
            i => i.moduleName === inst.moduleName && i.name === inst.name
          );
        },
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('shared-res', () => new GenericResolver('shared-res', methods));

      await doInternModule(
        'ShMod',
        'entity Foo {id Int @id, x String}\nentity Bar {id Int @id, y String}'
      );
      setResolver('ShMod/Foo', 'shared-res');
      setResolver('ShMod/Bar', 'shared-res');

      await parseAndEvaluateStatement('{ShMod/Foo {id 1, x "fx"}}');
      await parseAndEvaluateStatement('{ShMod/Bar {id 1, y "by"}}');

      assert(receivedEntities.includes('ShMod/Foo'));
      assert(receivedEntities.includes('ShMod/Bar'));

      const foos = (await parseAndEvaluateStatement('{ShMod/Foo? {}}')) as Instance[];
      const bars = (await parseAndEvaluateStatement('{ShMod/Bar? {}}')) as Instance[];
      assert.equal(foos.length, 1);
      assert.equal(bars.length, 1);
    });
  });

  describe('Partial methods', () => {
    test('resolver with only create and query defined', async () => {
      const store = new Map<string, Instance>();
      const methods: GenericResolverMethods = {
        create: async (_res: any, inst: Instance) => {
          store.set(String(inst.lookup('id')), inst);
          return inst;
        },
        upsert: undefined,
        update: undefined,
        query: async () => Array.from(store.values()),
        delete: undefined,
        startTransaction: undefined,
        commitTransaction: undefined,
        rollbackTransaction: undefined,
      };
      registerResolver('partial-cq', () => new GenericResolver('partial-cq', methods));

      await doInternModule('PtMod', 'entity Thing {id Int @id, info String}');
      setResolver('PtMod/Thing', 'partial-cq');

      const created = (await parseAndEvaluateStatement(
        '{PtMod/Thing {id 1, info "test"}}'
      )) as Instance;
      assert.equal(created.lookup('info'), 'test');

      const queried = (await parseAndEvaluateStatement('{PtMod/Thing? {}}')) as Instance[];
      assert.equal(queried.length, 1);
    });

    test('resolver with only query defined (read-only pattern)', async () => {
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
      registerResolver('read-only', () => new GenericResolver('read-only', methods));

      await doInternModule('RoMod', 'entity ReadOnly {id Int @id, data String}');
      setResolver('RoMod/ReadOnly', 'read-only');

      const results = (await parseAndEvaluateStatement('{RoMod/ReadOnly? {}}')) as Instance[];
      assert.equal(results.length, 0);
    });
  });
});
