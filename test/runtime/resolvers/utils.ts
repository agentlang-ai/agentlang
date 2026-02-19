import {
  GenericResolver,
  GenericResolverMethods,
} from '../../../src/runtime/resolvers/interface.js';
import { registerResolver, setResolver } from '../../../src/runtime/resolvers/registry.js';
import { Instance, InstanceAttributes } from '../../../src/runtime/module.js';
import {
  SubscriptionEnvelope,
  createSubscriptionEnvelope,
} from '../../../src/runtime/resolvers/envelope.js';

/**
 * Creates a GenericResolver backed by an in-memory Map with full CRUD support.
 */
export function createInMemoryResolver(name: string): {
  resolver: GenericResolver;
  store: Map<string, Instance>;
} {
  const store = new Map<string, Instance>();

  const methods: GenericResolverMethods = {
    create: async (_resolver: any, inst: Instance) => {
      const id = String(inst.lookup('id'));
      store.set(id, inst);
      return inst;
    },
    upsert: async (_resolver: any, inst: Instance) => {
      const id = String(inst.lookup('id'));
      store.set(id, inst);
      return inst;
    },
    update: async (_resolver: any, inst: Instance, _newAttrs: InstanceAttributes) => {
      const id = String(inst.lookup('id'));
      store.set(id, inst);
      return inst;
    },
    query: async (_resolver: any, inst: Instance, queryAll: boolean) => {
      if (queryAll) {
        return Array.from(store.values());
      }
      const id = inst.queryAttributeValues?.get('id');
      if (id !== undefined) {
        const found = store.get(String(id));
        return found ? [found] : [];
      }
      return Array.from(store.values());
    },
    delete: async (_resolver: any, inst: Instance) => {
      if (inst instanceof Instance) {
        const id = String(inst.lookup('id'));
        store.delete(id);
      }
      return inst;
    },
    startTransaction: undefined,
    commitTransaction: undefined,
    rollbackTransaction: undefined,
  };

  const resolver = new GenericResolver(name, methods);
  return { resolver, store };
}

const defaultTestUserId = '11111111-1111-1111-1111-111111111111';
const defaultTestTenantId = '22222222-2222-2222-2222-222222222222';

/**
 * Creates a SubscriptionEnvelope for testing.
 */
export function createTestEnvelope(
  userId: string = defaultTestUserId,
  tenantId: string = defaultTestTenantId,
  data: any = { foo: 'bar' }
): SubscriptionEnvelope {
  return createSubscriptionEnvelope(tenantId, userId, data);
}

/**
 * Registers a resolver factory and maps an entity path to it in one call.
 */
export function registerTestResolver(
  resolverName: string,
  entityPath: string,
  methods: GenericResolverMethods
): GenericResolver {
  const resolver = new GenericResolver(resolverName, methods);
  registerResolver(resolverName, () => new GenericResolver(resolverName, methods));
  setResolver(entityPath, resolverName);
  return resolver;
}
