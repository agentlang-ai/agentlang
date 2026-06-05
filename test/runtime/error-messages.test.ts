import { assert, describe, test, beforeAll, afterAll, beforeEach } from 'vitest';
import { doPreInit } from '../util.js';
import {
  initDatabase,
  resetDefaultDatabase,
} from '../../src/runtime/resolvers/sqldb/database.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { ConfigSchema, setAppConfig, AppConfig, type Config } from '../../src/runtime/state.js';
import {
  resolveEntityErrorMessage,
  applyErrorMessageTemplate,
} from '../../src/runtime/errors/http-error.js';

function seedErrorMessage(target: string, code: string, message: string): Promise<unknown> {
  return parseAndEvaluateStatement(
    `{agentlang/errorMessage {target "${target}", code "${code}", message "${message}"}}`
  );
}

describe('custom error messages (errorMessage system entity)', () => {
  let prevConfig: Config | undefined;
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
    if (prevConfig !== undefined) {
      setAppConfig(prevConfig);
    }
    await resetDefaultDatabase();
  });

  beforeEach(async () => {
    prevConfig = AppConfig;
    await resetDefaultDatabase();
    await initDatabase({ type: 'sqljs' });
    setAppConfig(
      ConfigSchema.parse({
        service: { port: 8080, httpFileHandling: false },
        customErrorMessages: { enabled: true },
      })
    );
  });

  test('resolveEntityErrorMessage uses per-entity override when enabled', async () => {
    await seedErrorMessage('HRT/User', 'AL_MOD_NOT_A_RECORD', 'Custom: unknown entity for this app');
    const msg = await resolveEntityErrorMessage(
      'HRT',
      'User',
      'AL_MOD_NOT_A_RECORD',
      'default message'
    );
    assert(msg === 'Custom: unknown entity for this app');
  });

  test('universal (*) override applies to any entity route', async () => {
    await seedErrorMessage('*', 'AL_MOD_INVALID_ATTR', 'Global invalid field message');
    const msg = await resolveEntityErrorMessage('HRT', 'User', 'AL_MOD_INVALID_ATTR', 'original');
    assert(msg === 'Global invalid field message');
  });

  test('per-entity override wins over universal for same code', async () => {
    await seedErrorMessage('*', 'AL_FOO', 'universal');
    await seedErrorMessage('HRT/User', 'AL_FOO', 'entity-specific');
    assert((await resolveEntityErrorMessage('HRT', 'User', 'AL_FOO', 'def')) === 'entity-specific');
    assert((await resolveEntityErrorMessage('HRT', 'Post', 'AL_FOO', 'def')) === 'universal');
  });

  test('template substitutes {{code}} and {{message}}', async () => {
    await seedErrorMessage('*', 'AL_X', 'cognito error: {{code}}, message: {{message}}');
    const msg = await resolveEntityErrorMessage('m', 'e', 'AL_X', 'something failed');
    assert(msg === 'cognito error: AL_X, message: something failed');
  });

  test('falls back to default message when no override exists', async () => {
    const msg = await resolveEntityErrorMessage('m', 'e', 'AL_UNKNOWN', 'the default');
    assert(msg === 'the default');
  });

  test('returns default message when custom messages are disabled', async () => {
    await seedErrorMessage('*', 'AL_Y', 'should be ignored');
    setAppConfig(
      ConfigSchema.parse({
        service: { port: 8080, httpFileHandling: false },
        customErrorMessages: { enabled: false },
      })
    );
    const msg = await resolveEntityErrorMessage('m', 'e', 'AL_Y', 'the default');
    assert(msg === 'the default');
  });

  test('applyErrorMessageTemplate handles repeated placeholders', () => {
    assert(
      applyErrorMessageTemplate('{{code}} / {{code}}', 'C', 'm') === 'C / C',
      'repeated {{code}}'
    );
  });
});
