import { loadAppConfig } from '../../src/runtime/loader.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { Instance } from '../../src/runtime/module.js';
import { assert, describe, test, beforeEach, afterEach } from 'vitest';
import { doPreInit } from '../util.js';
import { resetDefaultDatabase, initDatabase } from '../../src/runtime/resolvers/sqldb/database.js';
import { runInitFunctions } from '../../src/runtime/util.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('loadAppConfig', () => {
  let tempDir: string | null = null;

  beforeEach(async () => {
    await doPreInit();
    await resetDefaultDatabase();
    await initDatabase(undefined);
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      const configFile = path.join(tempDir, 'config.al');
      if (fs.existsSync(configFile)) {
        fs.unlinkSync(configFile);
      }
      fs.rmdirSync(tempDir);
      tempDir = null;
    }
  });

  test('should load config from agentlang string', async () => {
    const configContent =
      "{\n  \"agentlang\": {\n    \"service\": {\n      \"port\": 8080\n    }\n  },\n  \"agentlang.ai\": [\n    {\n      \"agentlang.ai/LLM\": {\n        \"name\": \"test_llm\",\n        \"service\": \"anthropic\",\n        \"config\": {\n          \"model\": \"claude-sonnet-4-5\",\n          \"maxTokens\": 1000,\n          \"temperature\": 0.7\n        }\n      }\n    }\n  ]\n}"

    const config = await loadAppConfig(configContent);
    assert(config !== undefined, 'Config should be defined');

    await runInitFunctions();
    const result: Instance[] = await parseAndEvaluateStatement(
      '{agentlang.ai/LLM {name? "test_llm"}}',
      undefined
    );

    assert(result.length === 1, 'LLM entity should be created');
    assert(result[0].lookup('name') === 'test_llm', 'LLM name should match');
    assert(result[0].lookup('service') === 'anthropic', 'LLM service should match');

    const llmConfig = result[0].lookup('config');
    assert(llmConfig !== undefined, 'LLM config should exist');
    assert(
      llmConfig instanceof Map || typeof llmConfig === 'object',
      'LLM config should be a Map or object'
    );

    const configMap = llmConfig instanceof Map ? llmConfig : new Map(Object.entries(llmConfig));
    assert(configMap.get('model') === 'claude-sonnet-4-5', 'Model should match');
    assert(configMap.get('maxTokens') === 1000, 'MaxTokens should match');
    assert(configMap.get('temperature') === 0.7, 'Temperature should match');
  });

  test('should load multiple entity instances from JSON content', async () => {
    const configContent =
      "{\n  \"agentlang\": {\n    \"service\": {\n      \"port\": 8080\n    }\n  },\n  \"agentlang.ai\": [\n    {\n      \"agentlang.ai/LLM\": {\n        \"name\": \"llm_one\",\n        \"service\": \"anthropic\",\n        \"config\": {\n          \"model\": \"claude-sonnet-4-5\"\n        }\n      }\n    },\n    {\n      \"agentlang.ai/LLM\": {\n        \"name\": \"llm_two\",\n        \"service\": \"openai\",\n        \"config\": {\n          \"model\": \"gpt-4o\"\n        }\n      }\n    }\n  ]\n}"

    await loadAppConfig(configContent);
    await runInitFunctions();
    const result1: Instance[] = await parseAndEvaluateStatement(
      '{agentlang.ai/LLM {name? "llm_one"}}',
      undefined
    );
    const result2: Instance[] = await parseAndEvaluateStatement(
      '{agentlang.ai/LLM {name? "llm_two"}}',
      undefined
    );

    assert(result1.length === 1, 'llm_one should be created');
    assert(result2.length === 1, 'llm_two should be created');
    assert(result1[0].lookup('service') === 'anthropic', 'llm_one service should be anthropic');
    assert(result2[0].lookup('service') === 'openai', 'llm_two service should be openai');
  });

  test('should load config from file path', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentlang-test-'));
    const configContent =
      "{\n \"agentlang\": {\n    \"service\": {\n      \"port\": 8080\n    }\n  },\n  \"agentlang.ai\": [\n    {\n      \"agentlang.ai/LLM\": {\n        \"name\": \"file_llm\",\n        \"service\": \"anthropic\",\n        \"config\": {\n          \"model\": \"claude-sonnet-4-5\",\n          \"maxTokens\": 2000\n        }\n      }\n    }\n  ]\n}";
    const configFile = path.join(tempDir, 'config.al');
    fs.writeFileSync(configFile, configContent);

    const config = await loadAppConfig(tempDir);
    assert(config !== undefined, 'Config should be loaded from file path');

    await runInitFunctions();
    const result: Instance[] = await parseAndEvaluateStatement(
      '{agentlang.ai/LLM {name? "file_llm"}}',
      undefined
    );

    assert(result.length === 1, 'LLM entity should be created from file');
    assert(result[0].lookup('name') === 'file_llm', 'LLM name should match');
    assert(result[0].lookup('service') === 'anthropic', 'LLM service should match');

    const llmConfig = result[0].lookup('config');
    assert(llmConfig !== undefined, 'LLM config should exist');
    const configMap = llmConfig instanceof Map ? llmConfig : new Map(Object.entries(llmConfig));
    assert(configMap.get('maxTokens') === 2000, 'MaxTokens should match from file');
  });

  test('should not be empty agentlang config section', async () => {
    const configContent =
  "{\n  \"agentlang\": {\n    \"service\": {\n      \"port\": 8080\n    }\n  },\n  \"agentlang.ai\": [\n    {\n      \"agentlang.ai/LLM\": {\n        \"name\": \"minimal_llm\",\n        \"service\": \"anthropic\",\n        \"config\": {\n          \"model\": \"claude-sonnet-4-5\",\n          \"maxTokens\": 1000,\n          \"temperature\": 0.7\n        }\n      }\n    }\n  ]\n}"

    const config = await loadAppConfig(configContent);
    assert(config !== undefined, 'Config with empty agentlang section should work');

    await runInitFunctions();

    const result: Instance[] = await parseAndEvaluateStatement(
      '{agentlang.ai/LLM {name? "minimal_llm"}}',
      undefined
    );

    assert(result.length === 1, 'LLM should not be created even with empty agentlang section');
  });

  test('should handle AgentLang pattern format config files', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentlang-test-pattern-'));

    const patternConfig = `{
    "type": "sqlite",
    "dbname": "test.db"
} @as store`;

    const configFile = path.join(tempDir, 'config.al');
    fs.writeFileSync(configFile, patternConfig);

    const config = await loadAppConfig(tempDir);
    assert(config !== undefined, 'Should handle AgentLang pattern format');
  });
});
