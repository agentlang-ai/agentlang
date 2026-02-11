import { beforeAll, describe, expect, test } from 'vitest';
import { doPreInit } from '../util.js';
import { fetchModule } from '../../src/runtime/module.js';
import { CoreMemoryModuleName } from '../../src/runtime/modules/memory.js';
import { CoreModules } from '../../src/runtime/modules/core.js';

describe('Memory Module test', () => {
  beforeAll(async () => {
    await doPreInit();
    // Debug: Print loaded modules
    console.log('Loaded core modules:', CoreModules.length);
    console.log('Expected memory module name:', CoreMemoryModuleName);
  });

  test('Memory module should be registered and loaded', async () => {
    // First, let's verify CoreModules has content
    expect(CoreModules.length).toBeGreaterThan(0);

    // Check if any module contains "memory"
    const hasMemoryModule = CoreModules.some(m => m.includes('agentlang.memory'));

    if (!hasMemoryModule) {
      // List all module names for debugging
      const moduleNames = CoreModules.map(m => {
        const match = m.match(/module\s+(\S+)/);
        return match ? match[1] : 'unknown';
      });
      throw new Error(
        `Memory module not found in CoreModules. ` + `Available modules: ${moduleNames.join(', ')}`
      );
    }

    // Try to fetch the memory module directly
    try {
      const module = fetchModule(CoreMemoryModuleName);
      expect(module).toBeDefined();
      expect(module.name).toBe(CoreMemoryModuleName);
    } catch {
      // If module not found, the test should fail with a clear message
      throw new Error(
        `Memory module ${CoreMemoryModuleName} not found. ` +
          `Make sure registerCoreModules() includes the memory module.`
      );
    }
  });

  test('Memory entity should exist in a module', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const memoryEntity = module.getRecord('Memory');
    expect(memoryEntity).toBeDefined();
  });

  test('AgentSession entity should exist in the module', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const sessionEntity = module.getRecord('AgentSession');
    expect(sessionEntity).toBeDefined();
  });

  test('SessionMessage entity should exist in the module', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const messageEntity = module.getRecord('SessionMessage');
    expect(messageEntity).toBeDefined();
  });

  test('ActiveInstance entity should exist in the module', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const instanceEntity = module.getRecord('ActiveInstance');
    expect(instanceEntity).toBeDefined();
  });

  test('Memory entity should support embedding configuration', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const memoryEntity = module.getRecord('Memory');
    expect(memoryEntity).toBeDefined();

    // Check that embeddingConfig attribute exists
    const userAttrs = memoryEntity.getUserAttributes();
    const hasEmbeddingConfig = userAttrs.has('embeddingConfig');
    expect(hasEmbeddingConfig).toBe(true);
  });
});
