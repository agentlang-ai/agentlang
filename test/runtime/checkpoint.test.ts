import { assert, describe, test } from 'vitest';
import { Environment, parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import {
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  invalidateCheckpoints,
  deleteCheckpoints,
} from '../../src/runtime/modules/core.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { doInternModule, doInitRuntime } from '../util.js';
import { testLogger } from '../test-logger.js';
import { findAgentByName } from '../../src/runtime/modules/ai.js';

// ────────────────────────────────────────────────────
// 1. Environment Checkpoint State (no DB/LLM needed)
// ────────────────────────────────────────────────────
describe('Environment checkpoint state', () => {
  test('default state: checkpoint disabled, no executionId', () => {
    const env = new Environment();
    assert(env.isCheckpointEnabled() === false, 'checkpoint should be disabled by default');
    assert(
      env.getCheckpointExecutionId() === undefined,
      'executionId should be undefined by default'
    );
  });

  test('enableCheckpoint sets enabled, generates executionId, index starts at 0', () => {
    const env = new Environment();
    env.enableCheckpoint();
    assert(env.isCheckpointEnabled() === true, 'checkpoint should be enabled');
    const id = env.getCheckpointExecutionId();
    assert(id !== undefined && id.length > 0, 'executionId should be a non-empty string');
    assert(env.incrementCheckpointIndex() === 0, 'first index should be 0');
  });

  test('incrementCheckpointIndex has post-increment semantics', () => {
    const env = new Environment();
    env.enableCheckpoint();
    assert(env.incrementCheckpointIndex() === 0, 'first call returns 0');
    assert(env.incrementCheckpointIndex() === 1, 'second call returns 1');
    assert(env.incrementCheckpointIndex() === 2, 'third call returns 2');
  });

  test('setCheckpointExecutionId sets the id AND enables checkpoint', () => {
    const env = new Environment();
    env.setCheckpointExecutionId('custom-exec-id');
    assert(env.isCheckpointEnabled() === true, 'checkpoint should be enabled');
    assert(
      env.getCheckpointExecutionId() === 'custom-exec-id',
      'executionId should match the provided value'
    );
  });

  test('re-enable resets executionId and stepIndex', () => {
    const env = new Environment();
    env.enableCheckpoint();
    const firstId = env.getCheckpointExecutionId();
    env.incrementCheckpointIndex(); // 0
    env.incrementCheckpointIndex(); // 1

    env.enableCheckpoint(); // re-enable
    const secondId = env.getCheckpointExecutionId();
    assert(secondId !== firstId, 'second enableCheckpoint should generate a new UUID');
    assert(env.incrementCheckpointIndex() === 0, 'stepIndex should reset to 0');
  });

  test('parent-child propagation: enabled and executionId propagate, stepIndex does not', () => {
    const parent = new Environment();
    parent.enableCheckpoint();
    parent.incrementCheckpointIndex(); // 0
    parent.incrementCheckpointIndex(); // 1

    const child = new Environment('child', parent);
    assert(child.isCheckpointEnabled() === true, 'child should inherit checkpointEnabled');
    assert(
      child.getCheckpointExecutionId() === parent.getCheckpointExecutionId(),
      'child should inherit executionId'
    );
    assert(
      child.incrementCheckpointIndex() === 0,
      'child stepIndex should start at 0, not inherit parent'
    );
  });
});

// ────────────────────────────────────────────────────
// 2. Checkpoint CRUD (DB required, no LLM)
// ────────────────────────────────────────────────────
describe('Checkpoint CRUD', () => {
  test('createCheckpoint returns a UUID', async () => {
    await doInitRuntime();
    const env = new Environment();
    env.setActiveUser('test-user');
    env.enableCheckpoint();

    const id = await createCheckpoint(
      env.getCheckpointExecutionId()!,
      'step-1',
      0,
      ['{Mod/E {id 1}}'],
      env
    );
    testLogger.verbose('createCheckpoint returned id:', id);
    assert(id !== undefined, 'createCheckpoint should return a non-undefined id');
    assert(typeof id === 'string' && id.length > 0, 'id should be a non-empty string');
  });

  test('created checkpoint persists correct fields', async () => {
    await doInitRuntime();
    const env = new Environment();
    env.setActiveUser('test-user');
    env.enableCheckpoint();
    const execId = env.getCheckpointExecutionId()!;

    await createCheckpoint(execId, 'my-step', 0, ['{Mod/E {id 1}}'], env);

    const ckpts = await listCheckpoints(execId, env);
    assert(ckpts.length === 1, `expected 1 checkpoint, got ${ckpts.length}`);
    const ckpt: Instance = ckpts[0];
    assert(ckpt.lookup('executionId') === execId, 'executionId mismatch');
    assert(ckpt.lookup('stepLabel') === 'my-step', 'stepLabel mismatch');
    assert(ckpt.lookup('stepIndex') === 0, 'stepIndex mismatch');
    assert(ckpt.lookup('status') === 'active', 'status should be active');
    assert(ckpt.lookup('createdBy') === 'test-user', 'createdBy mismatch');
  });

  test('listCheckpoints filters by executionId', async () => {
    await doInitRuntime();
    const env = new Environment();
    env.setActiveUser('test-user');

    // Create checkpoint for exec-A
    env.setCheckpointExecutionId('exec-A');
    await createCheckpoint('exec-A', 'step-A', 0, ['{Mod/E {id 1}}'], env);

    // Create checkpoint for exec-B
    env.setCheckpointExecutionId('exec-B');
    await createCheckpoint('exec-B', 'step-B', 0, ['{Mod/E {id 2}}'], env);

    const listA = await listCheckpoints('exec-A', env);
    assert(listA.length === 1, `exec-A: expected 1, got ${listA.length}`);
    assert(listA[0].lookup('executionId') === 'exec-A');

    const listB = await listCheckpoints('exec-B', env);
    assert(listB.length === 1, `exec-B: expected 1, got ${listB.length}`);
    assert(listB[0].lookup('executionId') === 'exec-B');
  });

  test('listCheckpoints returns empty for unknown executionId', async () => {
    await doInitRuntime();
    const env = new Environment();
    const list = await listCheckpoints('nonexistent', env);
    assert(list.length === 0, 'should return empty array for unknown executionId');
  });

  test('invalidateCheckpoints marks as invalidated', async () => {
    await doInitRuntime();
    const env = new Environment();
    env.setActiveUser('test-user');
    env.enableCheckpoint();
    const execId = env.getCheckpointExecutionId()!;

    await createCheckpoint(execId, 'step-1', 0, ['{Mod/E {id 1}}'], env);
    await createCheckpoint(execId, 'step-2', 1, ['{Mod/E {id 2}}'], env);

    await invalidateCheckpoints(execId, env);

    // listCheckpoints filters by status="active", so should return 0
    const active = await listCheckpoints(execId, env);
    assert(active.length === 0, `expected 0 active checkpoints, got ${active.length}`);

    // But the records still exist with status "invalidated"
    const all: any = await parseAndEvaluateStatement(
      `{agentlang/checkpoint {executionId? "${execId}"}}`,
      undefined,
      new Environment('ckpt-verify', env).setInKernelMode(true)
    );
    assert(all instanceof Array && all.length === 2, 'invalidated records should still exist');
    for (const inst of all) {
      assert(inst.lookup('status') === 'invalidated', 'status should be invalidated');
    }
  });

  test('deleteCheckpoints purges records', async () => {
    await doInitRuntime();
    const env = new Environment();
    env.setActiveUser('test-user');
    env.enableCheckpoint();
    const execId = env.getCheckpointExecutionId()!;

    await createCheckpoint(execId, 'step-1', 0, ['{Mod/E {id 1}}'], env);

    await deleteCheckpoints(execId, env);

    // After delete, records are fully gone
    const all: any = await parseAndEvaluateStatement(
      `{agentlang/checkpoint {executionId? "${execId}"}}`,
      undefined,
      new Environment('ckpt-verify', env).setInKernelMode(true)
    );
    const count = all instanceof Array ? all.length : 0;
    assert(count === 0, `expected 0 records after delete, got ${count}`);
  });

  test('multiple checkpoints with incrementing stepIndex', async () => {
    await doInitRuntime();
    const env = new Environment();
    env.setActiveUser('test-user');
    env.enableCheckpoint();
    const execId = env.getCheckpointExecutionId()!;

    await createCheckpoint(execId, 'step-A', 0, ['{Mod/E {id 1}}'], env);
    await createCheckpoint(execId, 'step-B', 1, ['{Mod/E {id 2}}'], env);

    const ckpts = await listCheckpoints(execId, env);
    assert(ckpts.length === 2, `expected 2 checkpoints, got ${ckpts.length}`);

    const indices = ckpts.map((c: Instance) => c.lookup('stepIndex')).sort();
    assert(indices[0] === 0 && indices[1] === 1, `expected stepIndices [0,1], got [${indices}]`);
  });
});

// ────────────────────────────────────────────────────
// 3. Checkpoint Restore (DB + module required, no LLM)
// ────────────────────────────────────────────────────
describe('Checkpoint restore', () => {
  test('restore evaluates continuation and creates entity', async () => {
    await doInternModule('Mod', 'entity E {id Int @id, x Int}');
    const env = new Environment();
    env.setActiveUser('test-user');
    env.enableCheckpoint();
    const execId = env.getCheckpointExecutionId()!;

    const ckptId = await createCheckpoint(
      execId,
      'create-entity',
      0,
      ['{Mod/E {id 1, x 100}}'],
      env
    );
    assert(ckptId !== undefined, 'checkpoint should be created');

    await restoreCheckpoint(ckptId!, env);

    // Verify the entity was created by querying it
    const results: any = await parseAndEvaluateStatement('{Mod/E {id? 1}}');
    assert(results instanceof Array && results.length > 0, 'entity should exist after restore');
    const entity: Instance = results[0];
    assert(entity.lookup('x') === 100, `expected x=100, got ${entity.lookup('x')}`);
  });

  test('restore returns undefined for missing checkpoint', async () => {
    await doInitRuntime();
    const env = new Environment();

    const result = await restoreCheckpoint('nonexistent-uuid', env);
    assert(result === undefined, 'should return undefined for missing checkpoint');
  });

  test('restore does NOT delete checkpoint', async () => {
    await doInternModule('Mod2', 'entity F {id Int @id, y Int}');
    const env = new Environment();
    env.setActiveUser('test-user');
    env.enableCheckpoint();
    const execId = env.getCheckpointExecutionId()!;

    const ckptId = await createCheckpoint(
      execId,
      'persist-check',
      0,
      ['{Mod2/F {id 1, y 42}}'],
      env
    );
    assert(ckptId !== undefined);

    await restoreCheckpoint(ckptId!, env);

    // Checkpoint should still exist after restore
    const ckpts = await listCheckpoints(execId, env);
    assert(ckpts.length === 1, 'checkpoint should still exist after restore');
  });
});

// ────────────────────────────────────────────────────
// 4. Agent Checkpoint Flag (DB + module required, no LLM)
// ────────────────────────────────────────────────────
describe('Agent checkpoint flag', () => {
  test('agent with checkpoint true', async () => {
    await doInternModule(
      'CkptAgent',
      `
      agent ckptBot {
        instruction "Test agent with checkpoint",
        checkpoint true,
        llm "test-llm"
      }
      `
    );
    const env = new Environment();
    const agent = await findAgentByName('ckptBot', env);
    assert(agent.checkpoint === true, 'agent.checkpoint should be true');
  });

  test('agent without checkpoint defaults to false', async () => {
    await doInternModule(
      'NoCkptAgent',
      `
      agent noBot {
        instruction "Test agent without checkpoint",
        llm "test-llm"
      }
      `
    );
    const env = new Environment();
    const agent = await findAgentByName('noBot', env);
    assert(agent.checkpoint === false, 'agent.checkpoint should default to false');
  });
});
