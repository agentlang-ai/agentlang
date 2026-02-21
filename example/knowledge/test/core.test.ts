import { describe, test, beforeEach, afterEach } from 'vitest';
import { testModule, is, TestModuleProxy } from '../../../src/test-harness.js';
import { doInternModule } from '../../../test/util.js';

// ─── Module body ─────────────────────────────────────────────────────────────
// Identical to core.al except:
// - No `import "resolver.js" @as r`
// - Resolver method refs use bare globalThis function names (resolved via eval)
// - startSyncScheduler / stopSyncScheduler omitted (depend on agentlang/timer)
// - `for conn in {Connection {}}` → `for conn in {Connection? {}}` (explicit query-all)

const MODULE_BODY = `
entity TenantConfig {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    maxConnections Int @default(10),
    maxDocuments Int @default(10000),
    maxStorageBytes Int @default(10737418240),
    @rbac [(roles: [admin], allow: [create, read, update, delete])],
    @meta {"audit": true}
}

entity Config {
    id UUID @id @default(uuid()),
    rcloneRcUrl String @default("http://localhost:5572"),
    stagingDir String @default("~/.agentlang/studio/.knowledge_staging"),
    storeDir String @default("~/.agentlang/studio/.knowledge_store"),
    syncSchedulerIntervalSec Int @default(21600),
    maxConcurrentSyncsPerTenant Int @default(3),
    defaultMaxConnections Int @default(10),
    defaultMaxDocuments Int @default(10000),
    defaultMaxStorageBytes Int @default(10737418240),
    defaultSyncIntervalMin Int @default(60),
    defaultSyncTimeoutMin Int @default(30),
    defaultRetentionPolicy @enum("all", "count", "age") @default("all"),
    @rbac [(roles: [admin], allow: [create, read, update])]
}

entity Connection {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    name String,
    provider @enum("onedrive", "dropbox", "box", "google_drive"),
    remotePath String,
    scope @enum("org", "user"),
    syncIntervalMin Int @default(60),
    syncEnabled Boolean @default(true),
    retentionPolicy @enum("all", "count", "age") @default("all"),
    retentionValue Int @default(0),
    status @enum("awaiting_auth", "ready", "auth_revoked", "error"),
    externalConnectionId String,
    syncTimeoutMin Int @default(30),
    syncErrorCount Int @default(0),
    createdBy UUID,
    createdAt DateTime @default(now()),
    updatedAt DateTime @default(now()),
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read]),
        (allow: [read, update], where: auth.user = this.createdBy)
    ],
    @meta {"audit": true}
}

entity KnowledgeDocument {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    connectionId UUID @indexed,
    title String,
    remotePath String,
    fileName String,
    fileType @enum("pdf", "markdown", "text", "docx", "html", "unknown") @default("unknown"),
    sizeBytes Int,
    currentVersion Int @default(1),
    isDeleted Boolean @default(false),
    remoteCreatedAt DateTime @optional,
    remoteCreatedBy String @optional,
    remoteModifiedAt DateTime @optional,
    remoteModifiedBy String @optional,
    lastSyncedAt DateTime,
    createdAt DateTime @default(now()),
    updatedAt DateTime @default(now()),
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read])
    ],
    @meta {"audit": true}
}

entity DocumentVersion {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    documentId UUID @indexed,
    version Int,
    sizeBytes Int,
    remoteModifiedAt DateTime,
    syncedAt DateTime @default(now()),
    syncJobId UUID,
    changeType @enum("added", "modified"),
    contentHash String,
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read])
    ],
    @with_unique(documentId, version)
}

entity VersionLock {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    documentVersionId UUID @indexed,
    consumerId String,
    lockedAt DateTime @default(now()),
    releasedAt DateTime @optional,
    @rbac [
        (roles: [admin], allow: [create, read, update, delete]),
        (roles: [member], allow: [create, read, update])
    ]
}

entity SyncJob {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    connectionId UUID @indexed,
    status @enum("pending", "in_progress", "completed", "failed"),
    trigger @enum("scheduled", "manual"),
    stagingPath String @optional,
    startedAt DateTime,
    completedAt DateTime @optional,
    filesAdded Int @default(0),
    filesUpdated Int @default(0),
    filesDeleted Int @default(0),
    versionsCreated Int @default(0),
    versionsCleaned Int @default(0),
    errorMessage String @optional,
    @rbac [
        (roles: [admin], allow: [create, read, update, delete]),
        (roles: [member], allow: [read])
    ]
}

entity SyncChangelog {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    syncJobId UUID @indexed,
    connectionId UUID @indexed,
    filePath String,
    fileName String,
    changeType @enum("added", "modified", "deleted"),
    sizeBytes Int @optional,
    contentHash String @optional,
    remoteCreatedAt DateTime @optional,
    remoteCreatedBy String @optional,
    remoteModifiedAt DateTime @optional,
    remoteModifiedBy String @optional,
    status @enum("pending", "processed", "failed") @default("pending"),
    @rbac [
        (roles: [admin], allow: [create, read, update, delete]),
        (roles: [member], allow: [read])
    ]
}

entity Topic {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    name String,
    description String @optional,
    type @enum("manual", "auto") @default("manual"),
    curatedBy String @optional,
    documentCount Int @default(0),
    createdBy UUID,
    createdAt DateTime @default(now()),
    updatedAt DateTime @default(now()),
    @rbac [
        (roles: [admin], allow: [create, update, delete]),
        (roles: [member], allow: [read, create]),
        (allow: [update, delete], where: auth.user = this.createdBy)
    ],
    @meta {"audit": true}
}

entity TopicDocument {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    topicId UUID @indexed,
    documentId UUID @indexed,
    addedBy UUID,
    addedAt DateTime @default(now()),
    @rbac [
        (roles: [admin], allow: [create, read, delete]),
        (roles: [member], allow: [create, read, delete])
    ],
    @with_unique(topicId, documentId)
}

// --- Relationships ---

relationship ConnectionDocument contains(Connection, KnowledgeDocument)

relationship DocumentVersionHistory contains(KnowledgeDocument, DocumentVersion)

relationship VersionLockHistory contains(DocumentVersion, VersionLock)

relationship ConnectionSyncJobs contains(Connection, SyncJob)

relationship SyncJobChangelog contains(SyncJob, SyncChangelog)

relationship TopicDocumentLink between(Topic, KnowledgeDocument)

// --- Sync scheduler ---

// Test version: accepts cutoffTime parameter instead of computing now() - duration
// (the date arithmetic in the original uses now() which returns a DateTime string
// incompatible with numeric subtraction in the SQLite test environment).
workflow syncTick {
    for conn in {Connection? {}} {
        for staleJob in {SyncJob {connectionId? conn.id,
                                  status? "in_progress",
                                  startedAt?< syncTick.cutoffTime}} {
            {SyncJob {id? staleJob.id, status "failed",
                      errorMessage "timed out", completedAt now()}};
            {Connection {id? conn.id, syncErrorCount syncErrorCount + 1}}
        }
    };

    for conn in {Connection {syncEnabled? true, status? "ready"}} {
        {SyncJob {connectionId? conn.id, status? "in_progress"}}
            @empty {syncConnection {connectionId conn.id,
                                    tenantId conn.tenantId,
                                    remoteName conn.externalConnectionId,
                                    remotePath conn.remotePath}}
    }
}

workflow syncConnection {
    {SyncJob {connectionId syncConnection.connectionId,
              tenantId syncConnection.tenantId,
              status "in_progress", trigger "scheduled",
              startedAt now()}} @as [job];

    {CloudFileProxy {action "sync",
                     remoteName syncConnection.remoteName,
                     remotePath syncConnection.remotePath}} @as [result];

    for file in {StagingFile {remoteName? syncConnection.remoteName}} {
        {KnowledgeDocument {connectionId? syncConnection.connectionId,
                            remotePath? file.filePath,
                            isDeleted? false}}
            @empty {SyncChangelog {syncJobId job.id,
                                   connectionId syncConnection.connectionId,
                                   tenantId syncConnection.tenantId,
                                   filePath file.filePath,
                                   fileName file.fileName,
                                   changeType "added",
                                   sizeBytes file.sizeBytes,
                                   remoteModifiedAt file.remoteModifiedAt,
                                   status "pending"}}
    };

    for file in {StagingFile {remoteName? syncConnection.remoteName}} {
        for doc in {KnowledgeDocument {connectionId? syncConnection.connectionId,
                                       remotePath? file.filePath,
                                       isDeleted? false,
                                       remoteModifiedAt?<> file.remoteModifiedAt}} {
            {SyncChangelog {syncJobId job.id,
                            connectionId syncConnection.connectionId,
                            tenantId syncConnection.tenantId,
                            filePath file.filePath,
                            fileName file.fileName,
                            changeType "modified",
                            sizeBytes file.sizeBytes,
                            remoteModifiedAt file.remoteModifiedAt,
                            status "pending"}}
        }
    };

    for doc in {KnowledgeDocument {connectionId? syncConnection.connectionId,
                                    isDeleted? false}} {
        {StagingFile {remoteName? syncConnection.remoteName,
                      filePath? doc.remotePath}}
            @empty {SyncChangelog {syncJobId job.id,
                                   connectionId syncConnection.connectionId,
                                   tenantId syncConnection.tenantId,
                                   filePath doc.remotePath,
                                   fileName doc.fileName,
                                   changeType "deleted",
                                   status "pending"}}
    };

    {processChangelog {syncJobId job.id,
                       tenantId syncConnection.tenantId,
                       connectionId syncConnection.connectionId,
                       remoteName syncConnection.remoteName}};

    {SyncJob {id? job.id,
              status result.syncStatus,
              stagingPath result.stagingPath,
              errorMessage result.errorMessage,
              completedAt now()}};
    {Connection {id? syncConnection.connectionId,
                 syncErrorCount syncErrorCount + result.errorIncrement}}
}

workflow processChangelog {
    for entry in {SyncChangelog {syncJobId? processChangelog.syncJobId,
                                 changeType? "added",
                                 status? "pending"}} {
        {VersionStore {remoteName processChangelog.remoteName,
                       filePath entry.filePath,
                       remoteModifiedAt entry.remoteModifiedAt}} @as [stored];

        {KnowledgeDocument {tenantId processChangelog.tenantId,
                            connectionId processChangelog.connectionId,
                            title entry.fileName,
                            remotePath entry.filePath,
                            fileName entry.fileName,
                            sizeBytes entry.sizeBytes,
                            currentVersion 1,
                            remoteModifiedAt entry.remoteModifiedAt,
                            lastSyncedAt now()}} @as [doc];

        {DocumentVersion {tenantId processChangelog.tenantId,
                          documentId doc.id,
                          version 1,
                          sizeBytes entry.sizeBytes,
                          remoteModifiedAt entry.remoteModifiedAt,
                          syncJobId processChangelog.syncJobId,
                          changeType "added",
                          contentHash stored.contentHash}};

        {SyncChangelog {id? entry.id, status "processed"}};

        {SyncJob {id? processChangelog.syncJobId,
                  filesAdded filesAdded + 1,
                  versionsCreated versionsCreated + 1}}
    };

    for entry in {SyncChangelog {syncJobId? processChangelog.syncJobId,
                                 changeType? "modified",
                                 status? "pending"}} {
        {VersionStore {remoteName processChangelog.remoteName,
                       filePath entry.filePath,
                       remoteModifiedAt entry.remoteModifiedAt}} @as [stored];

        for doc in {KnowledgeDocument {connectionId? processChangelog.connectionId,
                                       remotePath? entry.filePath,
                                       isDeleted? false}} {
            {KnowledgeDocument {id? doc.id,
                                currentVersion currentVersion + 1,
                                sizeBytes entry.sizeBytes,
                                remoteModifiedAt entry.remoteModifiedAt,
                                lastSyncedAt now()}};

            {DocumentVersion {tenantId processChangelog.tenantId,
                              documentId doc.id,
                              version doc.currentVersion + 1,
                              sizeBytes entry.sizeBytes,
                              remoteModifiedAt entry.remoteModifiedAt,
                              syncJobId processChangelog.syncJobId,
                              changeType "modified",
                              contentHash stored.contentHash}}
        };

        {SyncChangelog {id? entry.id, status "processed"}};

        {SyncJob {id? processChangelog.syncJobId,
                  filesUpdated filesUpdated + 1,
                  versionsCreated versionsCreated + 1}}
    };

    for entry in {SyncChangelog {syncJobId? processChangelog.syncJobId,
                                 changeType? "deleted",
                                 status? "pending"}} {
        for doc in {KnowledgeDocument {connectionId? processChangelog.connectionId,
                                       remotePath? entry.filePath,
                                       isDeleted? false}} {
            {KnowledgeDocument {id? doc.id,
                                isDeleted true,
                                lastSyncedAt now()}}
        };

        {SyncChangelog {id? entry.id, status "processed"}};

        {SyncJob {id? processChangelog.syncJobId,
                  filesDeleted filesDeleted + 1}}
    }
}

// --- rclone RC API proxy ---

entity CloudFileProxy {
    action String,
    remoteName String,
    remotePath String,
    dstPath String @optional,
    providerType String @optional,
    providerConfig String @optional,
    stagingPath String @optional,
    syncStatus String @optional,
    errorMessage String @optional,
    errorIncrement Int @optional
}

resolver cloudFileResolver [knowledge.core/CloudFileProxy] {
    query mockQueryCloudFiles,
    create mockCreateCloudFileOp
}

entity StagingFile {
    remoteName String,
    filePath String,
    fileName String,
    sizeBytes Int,
    remoteModifiedAt DateTime
}

resolver stagingFileResolver [knowledge.core/StagingFile] {
    query mockScanStagingFiles
}

entity VersionStore {
    remoteName String,
    filePath String,
    remoteModifiedAt String,
    storagePath String @optional,
    contentHash String @optional
}

resolver versionStoreResolver [knowledge.core/VersionStore] {
    create mockStoreVersion
}
`;

// ─── Mock resolver state ─────────────────────────────────────────────────────

interface FileEntry {
  remoteName: string;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  remoteModifiedAt: string;
}

let syncResult: {
  syncStatus: string;
  errorIncrement: number;
  stagingPath: string;
  errorMessage?: string;
};
let stagingFiles: Record<string, FileEntry[]>;

function resetMockState() {
  syncResult = {
    syncStatus: 'completed',
    errorIncrement: 0,
    stagingPath: '/tmp/staging/remote',
  };
  stagingFiles = {};
}

function installMockResolvers() {
  (globalThis as any).mockCreateCloudFileOp = async function (_ctx: any, inst: any) {
    inst.attributes.set('stagingPath', syncResult.stagingPath);
    inst.attributes.set('syncStatus', syncResult.syncStatus);
    inst.attributes.set('errorIncrement', syncResult.errorIncrement);
    if (syncResult.errorMessage) {
      inst.attributes.set('errorMessage', syncResult.errorMessage);
    }
    return inst;
  };

  (globalThis as any).mockScanStagingFiles = async function (_ctx: any, inst: any) {
    const remoteName = inst.getQueryValue('remoteName');
    const filePathFilter = inst.getQueryValue('filePath');
    let files = stagingFiles[remoteName] || [];
    if (filePathFilter) {
      files = files.filter((f: FileEntry) => f.filePath === filePathFilter);
    }
    return files;
  };

  (globalThis as any).mockStoreVersion = async function (_ctx: any, inst: any) {
    inst.attributes.set(
      'storagePath',
      `/store/${inst.lookup('remoteName')}/${inst.lookup('filePath')}`
    );
    inst.attributes.set('contentHash', 'mock-hash-abc123');
    return inst;
  };

  (globalThis as any).mockQueryCloudFiles = async function () {
    return [];
  };
}

function cleanupMockResolvers() {
  delete (globalThis as any).mockCreateCloudFileOp;
  delete (globalThis as any).mockScanStagingFiles;
  delete (globalThis as any).mockStoreVersion;
  delete (globalThis as any).mockQueryCloudFiles;
}

// ─── Test helpers ────────────────────────────────────────────────────────────

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CREATED_BY = '00000000-0000-0000-0000-000000000099';

async function createTestConnection(m: TestModuleProxy, overrides: Record<string, any> = {}) {
  return await m.create_Connection({
    tenantId: TENANT_ID,
    name: 'Test Connection',
    provider: 'dropbox',
    remotePath: '/',
    scope: 'org',
    status: 'ready',
    externalConnectionId: 'testremote',
    createdBy: CREATED_BY,
    ...overrides,
  });
}

async function createTestSyncJob(
  m: TestModuleProxy,
  connectionId: string,
  overrides: Record<string, any> = {}
) {
  return await m.create_SyncJob({
    connectionId,
    tenantId: TENANT_ID,
    status: 'in_progress',
    trigger: 'scheduled',
    startedAt: new Date().toISOString(),
    ...overrides,
  });
}

async function createTestDocument(
  m: TestModuleProxy,
  connectionId: string,
  overrides: Record<string, any> = {}
) {
  return await m.create_KnowledgeDocument({
    tenantId: TENANT_ID,
    connectionId,
    title: 'test.pdf',
    remotePath: 'test.pdf',
    fileName: 'test.pdf',
    sizeBytes: 1024,
    lastSyncedAt: new Date().toISOString(),
    ...overrides,
  });
}

// ─── Entity CRUD ─────────────────────────────────────────────────────────────

describe('Entity CRUD', () => {
  let m: TestModuleProxy;

  beforeEach(async () => {
    resetMockState();
    installMockResolvers();
    m = await testModule('knowledge.core', MODULE_BODY, doInternModule);
  });

  afterEach(() => {
    cleanupMockResolvers();
  });

  test('Config: create with defaults, query back, update fields', async () => {
    const config = await m.create_Config({
      rcloneRcUrl: 'http://localhost:5572',
    });
    is(config.rcloneRcUrl == 'http://localhost:5572');
    is(config.syncSchedulerIntervalSec == 21600);
    is(config.defaultRetentionPolicy == 'all');

    const configs = await m.get_Config({ id: config.id });
    is(configs.length == 1);
    is(configs[0].rcloneRcUrl == 'http://localhost:5572');

    await m.update_Config({
      id: config.id,
      rcloneRcUrl: 'http://custom:9999',
    });
    const updated = await m.get_Config({ id: config.id });
    is(updated[0].rcloneRcUrl == 'http://custom:9999');
  });

  test('Connection: create with required fields and verify defaults', async () => {
    const conn = await createTestConnection(m);
    is(conn.syncEnabled == true);
    is(conn.syncErrorCount == 0);
    is(conn.syncTimeoutMin == 30);
    is(conn.retentionPolicy == 'all');

    await m.update_Connection({
      id: conn.id,
      syncErrorCount: 5,
    });
    const updated = await m.get_Connection({ id: conn.id });
    is(updated[0].syncErrorCount == 5);
  });

  test('KnowledgeDocument: create with defaults', async () => {
    const conn = await createTestConnection(m);
    const doc = await createTestDocument(m, conn.id);
    is(doc.currentVersion == 1);
    is(doc.isDeleted == false);
    is(doc.fileType == 'unknown');
  });
});

// ─── Relationships ───────────────────────────────────────────────────────────

describe('Relationships', () => {
  let m: TestModuleProxy;

  beforeEach(async () => {
    resetMockState();
    installMockResolvers();
    m = await testModule('knowledge.core', MODULE_BODY, doInternModule);
  });

  afterEach(() => {
    cleanupMockResolvers();
  });

  test('ConnectionDocument contains: documents linked to connection via connectionId', async () => {
    const conn = await createTestConnection(m);

    // Create documents under the connection
    await createTestDocument(m, conn.id, {
      title: 'report.pdf',
      remotePath: 'reports/report.pdf',
      fileName: 'report.pdf',
      sizeBytes: 2048,
    });
    await createTestDocument(m, conn.id, {
      title: 'notes.md',
      remotePath: 'notes.md',
      fileName: 'notes.md',
      sizeBytes: 512,
    });

    // Query documents by connectionId
    const docs = await m.get_KnowledgeDocument({ connectionId: conn.id });
    is(docs.length == 2);
    const titles = docs.map((d: any) => d.title).sort();
    is(titles[0] == 'notes.md');
    is(titles[1] == 'report.pdf');
  });

  test('TopicDocumentLink between: link topic to document via TopicDocument', async () => {
    const conn = await createTestConnection(m);
    const doc = await createTestDocument(m, conn.id);
    const topic = await m.create_Topic({
      tenantId: TENANT_ID,
      name: 'Engineering',
      createdBy: CREATED_BY,
    });

    // Create the link record
    const link = await m.create_TopicDocument({
      tenantId: TENANT_ID,
      topicId: topic.id,
      documentId: doc.id,
      addedBy: CREATED_BY,
    });
    is(link.topicId == topic.id);
    is(link.documentId == doc.id);

    // Query link records back
    const links = await m.get_TopicDocument({ topicId: topic.id });
    is(links.length == 1);
    is(links[0].documentId == doc.id);
  });
});

// ─── processChangelog workflow ────────────────────────────────────────────────

describe('processChangelog workflow', () => {
  let m: TestModuleProxy;

  beforeEach(async () => {
    resetMockState();
    installMockResolvers();
    m = await testModule('knowledge.core', MODULE_BODY, doInternModule);
  });

  afterEach(() => {
    cleanupMockResolvers();
  });

  test('processes added entries: creates KnowledgeDocument and DocumentVersion', async () => {
    const conn = await createTestConnection(m);
    const job = await createTestSyncJob(m, conn.id);
    const modifiedAt = '2024-06-15T12:00:00.000Z';

    await m.create_SyncChangelog({
      tenantId: TENANT_ID,
      syncJobId: job.id,
      connectionId: conn.id,
      filePath: 'new-file.pdf',
      fileName: 'new-file.pdf',
      changeType: 'added',
      sizeBytes: 5000,
      remoteModifiedAt: modifiedAt,
      status: 'pending',
    });

    await m.processChangelog({
      syncJobId: job.id,
      tenantId: TENANT_ID,
      connectionId: conn.id,
      remoteName: 'testremote',
    });

    // Verify KnowledgeDocument was created
    const docs = await m.get_KnowledgeDocument({ connectionId: conn.id });
    is(docs.length == 1);
    is(docs[0].currentVersion == 1);
    is(docs[0].remotePath == 'new-file.pdf');
    is(docs[0].fileName == 'new-file.pdf');

    // Verify DocumentVersion was created
    const versions = await m.get_DocumentVersion({ documentId: docs[0].id });
    is(versions.length == 1);
    is(versions[0].version == 1);
    is(versions[0].changeType == 'added');
    is(versions[0].contentHash == 'mock-hash-abc123');

    // Verify SyncChangelog marked as processed
    const changelogs = await m.get_SyncChangelog({ syncJobId: job.id });
    is(changelogs.length == 1);
    is(changelogs[0].status == 'processed');

    // Verify SyncJob counters incremented
    const jobs = await m.get_SyncJob({ id: job.id });
    is(jobs[0].filesAdded == 1);
    is(jobs[0].versionsCreated == 1);
  });

  test('processes modified entries: bumps document version', async () => {
    const conn = await createTestConnection(m);
    const oldModifiedAt = '2024-01-01T00:00:00.000Z';
    const newModifiedAt = '2024-06-15T12:00:00.000Z';

    // Pre-create existing document at version 1
    const doc = await createTestDocument(m, conn.id, {
      remotePath: 'existing.pdf',
      fileName: 'existing.pdf',
      currentVersion: 1,
      remoteModifiedAt: oldModifiedAt,
    });

    const job = await createTestSyncJob(m, conn.id);

    await m.create_SyncChangelog({
      tenantId: TENANT_ID,
      syncJobId: job.id,
      connectionId: conn.id,
      filePath: 'existing.pdf',
      fileName: 'existing.pdf',
      changeType: 'modified',
      sizeBytes: 6000,
      remoteModifiedAt: newModifiedAt,
      status: 'pending',
    });

    await m.processChangelog({
      syncJobId: job.id,
      tenantId: TENANT_ID,
      connectionId: conn.id,
      remoteName: 'testremote',
    });

    // Verify KnowledgeDocument version was bumped
    const docs = await m.get_KnowledgeDocument({ id: doc.id });
    is(docs[0].currentVersion == 2);

    // Verify new DocumentVersion was created
    const versions = await m.get_DocumentVersion({ documentId: doc.id });
    is(versions.length == 1);
    is(versions[0].version == 2);
    is(versions[0].changeType == 'modified');

    // Verify SyncJob counters
    const jobs = await m.get_SyncJob({ id: job.id });
    is(jobs[0].filesUpdated == 1);
    is(jobs[0].versionsCreated == 1);
  });

  test('processes deleted entries: soft-deletes KnowledgeDocument', async () => {
    const conn = await createTestConnection(m);
    const doc = await createTestDocument(m, conn.id, {
      remotePath: 'deleted.pdf',
      fileName: 'deleted.pdf',
      isDeleted: false,
    });

    const job = await createTestSyncJob(m, conn.id);

    await m.create_SyncChangelog({
      tenantId: TENANT_ID,
      syncJobId: job.id,
      connectionId: conn.id,
      filePath: 'deleted.pdf',
      fileName: 'deleted.pdf',
      changeType: 'deleted',
      status: 'pending',
    });

    await m.processChangelog({
      syncJobId: job.id,
      tenantId: TENANT_ID,
      connectionId: conn.id,
      remoteName: 'testremote',
    });

    // Verify KnowledgeDocument is soft-deleted
    const docs = await m.get_KnowledgeDocument({ id: doc.id });
    is(docs[0].isDeleted == true);

    // Verify SyncJob counter
    const jobs = await m.get_SyncJob({ id: job.id });
    is(jobs[0].filesDeleted == 1);
  });
});

// ─── syncTick workflow ───────────────────────────────────────────────────────

describe('syncTick workflow', () => {
  let m: TestModuleProxy;

  beforeEach(async () => {
    resetMockState();
    installMockResolvers();
    m = await testModule('knowledge.core', MODULE_BODY, doInternModule);
  });

  afterEach(() => {
    cleanupMockResolvers();
  });

  test('prunes stale in_progress jobs: marks failed and bumps syncErrorCount', async () => {
    // Use status='error' so syncTick Step 2 won't trigger syncConnection for this connection
    const conn = await createTestConnection(m, { syncTimeoutMin: 30, status: 'error' });
    const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await createTestSyncJob(m, conn.id, {
      status: 'in_progress',
      startedAt: sixtyMinAgo,
    });

    // cutoffTime: anything after the stale job's startedAt should match
    const cutoffTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await m.syncTick({ cutoffTime });

    // Verify stale job was marked failed
    const jobs = await m.get_SyncJob({ connectionId: conn.id });
    is(jobs.length >= 1);
    const staleJob = jobs.find((j: any) => j.errorMessage == 'timed out');
    is(staleJob !== undefined);
    is(staleJob.status == 'failed');

    // Verify Connection syncErrorCount was incremented
    const conns = await m.get_Connection({ id: conn.id });
    is(conns[0].syncErrorCount == 1);
  });

  test('triggers sync for ready connections with no in_progress job', async () => {
    // Set empty staging files so sync completes quickly with no changelog
    stagingFiles = {};
    const conn = await createTestConnection(m, {
      syncEnabled: true,
      status: 'ready',
      externalConnectionId: 'testremote',
      remotePath: '/',
    });

    // cutoffTime far in the past — no jobs will be stale
    const cutoffTime = new Date(0).toISOString();
    await m.syncTick({ cutoffTime });

    // syncTick should have triggered syncConnection, which creates a SyncJob
    const jobs = await m.get_SyncJob({ connectionId: conn.id });
    is(jobs.length >= 1);
  });

  test('skips disabled connections: no new SyncJob created', async () => {
    const conn = await createTestConnection(m, { syncEnabled: false, status: 'ready' });

    const cutoffTime = new Date(0).toISOString();
    await m.syncTick({ cutoffTime });

    const jobs = await m.get_SyncJob({ connectionId: conn.id });
    is(jobs.length == 0);
  });

  test('skips connection when in_progress job already exists', async () => {
    const conn = await createTestConnection(m, { syncEnabled: true, status: 'ready' });
    // Create a recent in_progress job (not stale)
    await createTestSyncJob(m, conn.id, {
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    });

    // cutoffTime far in the past — the recent job won't be pruned
    const cutoffTime = new Date(0).toISOString();
    await m.syncTick({ cutoffTime });

    // Should still have only the original job — no new one triggered
    const jobs = await m.get_SyncJob({ connectionId: conn.id });
    is(jobs.length == 1);
  });
});

// ─── syncConnection workflow ─────────────────────────────────────────────────

describe('syncConnection workflow', () => {
  let m: TestModuleProxy;

  beforeEach(async () => {
    resetMockState();
    installMockResolvers();
    m = await testModule('knowledge.core', MODULE_BODY, doInternModule);
  });

  afterEach(() => {
    cleanupMockResolvers();
  });

  test('happy path: creates SyncJob, detects added file, processes changelog', async () => {
    const conn = await createTestConnection(m);
    const modifiedAt = '2024-06-15T12:00:00.000Z';

    stagingFiles['testremote'] = [
      {
        remoteName: 'testremote',
        filePath: 'report.pdf',
        fileName: 'report.pdf',
        sizeBytes: 8000,
        remoteModifiedAt: modifiedAt,
      },
    ];

    await m.syncConnection({
      connectionId: conn.id,
      tenantId: TENANT_ID,
      remoteName: 'testremote',
      remotePath: '/',
    });

    // Verify SyncJob was created and completed
    const jobs = await m.get_SyncJob({ connectionId: conn.id });
    is(jobs.length >= 1);
    const completedJob = jobs.find((j: any) => j.status == 'completed');
    is(completedJob !== undefined);

    // Verify KnowledgeDocument was created
    const docs = await m.get_KnowledgeDocument({ connectionId: conn.id });
    is(docs.length == 1);
    is(docs[0].remotePath == 'report.pdf');
    is(docs[0].currentVersion == 1);

    // Verify DocumentVersion
    const versions = await m.get_DocumentVersion({ documentId: docs[0].id });
    is(versions.length == 1);
    is(versions[0].changeType == 'added');
  });

  test('detects modified files: creates modified changelog entry', async () => {
    const conn = await createTestConnection(m);
    const oldModifiedAt = '2024-01-01T00:00:00.000Z';
    const newModifiedAt = '2024-06-15T12:00:00.000Z';

    // Pre-existing document with old modification time
    await createTestDocument(m, conn.id, {
      remotePath: 'updated.pdf',
      fileName: 'updated.pdf',
      remoteModifiedAt: oldModifiedAt,
    });

    stagingFiles['testremote'] = [
      {
        remoteName: 'testremote',
        filePath: 'updated.pdf',
        fileName: 'updated.pdf',
        sizeBytes: 9000,
        remoteModifiedAt: newModifiedAt,
      },
    ];

    await m.syncConnection({
      connectionId: conn.id,
      tenantId: TENANT_ID,
      remoteName: 'testremote',
      remotePath: '/',
    });

    // Verify document version was bumped
    const docs = await m.get_KnowledgeDocument({
      connectionId: conn.id,
      remotePath: 'updated.pdf',
    });
    is(docs.length >= 1);
    is(docs[0].currentVersion == 2);
  });

  test('detects deleted files: creates deleted changelog entry', async () => {
    const conn = await createTestConnection(m);

    // Pre-existing document — but staging will be empty
    await createTestDocument(m, conn.id, {
      remotePath: 'removed.pdf',
      fileName: 'removed.pdf',
    });

    stagingFiles['testremote'] = []; // file gone from staging

    await m.syncConnection({
      connectionId: conn.id,
      tenantId: TENANT_ID,
      remoteName: 'testremote',
      remotePath: '/',
    });

    // Verify document was soft-deleted
    const docs = await m.get_KnowledgeDocument({ connectionId: conn.id });
    is(docs.length >= 1);
    const removed = docs.find((d: any) => d.remotePath == 'removed.pdf');
    is(removed !== undefined);
    is(removed.isDeleted == true);
  });

  test('sync failure: SyncJob marked failed and Connection syncErrorCount incremented', async () => {
    const conn = await createTestConnection(m, { syncErrorCount: 0 });
    stagingFiles = {};

    syncResult = {
      syncStatus: 'failed',
      errorIncrement: 1,
      stagingPath: '/tmp/staging/testremote',
      errorMessage: 'rclone sync/copy failed (503): unavailable',
    };

    await m.syncConnection({
      connectionId: conn.id,
      tenantId: TENANT_ID,
      remoteName: 'testremote',
      remotePath: '/',
    });

    // Verify SyncJob is failed
    const jobs = await m.get_SyncJob({ connectionId: conn.id });
    is(jobs.length >= 1);
    const failedJob = jobs.find((j: any) => j.status == 'failed');
    is(failedJob !== undefined);

    // Verify Connection syncErrorCount was bumped
    const conns = await m.get_Connection({ id: conn.id });
    is(conns[0].syncErrorCount == 1);
  });
});
