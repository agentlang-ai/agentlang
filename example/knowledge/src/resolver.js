// Resolver for cloud file operations via rclone's RC API.
// rclone must be running in daemon mode (rclone rcd) with RC enabled.
//
// Start rclone daemon:
//   rclone rcd --rc-addr :5572 --rc-user $RCLONE_RC_USER --rc-pass $RCLONE_RC_PASS

import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
