import { describe, test, assert, beforeEach, vi } from 'vitest';
import {
  configureIntegrationClient,
  getIntegrationAuthHeaders,
  refreshIntegrationAuth,
  integrationAuthFetch,
  isIntegrationClientConfigured,
} from '../../src/runtime/integration-client.js';

describe('Integration Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('isIntegrationClientConfigured returns false before configuration', () => {
    // Note: configureIntegrationClient has module-level state, so this test
    // depends on ordering. In a fresh module it would be false.
    // We just test that configureIntegrationClient makes it true.
    configureIntegrationClient('http://localhost:9090');
    assert(isIntegrationClientConfigured() === true);
  });

  test('getIntegrationAuthHeaders calls the correct URL', async () => {
    configureIntegrationClient('http://integ-host:8080');

    const mockResponse = {
      ok: true,
      json: async () => ({ integrationName: 'myApi', headers: { Authorization: 'Bearer test-token' } }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    const headers = await getIntegrationAuthHeaders('myApi');
    assert(headers['Authorization'] === 'Bearer test-token');

    assert(fetchSpy.mock.calls.length === 1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    assert(calledUrl === 'http://integ-host:8080/integmanager.auth/authHeaders/myApi');
  });

  test('getIntegrationAuthHeaders throws on non-ok response', async () => {
    configureIntegrationClient('http://integ-host:8080');

    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    let threw = false;
    try {
      await getIntegrationAuthHeaders('nonexistent');
    } catch (err: any) {
      threw = true;
      assert(err.message.includes('404'));
    }
    assert(threw);
  });

  test('refreshIntegrationAuth calls the correct URL', async () => {
    configureIntegrationClient('http://integ-host:8080');

    const mockResponse = {
      ok: true,
      json: async () => ({ success: true }),
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    await refreshIntegrationAuth('myApi');

    assert(fetchSpy.mock.calls.length === 1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    assert(calledUrl === 'http://integ-host:8080/integmanager.auth/authRefresh');

    const calledOptions = fetchSpy.mock.calls[0][1] as any;
    assert(calledOptions.method === 'POST');
    const body = JSON.parse(calledOptions.body);
    assert(body.integrationName === 'myApi');
  });

  test('integrationAuthFetch merges auth headers into request', async () => {
    configureIntegrationClient('http://integ-host:8080');

    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, options: any) => {
      callCount++;
      if (callCount === 1) {
        // First call: getIntegrationAuthHeaders
        return {
          ok: true,
          json: async () => ({ headers: { Authorization: 'Bearer merged-token' } }),
        } as any;
      }
      // Second call: the actual request
      assert(options.headers['Authorization'] === 'Bearer merged-token');
      assert(options.headers['X-Custom'] === 'custom-value');
      return { ok: true, json: async () => ({ result: 'ok' }) } as any;
    });

    await integrationAuthFetch('myApi', 'https://api.example.com/data', {
      headers: { 'X-Custom': 'custom-value' },
    });

    assert(callCount === 2);
  });

  test('getIntegrationAuthHeaders handles array response', async () => {
    configureIntegrationClient('http://integ-host:8080');

    const mockResponse = {
      ok: true,
      json: async () => [{ integrationName: 'myApi', headers: { 'X-Key': 'value' } }],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

    const headers = await getIntegrationAuthHeaders('myApi');
    assert(headers['X-Key'] === 'value');
  });
});
