// Resolver for cloud file operations via rclone's RC API.
// rclone must be running in daemon mode (rclone rcd) with RC enabled.
//
// Start rclone daemon:
//   rclone rcd --rc-addr :5572 --rc-user $RCLONE_RC_USER --rc-pass $RCLONE_RC_PASS

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const RCLONE_RC_USER = process.env.RCLONE_RC_USER || '';
const RCLONE_RC_PASS = process.env.RCLONE_RC_PASS || '';

function expandTilde(p) {
  return p.startsWith('~') ? p.replace('~', homedir()) : p;
}

async function getConfig() {
  const config = await agentlang.fetchConfig('knowledge.core/Config');
  return {
    rcloneRcUrl: config?.rcloneRcUrl || process.env.RCLONE_RC_URL || 'http://localhost:5572',
    stagingDir: expandTilde(
      config?.stagingDir ||
        process.env.STAGING_DIR ||
        `${homedir()}/.agentlang/studio/.knowledge_staging`
    ),
    storeDir: expandTilde(
      config?.storeDir || process.env.STORE_DIR || `${homedir()}/.agentlang/studio/.knowledge_store`
    ),
  };
}

function authHeaders() {
  if (!RCLONE_RC_USER) return {};
  const creds = Buffer.from(`${RCLONE_RC_USER}:${RCLONE_RC_PASS}`).toString('base64');
  return { Authorization: `Basic ${creds}` };
}

// POST to an rclone RC endpoint. All RC calls are POST with JSON body.
async function rc(rcloneRcUrl, endpoint, params = {}) {
  const url = `${rcloneRcUrl}/${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`rclone ${endpoint} failed (${response.status}): ${body}`);
  }
  return response.json();
}

// Build an rclone-compatible token JSON from an access token response.
function rcloneTokenFromAccessToken(tokenData) {
  return {
    access_token: tokenData.accessToken,
    token_type: tokenData.tokenType || 'Bearer',
    expiry: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
  };
}

// Refresh an rclone remote's token from integration-manager before sync.
async function refreshRcloneToken(cfg, remoteName, integrationName) {
  try {
    const token = await agentlang.getAccessToken(integrationName);
    const rcloneToken = rcloneTokenFromAccessToken(token);
    await rc(cfg.rcloneRcUrl, 'config/update', {
      name: remoteName,
      parameters: { token: JSON.stringify(rcloneToken) },
    });
  } catch (err) {
    // Token refresh is best-effort — log and continue with existing token.
    console.warn(`[knowledge] token refresh for ${remoteName} failed: ${err.message}`);
  }
}

// --- Query resolver ---
// Read-only operations: list files, stat a path, check health.
export async function queryCloudFiles(ctx, inst) {
  const cfg = await getConfig();
  const action = inst.getQueryValue('action');
  const remoteName = inst.getQueryValue('remoteName');
  const remotePath = inst.getQueryValue('remotePath') || '';

  switch (action) {
    case 'list':
      // operations/list — list files at remoteName:remotePath
      return rc(cfg.rcloneRcUrl, 'operations/list', {
        fs: `${remoteName}:`,
        remote: remotePath,
      });

    case 'stat':
      // operations/stat — metadata for a single file or directory
      return rc(cfg.rcloneRcUrl, 'operations/stat', {
        fs: `${remoteName}:`,
        remote: remotePath,
      });

    case 'health':
      // rc/noop — echo back, confirms daemon is alive
      return rc(cfg.rcloneRcUrl, 'rc/noop', { ping: 'knowledge-service' });

    default:
      throw new Error(`Unknown query action: ${action}`);
  }
}

// --- Create resolver ---
// Mutating operations: configure a remote, copy a file, sync a directory.
export async function createCloudFileOp(ctx, inst) {
  const cfg = await getConfig();
  const action = inst.lookup('action');
  const remoteName = inst.lookup('remoteName');
  const remotePath = inst.lookup('remotePath') || '';

  switch (action) {
    case 'create-remote':
      // config/create — register a new rclone remote
      // providerType: rclone backend type, e.g. "dropbox", "onedrive", "drive", "box"
      // providerConfig: JSON string of provider-specific params (token, client_id, etc.)
      return rc(cfg.rcloneRcUrl, 'config/create', {
        name: remoteName,
        type: inst.lookup('providerType'),
        parameters: JSON.parse(inst.lookup('providerConfig') || '{}'),
      });

    case 'delete-remote':
      // config/delete — remove a remote from rclone config
      return rc(cfg.rcloneRcUrl, 'config/delete', { name: remoteName });

    case 'copyfile':
      // operations/copyfile — download a single file from remote to local staging
      return rc(cfg.rcloneRcUrl, 'operations/copyfile', {
        srcFs: `${remoteName}:`,
        srcRemote: remotePath,
        dstFs: cfg.stagingDir,
        dstRemote: inst.lookup('dstPath') || remotePath,
      });

    case 'sync': {
      // sync/sync — mirror remote directory to a stable staging directory.
      // Uses sync (not copy) so files deleted on the remote are also removed from staging.
      // The staging path is per-remote so rclone can detect unchanged files and skip them.
      // Returns stagingPath, syncStatus, and errorIncrement on the instance so the
      // workflow can update SyncJob and Connection without needing error branching.

      // Refresh rclone token from integration-manager for OAuth remotes.
      const oauthProviderPrefixes = {
        google_drive_: 'google_drive',
        onedrive_: 'onedrive',
      };
      for (const [prefix, integrationName] of Object.entries(oauthProviderPrefixes)) {
        if (remoteName.startsWith(prefix)) {
          await refreshRcloneToken(cfg, remoteName, integrationName);
          break;
        }
      }

      const stagingPath = `${cfg.stagingDir}/${remoteName}`;
      mkdirSync(stagingPath, { recursive: true });
      try {
        await rc(cfg.rcloneRcUrl, 'sync/sync', {
          srcFs: `${remoteName}:${remotePath}`,
          dstFs: stagingPath,
        });
        inst.attributes.set('stagingPath', stagingPath);
        inst.attributes.set('syncStatus', 'completed');
        inst.attributes.set('errorIncrement', 0);
      } catch (err) {
        console.error(`[knowledge] sync failed for ${remoteName}:${remotePath} — ${err.message}`);
        inst.attributes.set('stagingPath', stagingPath);
        inst.attributes.set('syncStatus', 'failed');
        inst.attributes.set('errorMessage', err.message);
        inst.attributes.set('errorIncrement', 1);
      }
      return inst;
    }

    default:
      throw new Error(`Unknown create action: ${action}`);
  }
}

// --- Staging file scanner ---
// After rclone sync/copy, walk the staging directory and return metadata
// for each file. The workflow compares these against KnowledgeDocument
// records in the DB to determine added, modified, and deleted files.

export async function scanStagingFiles(ctx, inst) {
  const cfg = await getConfig();
  const remoteName = inst.getQueryValue('remoteName');
  const filePathFilter = inst.getQueryValue('filePath');
  const stagingPath = `${cfg.stagingDir}/${remoteName}`;

  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = relative(stagingPath, full);
        if (filePathFilter && rel !== filePathFilter) continue;
        const stat = statSync(full);
        files.push({
          remoteName,
          filePath: rel,
          fileName: entry.name,
          sizeBytes: stat.size,
          // rclone preserves remote modification time as local mtime.
          remoteModifiedAt: new Date(stat.mtimeMs).toISOString(),
        });
      }
    }
  }
  try {
    walk(stagingPath);
  } catch {
    // Staging dir may not exist yet (first sync) — empty is correct.
  }
  return files;
}

// --- Version store ---
// Copy a file from staging into the immutable versioned store and compute its content hash.
// Called by the processChangelog workflow for "added" and "modified" changelog entries.

export async function storeVersion(ctx, inst) {
  const cfg = await getConfig();
  const remoteName = inst.lookup('remoteName');
  const filePath = inst.lookup('filePath');
  const remoteModifiedAt = inst.lookup('remoteModifiedAt');

  // Sanitize timestamp for filesystem use (colons are invalid on Windows, ugly elsewhere).
  const sanitizedTs = remoteModifiedAt.replace(/:/g, '-');

  const src = join(cfg.stagingDir, remoteName, filePath);
  const dst = join(cfg.storeDir, remoteName, filePath, sanitizedTs);

  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);

  const hash = createHash('md5').update(readFileSync(dst)).digest('hex');

  inst.attributes.set('storagePath', dst);
  inst.attributes.set('contentHash', hash);
  return inst;
}

// --- Cloud download (native file picker) ---
// Download files directly from a cloud provider using its API.
// Called by the native file picker flow (bypasses rclone).

const extensionToFileType = {
  pdf: 'pdf',
  docx: 'docx',
  doc: 'docx',
  txt: 'text',
  md: 'markdown',
  csv: 'text',
  html: 'html',
  htm: 'html',
};

function detectFileTypeFromName(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return extensionToFileType[ext] || 'unknown';
}

export async function createCloudDownload(ctx, inst) {
  const cfg = await getConfig();
  const provider = inst.lookup('provider');
  const connectionId = inst.lookup('connectionId');
  const itemsRaw = inst.lookup('items');
  const items = JSON.parse(Buffer.from(itemsRaw, 'base64').toString('utf-8'));

  const results = [];

  for (const item of items) {
    try {
      let fileBuffer;
      let remotePath;

      switch (provider) {
        case 'onedrive': {
          const token = await agentlang.getAccessToken('onedrive');
          const graphUrl = `https://graph.microsoft.com/v1.0/drives/${item.driveId}/items/${item.itemId}/content`;
          const response = await fetch(graphUrl, {
            headers: { Authorization: `Bearer ${token.accessToken}` },
            redirect: 'follow',
          });
          if (!response.ok) {
            throw new Error(`Graph API ${response.status}: ${await response.text()}`);
          }
          fileBuffer = Buffer.from(await response.arrayBuffer());
          remotePath = `drives/${item.driveId}/items/${item.itemId}`;
          break;
        }
        case 'google_drive': {
          const gdToken = await agentlang.getAccessToken('google-drive');
          const gdHeaders = { Authorization: `Bearer ${gdToken.accessToken}` };

          // Fetch metadata (modifiedTime) and file content in parallel
          const [gdMetaResponse, gdResponse] = await Promise.all([
            fetch(`https://www.googleapis.com/drive/v3/files/${item.itemId}?fields=modifiedTime`, {
              headers: gdHeaders,
            }),
            fetch(`https://www.googleapis.com/drive/v3/files/${item.itemId}?alt=media`, {
              headers: gdHeaders,
            }),
          ]);
          if (!gdResponse.ok) {
            throw new Error(`Google Drive API ${gdResponse.status}: ${await gdResponse.text()}`);
          }
          fileBuffer = Buffer.from(await gdResponse.arrayBuffer());
          remotePath = `files/${item.itemId}`;
          if (gdMetaResponse.ok) {
            const gdMeta = await gdMetaResponse.json();
            item.remoteModifiedAt = gdMeta.modifiedTime;
          }
          break;
        }
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }

      // Write to version store
      const sanitizedTs = new Date().toISOString().replace(/:/g, '-');
      const connPrefix = connectionId.slice(0, 8);
      const storagePath = join(cfg.storeDir, `${provider}_${connPrefix}`, item.name, sanitizedTs);
      mkdirSync(dirname(storagePath), { recursive: true });
      writeFileSync(storagePath, fileBuffer);

      const contentHash = createHash('md5').update(fileBuffer).digest('hex');

      results.push({
        itemId: item.itemId,
        fileName: item.name,
        fileType: detectFileTypeFromName(item.name),
        sizeBytes: fileBuffer.length,
        contentHash,
        storagePath,
        remotePath,
        remoteModifiedAt: item.remoteModifiedAt,
      });
    } catch (err) {
      results.push({
        itemId: item.itemId,
        fileName: item.name,
        error: err.message,
      });
    }
  }

  const hasErrors = results.some(r => r.error);
  inst.attributes.set('results', JSON.stringify(results));
  inst.attributes.set('status', hasErrors ? 'partial' : 'completed');
  if (hasErrors) {
    const errorMessages = results.filter(r => r.error).map(r => `${r.fileName}: ${r.error}`);
    inst.attributes.set('errorMessage', errorMessages.join('; '));
  }
  return inst;
}

// --- Native picker sync ---
// Checks remote metadata for documents downloaded via native file pickers,
// downloads changed files to staging, and creates SyncChangelog entries.

const providerToIntegration = {
  google_drive: 'google-drive',
  onedrive: 'onedrive',
};

async function fetchRemoteMetadata(provider, remotePath, accessToken) {
  switch (provider) {
    case 'google_drive': {
      // remotePath format: files/{fileId}
      const fileId = remotePath.replace('files/', '');
      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime,size,trashed`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 404) return { deleted: true };
      if (!res.ok) throw new Error(`Google Drive API ${res.status}: ${await res.text()}`);
      const meta = await res.json();
      if (meta.trashed) return { deleted: true };
      return {
        modifiedAt: meta.modifiedTime,
        sizeBytes: meta.size ? parseInt(meta.size, 10) : 0,
      };
    }
    case 'onedrive': {
      // remotePath format: drives/{driveId}/items/{itemId}
      const url = `https://graph.microsoft.com/v1.0/${remotePath}?$select=lastModifiedDateTime,size,deleted`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 404) return { deleted: true };
      if (!res.ok) throw new Error(`Graph API ${res.status}: ${await res.text()}`);
      const meta = await res.json();
      if (meta.deleted) return { deleted: true };
      return {
        modifiedAt: meta.lastModifiedDateTime,
        sizeBytes: meta.size || 0,
      };
    }
    default:
      throw new Error(`Unsupported provider for native picker sync: ${provider}`);
  }
}

async function downloadRemoteFile(provider, remotePath, accessToken) {
  switch (provider) {
    case 'google_drive': {
      const fileId = remotePath.replace('files/', '');
      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Google Drive download ${res.status}: ${await res.text()}`);
      return Buffer.from(await res.arrayBuffer());
    }
    case 'onedrive': {
      const url = `https://graph.microsoft.com/v1.0/${remotePath}/content`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`Graph download ${res.status}: ${await res.text()}`);
      return Buffer.from(await res.arrayBuffer());
    }
    default:
      throw new Error(`Unsupported provider for download: ${provider}`);
  }
}

export async function syncNativePicker(ctx, inst) {
  const cfg = await getConfig();
  const provider = inst.lookup('provider');
  const connectionId = inst.lookup('connectionId');
  const tenantId = inst.lookup('tenantId');
  const externalConnectionId = inst.lookup('externalConnectionId');
  const syncJobId = inst.lookup('syncJobId');

  const port = process.env.PORT || '8080';
  const baseUrl = `http://localhost:${port}/knowledge.core`;

  // Get access token for this provider
  const integrationName = providerToIntegration[provider];
  if (!integrationName) {
    inst.attributes.set('syncStatus', 'failed');
    inst.attributes.set('errorMessage', `Unknown provider: ${provider}`);
    inst.attributes.set('errorIncrement', 1);
    return inst;
  }

  let token;
  try {
    token = await agentlang.getAccessToken(integrationName);
  } catch (err) {
    inst.attributes.set('syncStatus', 'failed');
    inst.attributes.set('errorMessage', `Token refresh failed: ${err.message}`);
    inst.attributes.set('errorIncrement', 1);
    return inst;
  }

  // Fetch all non-deleted documents for this connection
  let documents;
  try {
    const docsUrl = `${baseUrl}/KnowledgeDocument?connectionId=${connectionId}&isDeleted=false`;
    const docsRes = await fetch(docsUrl);
    if (!docsRes.ok) throw new Error(`Fetch documents ${docsRes.status}: ${await docsRes.text()}`);
    documents = await docsRes.json();
  } catch (err) {
    inst.attributes.set('syncStatus', 'failed');
    inst.attributes.set('errorMessage', `Failed to query documents: ${err.message}`);
    inst.attributes.set('errorIncrement', 1);
    return inst;
  }

  let docErrors = 0;

  for (const doc of documents) {
    try {
      const meta = await fetchRemoteMetadata(provider, doc.remotePath, token.accessToken);

      if (meta.deleted) {
        // File was trashed or deleted on the remote — create "deleted" changelog entry
        await fetch(`${baseUrl}/SyncChangelog`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            syncJobId,
            connectionId,
            tenantId,
            filePath: doc.remotePath,
            fileName: doc.fileName,
            changeType: 'deleted',
            status: 'pending',
          }),
        });
        continue;
      }

      // Compare remote modification time against what we stored
      const remoteModified = new Date(meta.modifiedAt);
      const localModified = doc.remoteModifiedAt ? new Date(doc.remoteModifiedAt) : null;

      if (localModified && remoteModified <= localModified) {
        // File hasn't changed — skip
        continue;
      }

      // File was modified — download to staging
      const fileBuffer = await downloadRemoteFile(provider, doc.remotePath, token.accessToken);

      const stagingPath = join(cfg.stagingDir, externalConnectionId, doc.remotePath);
      mkdirSync(dirname(stagingPath), { recursive: true });
      writeFileSync(stagingPath, fileBuffer);

      // Set mtime to remote modification time so storeVersion picks it up correctly
      const mtime = remoteModified;
      utimesSync(stagingPath, mtime, mtime);

      // Create "modified" changelog entry
      await fetch(`${baseUrl}/SyncChangelog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncJobId,
          connectionId,
          tenantId,
          filePath: doc.remotePath,
          fileName: doc.fileName,
          changeType: 'modified',
          sizeBytes: fileBuffer.length,
          remoteModifiedAt: meta.modifiedAt,
          status: 'pending',
        }),
      });
    } catch (err) {
      console.error(
        `[knowledge] native picker sync failed for doc ${doc.id} (${doc.fileName}): ${err.message}`
      );
      docErrors++;
    }
  }

  inst.attributes.set('syncStatus', docErrors > 0 ? 'failed' : 'completed');
  inst.attributes.set(
    'errorMessage',
    docErrors > 0 ? `${docErrors} document(s) failed to sync` : null
  );
  inst.attributes.set('errorIncrement', docErrors > 0 ? 1 : 0);
  return inst;
}
