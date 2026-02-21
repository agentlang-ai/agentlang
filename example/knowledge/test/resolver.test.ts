import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// --- Mock helpers ---

function makeQueryInst(values: Record<string, any>) {
  const map = new Map<string, any>(Object.entries(values));
  return {
    getQueryValue(k: string) {
      return map.get(k);
    },
    lookup(k: string) {
      return map.get(k);
    },
    attributes: map,
  };
}

function makeCreateInst(values: Record<string, any>) {
  const map = new Map<string, any>(Object.entries(values));
  return {
    getQueryValue(k: string) {
      return map.get(k);
    },
    lookup(k: string) {
      return map.get(k);
    },
    attributes: map,
  };
}

function installConfigMock(overrides: Record<string, any> = {}) {
  (globalThis as any).agentlang = {
    fetchConfig: vi.fn().mockResolvedValue({
      rcloneRcUrl: 'http://localhost:9999',
      stagingDir: '/tmp/test-staging',
      storeDir: '/tmp/test-store',
      ...overrides,
    }),
    // OAuth stubs — tests can override these per-suite
    getOAuthAuthorizeUrl: vi.fn(),
    exchangeOAuthCode: vi.fn(),
    getAccessToken: vi.fn(),
  };
}

function mockFetchOk(jsonValue: any = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(jsonValue),
      text: vi.fn().mockResolvedValue(''),
    })
  );
}

// ─── queryCloudFiles ─────────────────────────────────────────────────────────

describe('queryCloudFiles', () => {
  let queryCloudFiles: Function;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RCLONE_RC_USER;
    delete process.env.RCLONE_RC_PASS;
    installConfigMock();
    mockFetchOk({ list: [] });
    const mod = await import('../src/resolver.js');
    queryCloudFiles = mod.queryCloudFiles;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).agentlang;
  });

  test('action=list calls operations/list', async () => {
    const inst = makeQueryInst({
      action: 'list',
      remoteName: 'myremote',
      remotePath: 'docs/stuff',
    });
    await queryCloudFiles(null, inst);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/operations/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fs: 'myremote:', remote: 'docs/stuff' }),
      })
    );
  });

  test('action=stat calls operations/stat', async () => {
    const inst = makeQueryInst({ action: 'stat', remoteName: 'myremote', remotePath: 'file.txt' });
    await queryCloudFiles(null, inst);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/operations/stat',
      expect.objectContaining({
        body: JSON.stringify({ fs: 'myremote:', remote: 'file.txt' }),
      })
    );
  });

  test('action=health calls rc/noop', async () => {
    const inst = makeQueryInst({ action: 'health' });
    await queryCloudFiles(null, inst);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/rc/noop',
      expect.objectContaining({
        body: JSON.stringify({ ping: 'knowledge-service' }),
      })
    );
  });

  test('missing remotePath defaults to empty string', async () => {
    const inst = makeQueryInst({ action: 'list', remoteName: 'myremote' });
    await queryCloudFiles(null, inst);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/operations/list',
      expect.objectContaining({
        body: JSON.stringify({ fs: 'myremote:', remote: '' }),
      })
    );
  });

  test('unknown action throws Error', async () => {
    const inst = makeQueryInst({ action: 'bogus', remoteName: 'r' });
    await expect(queryCloudFiles(null, inst)).rejects.toThrow('Unknown query action: bogus');
  });

  test('HTTP error throws with status and body', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });

    const inst = makeQueryInst({ action: 'list', remoteName: 'r', remotePath: '' });
    await expect(queryCloudFiles(null, inst)).rejects.toThrow(
      'rclone operations/list failed (500): Internal Server Error'
    );
  });
});

// ─── queryCloudFiles — auth headers ──────────────────────────────────────────

describe('queryCloudFiles — auth headers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).agentlang;
    delete process.env.RCLONE_RC_USER;
    delete process.env.RCLONE_RC_PASS;
  });

  test('includes Authorization Basic header when RCLONE_RC_USER is set', async () => {
    vi.resetModules();
    process.env.RCLONE_RC_USER = 'admin';
    process.env.RCLONE_RC_PASS = 'secret';
    installConfigMock();
    mockFetchOk();

    const mod = await import('../src/resolver.js');
    const inst = makeQueryInst({ action: 'health' });
    await mod.queryCloudFiles(null, inst);

    const expected = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expected }),
      })
    );
  });
});

// ─── createCloudFileOp ──────────────────────────────────────────────────────

describe('createCloudFileOp', () => {
  let createCloudFileOp: Function;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RCLONE_RC_USER;
    delete process.env.RCLONE_RC_PASS;
    tempDir = await mkdtemp(join(tmpdir(), 'resolver-create-'));
    installConfigMock({ stagingDir: tempDir, storeDir: join(tempDir, 'store') });
    mockFetchOk();
    const mod = await import('../src/resolver.js');
    createCloudFileOp = mod.createCloudFileOp;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete (globalThis as any).agentlang;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('action=create-remote calls config/create with parsed providerConfig', async () => {
    const providerConfig = JSON.stringify({ token: 'abc', client_id: 'xyz' });
    const inst = makeCreateInst({
      action: 'create-remote',
      remoteName: 'mydropbox',
      providerType: 'dropbox',
      providerConfig,
    });
    await createCloudFileOp(null, inst);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/config/create',
      expect.objectContaining({
        body: JSON.stringify({
          name: 'mydropbox',
          type: 'dropbox',
          parameters: { token: 'abc', client_id: 'xyz' },
        }),
      })
    );
  });

  test('action=delete-remote calls config/delete', async () => {
    const inst = makeCreateInst({ action: 'delete-remote', remoteName: 'old' });
    await createCloudFileOp(null, inst);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/config/delete',
      expect.objectContaining({
        body: JSON.stringify({ name: 'old' }),
      })
    );
  });

  test('action=copyfile calls operations/copyfile with stagingDir as dstFs', async () => {
    const inst = makeCreateInst({
      action: 'copyfile',
      remoteName: 'r',
      remotePath: 'docs/file.pdf',
      dstPath: 'local/file.pdf',
    });
    await createCloudFileOp(null, inst);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/operations/copyfile',
      expect.objectContaining({
        body: JSON.stringify({
          srcFs: 'r:',
          srcRemote: 'docs/file.pdf',
          dstFs: tempDir,
          dstRemote: 'local/file.pdf',
        }),
      })
    );
  });

  test('action=sync success sets attributes and creates staging directory', async () => {
    const inst = makeCreateInst({
      action: 'sync',
      remoteName: 'myremote',
      remotePath: 'docs',
    });

    const result = await createCloudFileOp(null, inst);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/sync/copy',
      expect.objectContaining({
        body: JSON.stringify({ srcFs: 'myremote:docs', dstFs: `${tempDir}/myremote` }),
      })
    );
    expect(result.attributes.get('stagingPath')).toBe(`${tempDir}/myremote`);
    expect(result.attributes.get('syncStatus')).toBe('completed');
    expect(result.attributes.get('errorIncrement')).toBe(0);

    // Verify staging directory was created on disk
    const { statSync } = await import('node:fs');
    expect(statSync(`${tempDir}/myremote`).isDirectory()).toBe(true);
  });

  test('action=sync failure catches error and sets failure attributes without throwing', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('Service Unavailable'),
    });

    const inst = makeCreateInst({
      action: 'sync',
      remoteName: 'failremote',
      remotePath: '',
    });

    // Should NOT throw — error is caught and reflected in attributes
    const result = await createCloudFileOp(null, inst);

    expect(result.attributes.get('syncStatus')).toBe('failed');
    expect(result.attributes.get('errorMessage')).toContain('503');
    expect(result.attributes.get('errorIncrement')).toBe(1);
  });

  test('unknown action throws', async () => {
    const inst = makeCreateInst({ action: 'nope', remoteName: 'r' });
    await expect(createCloudFileOp(null, inst)).rejects.toThrow('Unknown create action: nope');
  });
});

// ─── scanStagingFiles ────────────────────────────────────────────────────────

describe('scanStagingFiles', () => {
  let scanStagingFiles: Function;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RCLONE_RC_USER;
    delete process.env.RCLONE_RC_PASS;
    tempDir = await mkdtemp(join(tmpdir(), 'scan-test-'));
    installConfigMock({ stagingDir: tempDir });
    const mod = await import('../src/resolver.js');
    scanStagingFiles = mod.scanStagingFiles;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete (globalThis as any).agentlang;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('missing staging dir returns empty array', async () => {
    const inst = makeQueryInst({ remoteName: 'nonexistent' });
    const result = await scanStagingFiles(null, inst);
    expect(result).toEqual([]);
  });

  test('walks nested directory tree with correct metadata', async () => {
    const remoteName = 'testremote';
    const stagingPath = join(tempDir, remoteName);
    await mkdir(join(stagingPath, 'sub'), { recursive: true });
    await writeFile(join(stagingPath, 'file1.txt'), 'hello');
    await writeFile(join(stagingPath, 'sub', 'file2.pdf'), 'world!');

    const inst = makeQueryInst({ remoteName });
    const result = await scanStagingFiles(null, inst);

    expect(result).toHaveLength(2);
    const paths = result.map((f: any) => f.filePath).sort();
    expect(paths).toEqual(['file1.txt', 'sub/file2.pdf']);

    const file1 = result.find((f: any) => f.filePath === 'file1.txt');
    expect(file1.fileName).toBe('file1.txt');
    expect(file1.sizeBytes).toBe(5);
    expect(file1.remoteName).toBe(remoteName);
    expect(new Date(file1.remoteModifiedAt).getTime()).toBeGreaterThan(0);
  });

  test('filePath filter returns only matching file', async () => {
    const remoteName = 'filtered';
    const stagingPath = join(tempDir, remoteName);
    await mkdir(stagingPath, { recursive: true });
    await writeFile(join(stagingPath, 'a.txt'), 'aaa');
    await writeFile(join(stagingPath, 'b.txt'), 'bbb');

    const inst = makeQueryInst({ remoteName, filePath: 'b.txt' });
    const result = await scanStagingFiles(null, inst);

    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('b.txt');
  });
});

// ─── storeVersion ────────────────────────────────────────────────────────────

describe('storeVersion', () => {
  let storeVersion: Function;
  let tempDir: string;
  let stagingDir: string;
  let storeDir: string;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RCLONE_RC_USER;
    delete process.env.RCLONE_RC_PASS;
    tempDir = await mkdtemp(join(tmpdir(), 'store-test-'));
    stagingDir = join(tempDir, 'staging');
    storeDir = join(tempDir, 'store');
    await mkdir(stagingDir, { recursive: true });
    await mkdir(storeDir, { recursive: true });
    installConfigMock({ stagingDir, storeDir });
    const mod = await import('../src/resolver.js');
    storeVersion = mod.storeVersion;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete (globalThis as any).agentlang;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('copies file from staging to versioned store and sets storagePath', async () => {
    const remoteName = 'myremote';
    const filePath = 'docs/report.pdf';
    const remoteModifiedAt = '2024-01-15T10:30:00.000Z';
    const content = 'PDF content here';

    await mkdir(join(stagingDir, remoteName, 'docs'), { recursive: true });
    await writeFile(join(stagingDir, remoteName, filePath), content);

    const inst = makeCreateInst({ remoteName, filePath, remoteModifiedAt });
    const result = await storeVersion(null, inst);

    const expectedDst = join(storeDir, remoteName, filePath, '2024-01-15T10-30-00.000Z');
    expect(result.attributes.get('storagePath')).toBe(expectedDst);

    const copied = readFileSync(expectedDst, 'utf-8');
    expect(copied).toBe(content);
  });

  test('sets contentHash as MD5 hex digest', async () => {
    const content = 'test content for hashing';
    const expectedHash = createHash('md5').update(content).digest('hex');

    const remoteName = 'hashtest';
    const filePath = 'file.txt';
    const remoteModifiedAt = '2024-06-01T00:00:00.000Z';

    await mkdir(join(stagingDir, remoteName), { recursive: true });
    await writeFile(join(stagingDir, remoteName, filePath), content);

    const inst = makeCreateInst({ remoteName, filePath, remoteModifiedAt });
    const result = await storeVersion(null, inst);

    expect(result.attributes.get('contentHash')).toBe(expectedHash);
  });

  test('sanitizes colons in timestamp for filesystem path', async () => {
    const remoteName = 'sanitize';
    const filePath = 'test.txt';
    const remoteModifiedAt = '2024-03-20T14:45:30.000Z';

    await mkdir(join(stagingDir, remoteName), { recursive: true });
    await writeFile(join(stagingDir, remoteName, filePath), 'data');

    const inst = makeCreateInst({ remoteName, filePath, remoteModifiedAt });
    const result = await storeVersion(null, inst);

    const storagePath = result.attributes.get('storagePath') as string;
    expect(storagePath).toContain('2024-03-20T14-45-30.000Z');
    expect(storagePath).not.toContain(':');
  });
});

// ─── queryOAuth ──────────────────────────────────────────────────────────────

describe('queryOAuth', () => {
  let queryOAuth: Function;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RCLONE_RC_USER;
    delete process.env.RCLONE_RC_PASS;
    installConfigMock();
    mockFetchOk();
    const mod = await import('../src/resolver.js');
    queryOAuth = mod.queryOAuth;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).agentlang;
  });

  test('action=auth-url calls getOAuthAuthorizeUrl and returns authUrl + state', async () => {
    (globalThis as any).agentlang.getOAuthAuthorizeUrl.mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=xyz&state=abc123',
      state: 'abc123',
    });

    const inst = makeQueryInst({
      action: 'auth-url',
      provider: 'google_drive',
      redirectUri: 'https://app/callback',
    });
    const result = await queryOAuth(null, inst);

    expect((globalThis as any).agentlang.getOAuthAuthorizeUrl).toHaveBeenCalledWith(
      'google_drive',
      'https://app/callback'
    );
    expect(result.authUrl).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=xyz&state=abc123'
    );
    expect(result.state).toBe('abc123');
    expect(result.provider).toBe('google_drive');
  });

  test('action=auth-url throws when redirectUri is missing', async () => {
    const inst = makeQueryInst({ action: 'auth-url', provider: 'google_drive' });
    await expect(queryOAuth(null, inst)).rejects.toThrow('redirectUri is required');
  });

  test('action=access-token calls getAccessToken and returns token', async () => {
    (globalThis as any).agentlang.getAccessToken.mockResolvedValue({
      accessToken: 'ya29.fresh',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });

    const inst = makeQueryInst({ action: 'access-token', provider: 'google_drive' });
    const result = await queryOAuth(null, inst);

    expect((globalThis as any).agentlang.getAccessToken).toHaveBeenCalledWith('google_drive');
    expect(result.accessToken).toBe('ya29.fresh');
    expect(result.expiresIn).toBe(3600);
    expect(result.tokenType).toBe('Bearer');
  });

  test('unknown action throws', async () => {
    const inst = makeQueryInst({ action: 'bogus', provider: 'google_drive' });
    await expect(queryOAuth(null, inst)).rejects.toThrow('Unknown OAuth query action: bogus');
  });

  test('unknown provider throws', async () => {
    const inst = makeQueryInst({ action: 'auth-url', provider: 'github', redirectUri: 'http://x' });
    await expect(queryOAuth(null, inst)).rejects.toThrow('Unknown OAuth provider: github');
  });
});

// ─── createOAuthOp ───────────────────────────────────────────────────────────

describe('createOAuthOp', () => {
  let createOAuthOp: Function;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RCLONE_RC_USER;
    delete process.env.RCLONE_RC_PASS;
    installConfigMock();
    mockFetchOk();
    const mod = await import('../src/resolver.js');
    createOAuthOp = mod.createOAuthOp;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).agentlang;
  });

  test('action=connect exchanges code, creates rclone remote, returns remoteName', async () => {
    (globalThis as any).agentlang.exchangeOAuthCode.mockResolvedValue({
      accessToken: 'ya29.token',
      refreshToken: 'rt_refresh',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });

    const inst = makeCreateInst({
      action: 'connect',
      provider: 'google_drive',
      code: 'authcode123',
      state: 'state456',
      redirectUri: 'https://app/callback',
    });

    const result = await createOAuthOp(null, inst);

    expect((globalThis as any).agentlang.exchangeOAuthCode).toHaveBeenCalledWith(
      'google_drive',
      'authcode123',
      'state456'
    );

    // Should have called rclone config/create
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:9999/config/create',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"type":"drive"'),
      })
    );

    expect(result.provider).toBe('google_drive');
    expect(result.remoteName).toMatch(/^google_drive_[a-f0-9]{8}$/);
    expect(result.accessToken).toBe('ya29.token');
    expect(result.expiresIn).toBe(3600);
  });

  test('action=connect throws when code is missing', async () => {
    const inst = makeCreateInst({
      action: 'connect',
      provider: 'google_drive',
      state: 'state456',
    });
    await expect(createOAuthOp(null, inst)).rejects.toThrow('code and state are required');
  });

  test('unknown action throws', async () => {
    const inst = makeCreateInst({ action: 'nope', provider: 'google_drive' });
    await expect(createOAuthOp(null, inst)).rejects.toThrow('Unknown OAuth create action: nope');
  });
});

// ─── sync token refresh ──────────────────────────────────────────────────────

describe('createCloudFileOp — OAuth token refresh before sync', () => {
  let createCloudFileOp: Function;
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.RCLONE_RC_USER;
    delete process.env.RCLONE_RC_PASS;
    tempDir = await mkdtemp(join(tmpdir(), 'sync-oauth-'));
    installConfigMock({ stagingDir: tempDir, storeDir: join(tempDir, 'store') });
    mockFetchOk();
    (globalThis as any).agentlang.getAccessToken.mockResolvedValue({
      accessToken: 'ya29.fresh',
      expiresIn: 3600,
      tokenType: 'Bearer',
    });
    const mod = await import('../src/resolver.js');
    createCloudFileOp = mod.createCloudFileOp;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete (globalThis as any).agentlang;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('refreshes token via getAccessToken for OAuth remotes before sync', async () => {
    const inst = makeCreateInst({
      action: 'sync',
      remoteName: 'google_drive_abc12345',
      remotePath: 'docs',
    });

    await createCloudFileOp(null, inst);

    // getAccessToken should be called for the google_drive integration
    expect((globalThis as any).agentlang.getAccessToken).toHaveBeenCalledWith('google_drive');

    // fetch should be called for config/update (token refresh) + sync/sync
    const fetchCalls = (fetch as any).mock.calls.map((c: any[]) => c[0]);
    expect(fetchCalls).toContain('http://localhost:9999/config/update');
  });

  test('does not refresh token for non-OAuth remotes', async () => {
    const inst = makeCreateInst({
      action: 'sync',
      remoteName: 'mybox_remote',
      remotePath: '',
    });

    await createCloudFileOp(null, inst);

    expect((globalThis as any).agentlang.getAccessToken).not.toHaveBeenCalled();
  });
});
