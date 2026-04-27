import { assert, describe, test, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigSchema, setAppConfig, AppConfig, type Config } from '../../src/runtime/state.js';
import {
  initErrorMessageOverrides,
  resolveEntityErrorMessage,
  applyErrorMessageTemplate,
} from '../../src/runtime/errors/http-error.js';

describe('custom error messages (errors.json)', () => {
  let prevConfig: Config | undefined;
  let tmpDir: string;

  beforeEach(async () => {
    prevConfig = AppConfig;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentlang-err-'));
  });

  afterEach(async () => {
    await initErrorMessageOverrides(undefined, { enabled: false });
    if (prevConfig !== undefined) {
      setAppConfig(prevConfig);
    }
  });

  test('resolveEntityErrorMessage uses per-entity map when enabled', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'errors.json'),
      JSON.stringify({
        'HRT/User': {
          AL_MOD_NOT_A_RECORD: 'Custom: unknown entity for this app',
        },
      }),
      'utf8'
    );
    const cfg = ConfigSchema.parse({
      service: { port: 8080, httpFileHandling: false },
      customErrorMessages: { enabled: true },
    });
    setAppConfig(cfg);
    await initErrorMessageOverrides(tmpDir, { enabled: true });
    const msg = resolveEntityErrorMessage(
      'HRT',
      'User',
      'AL_MOD_NOT_A_RECORD',
      'default message'
    );
    assert(msg === 'Custom: unknown entity for this app');
  });

  test('universal code mapping applies to any entity route', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'errors.json'),
      JSON.stringify({
        AL_MOD_INVALID_ATTR: 'Global invalid field message',
      }),
      'utf8'
    );
    const cfg = ConfigSchema.parse({
      service: { port: 8080, httpFileHandling: false },
      customErrorMessages: { enabled: true },
    });
    setAppConfig(cfg);
    await initErrorMessageOverrides(tmpDir, { enabled: true });
    const msg = resolveEntityErrorMessage('HRT', 'User', 'AL_MOD_INVALID_ATTR', 'original');
    assert(msg === 'Global invalid field message');
  });

  test('per-entity entry wins over universal for same code', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'errors.json'),
      JSON.stringify({
        AL_FOO: 'universal',
        'HRT/User': { AL_FOO: 'entity-specific' },
      }),
      'utf8'
    );
    setAppConfig(
      ConfigSchema.parse({
        service: { port: 8080, httpFileHandling: false },
        customErrorMessages: { enabled: true },
      })
    );
    await initErrorMessageOverrides(tmpDir, { enabled: true });
    assert(resolveEntityErrorMessage('HRT', 'User', 'AL_FOO', 'def') === 'entity-specific');
    assert(resolveEntityErrorMessage('HRT', 'Post', 'AL_FOO', 'def') === 'universal');
  });

  test('template substitutes {{code}} and {{message}}', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'errors.json'),
      JSON.stringify({
        AL_X: 'cognito error: {{code}}, message: {{message}}',
      }),
      'utf8'
    );
    setAppConfig(
      ConfigSchema.parse({
        service: { port: 8080, httpFileHandling: false },
        customErrorMessages: { enabled: true },
      })
    );
    await initErrorMessageOverrides(tmpDir, { enabled: true });
    const msg = resolveEntityErrorMessage('m', 'e', 'AL_X', 'something failed');
    assert(msg === 'cognito error: AL_X, message: something failed');
  });

  test('applyErrorMessageTemplate handles repeated placeholders', () => {
    assert(
      applyErrorMessageTemplate('{{code}} / {{code}}', 'C', 'm') === 'C / C',
      'repeated {{code}}'
    );
  });

  test('custom fileName loads alternate JSON file', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'abc.json'),
      JSON.stringify({ AL_Z: 'from abc' }),
      'utf8'
    );
    setAppConfig(
      ConfigSchema.parse({
        service: { port: 8080, httpFileHandling: false },
        customErrorMessages: { enabled: true, fileName: 'abc.json' },
      })
    );
    await initErrorMessageOverrides(tmpDir, { enabled: true, fileName: 'abc.json' });
    assert(resolveEntityErrorMessage('a', 'b', 'AL_Z', 'd') === 'from abc');
  });

  test('initErrorMessageOverrides throws when file missing and enabled', async () => {
    const cfg = ConfigSchema.parse({
      service: { port: 8080, httpFileHandling: false },
      customErrorMessages: { enabled: true },
    });
    setAppConfig(cfg);
    let threw = false;
    try {
      await initErrorMessageOverrides(tmpDir, { enabled: true });
    } catch {
      threw = true;
    }
    assert(threw, 'expected missing errors.json to throw');
  });
});
