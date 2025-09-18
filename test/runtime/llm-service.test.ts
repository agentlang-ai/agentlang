import { describe, test, expect, beforeAll } from 'vitest';
import { doInternModule } from '../util.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { GlobalEnvironment } from '../../src/runtime/interpreter.js';
import { setLocalEnv } from '../../src/runtime/auth/defs.js';

describe('LLM Service Selection', () => {
  beforeAll(() => {
    // Set both API keys to ensure both providers are available
    setLocalEnv('OPENAI_API_KEY', 'test-openai-key');
    setLocalEnv('ANTHROPIC_API_KEY', 'test-anthropic-key');
  });

  test('LLM should use specified service, not default to OpenAI', async () => {
    await doInternModule(
      'TestLLMService',
      `
      delete {agentlang.ai/LLM {name? "test_llm"}}
      
      {agentlang.ai/LLM {
        name "test_llm",
        service "anthropic",
        config {
          "model": "claude-3-sonnet-20241022",
          "maxTokens": 4096
        }
      }, @upsert}
    `
    );

    // Query the LLM to check its service
    const result = await parseAndEvaluateStatement(
      `{agentlang.ai/LLM {name? "test_llm"}}`,
      undefined,
      GlobalEnvironment
    );

    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);

    const llm = result[0];
    const service = llm.lookup('service');

    // This should be 'anthropic' but it's likely 'openai' due to the bug
    expect(service).toBe('anthropic');
  });

  test('LLM service should persist across queries', async () => {
    // Create an LLM with explicit anthropic service
    await doInternModule(
      'TestLLMPersistence',
      `
      {agentlang.ai/LLM {
        name "persist_test_llm",
        service "anthropic",
        config {
          "model": "claude-3-sonnet-20241022"
        }
      }, @upsert}
    `
    );

    // First query
    const result1 = await parseAndEvaluateStatement(
      `{agentlang.ai/LLM {name? "persist_test_llm"}}`,
      undefined,
      GlobalEnvironment
    );

    const llm1 = result1[0];
    expect(llm1.lookup('service')).toBe('anthropic');

    // Second query - service should still be anthropic
    const result2 = await parseAndEvaluateStatement(
      `{agentlang.ai/LLM {name? "persist_test_llm"}}`,
      undefined,
      GlobalEnvironment
    );

    const llm2 = result2[0];
    expect(llm2.lookup('service')).toBe('anthropic');
  });

  test('Agent should use LLM with correct service provider', async () => {
    // Create both LLM and agent in the same module to avoid database reset
    await doInternModule(
      'TestAgentLLM',
      `
      {agentlang.ai/LLM {
        name "agent_llm",
        service "anthropic",
        config {
          "model": "claude-3-sonnet-20241022",
          "maxTokens": 2048
        }
      }, @upsert}
      
      agent testAgent {
        instruction "You are a test agent",
        llm "agent_llm"
      }
    `
    );

    // Query the agent's LLM
    const agentResult = await parseAndEvaluateStatement(
      `{agentlang.ai/Agent {name? "testAgent"}}`,
      undefined,
      GlobalEnvironment
    );

    expect(agentResult.length).toBeGreaterThan(0);
    const agent = agentResult[0];
    const llmName = agent.lookup('llm');
    expect(llmName).toBe('agent_llm');

    // Now query the LLM used by the agent after agent creation
    const llmResult = await parseAndEvaluateStatement(
      `{agentlang.ai/LLM {name? "${llmName}"}}`,
      undefined,
      GlobalEnvironment
    );

    expect(llmResult.length).toBeGreaterThan(0);
    const llm = llmResult[0];
    const service = llm.lookup('service');

    // The LLM should have anthropic service
    expect(service).toBe('anthropic');
  });

  test('Upsert should update service correctly', async () => {
    // First create with openai
    await doInternModule(
      'TestUpsert1',
      `
      {agentlang.ai/LLM {
        name "upsert_test",
        service "openai",
        config {
          "model": "gpt-4"
        }
      }, @upsert}
    `
    );

    let result = await parseAndEvaluateStatement(
      `{agentlang.ai/LLM {name? "upsert_test"}}`,
      undefined,
      GlobalEnvironment
    );

    expect(result[0].lookup('service')).toBe('openai');

    // Now upsert with anthropic
    await doInternModule(
      'TestUpsert2',
      `
      {agentlang.ai/LLM {
        name "upsert_test",
        service "anthropic",
        config {
          "model": "claude-3-sonnet-20241022"
        }
      }, @upsert}
    `
    );

    result = await parseAndEvaluateStatement(
      `{agentlang.ai/LLM {name? "upsert_test"}}`,
      undefined,
      GlobalEnvironment
    );

    // Service should now be anthropic
    expect(result[0].lookup('service')).toBe('anthropic');
  });

  test('Query should return all attributes including service', async () => {
    await doInternModule(
      'TestQueryAttrs',
      `
      {agentlang.ai/LLM {
        name "full_attrs_test",
        service "anthropic",
        config {
          "model": "claude-3-sonnet-20241022",
          "temperature": 0.7
        }
      }, @upsert}
    `
    );

    const result = await parseAndEvaluateStatement(
      `{agentlang.ai/LLM {name? "full_attrs_test"}}`,
      undefined,
      GlobalEnvironment
    );

    const llm = result[0];

    // Check all attributes are present
    expect(llm.lookup('name')).toBe('full_attrs_test');
    expect(llm.lookup('service')).toBe('anthropic');
    expect(llm.lookup('config')).toBeDefined();

    const config = llm.lookup('config');
    expect(config.get ? config.get('model') : config['model']).toBe('claude-3-sonnet-20241022');
  });
});
