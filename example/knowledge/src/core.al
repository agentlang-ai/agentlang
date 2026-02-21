module knowledge.core

import "resolver.js" @as r

// --- Entities ---

entity TenantConfig {
    id UUID @id @default(uuid()),
    tenantId UUID @indexed,
    maxConnections Int @default(10),
    maxDocuments Int @default(10000),
    maxStorageBytes Int @default(10737418240),
    @rbac [(roles: [admin], allow: [create, read, update, delete])],
    @meta {"audit": true}
}

// Singleton registry for service-wide operational defaults.
// Sensitive credentials (rclone RC password, DB credentials) remain as env vars.
entity Config {
    id UUID @id @default(uuid()),
    // rclone integration
    rcloneRcUrl String @default("http://localhost:5572"),
    // File storage paths
    stagingDir String @default("~/.agentlang/studio/.knowledge_staging"),
    storeDir String @default("~/.agentlang/studio/.knowledge_store"),
    // Sync scheduler
    syncSchedulerIntervalSec Int @default(21600),
    maxConcurrentSyncsPerTenant Int @default(3),
    // Per-tenant defaults
    defaultMaxConnections Int @default(10),
    defaultMaxDocuments Int @default(10000),
    defaultMaxStorageBytes Int @default(10737418240),
    // Per-connection defaults
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

// Timer callback. Trigger syncs for ready connections.
// TODO: Re-enable stale job pruning once DSL syntax is confirmed.
@public workflow syncTick {
    {Connection {syncEnabled? true, status? "ready"}} @as readyConns;
    for conn in readyConns {
        {SyncJob {connectionId? conn.id, status? "in_progress"}}
            @empty {syncConnection {connectionId conn.id,
                                    tenantId conn.tenantId,
                                    remoteName conn.externalConnectionId,
                                    remotePath conn.remotePath}}
    }
}

// Full sync lifecycle for one connection:
// 1. Create SyncJob (in_progress)
// 2. Sync files via rclone sync/copy
// 3. Scan staging and compare against DB to build changelog:
//    - Added: file in staging but no matching KnowledgeDocument
//    - Modified: file in staging with different remoteModifiedAt
//    - Deleted: KnowledgeDocument exists but file not in staging
// 4. Process changelog entries into KnowledgeDocument/DocumentVersion
// 5. Update SyncJob with staging path, final status, and error (if any)
// 6. Bump syncErrorCount on Connection (errorIncrement is 0 on success, 1 on failure)
workflow syncConnection {
    {SyncJob {connectionId syncConnection.connectionId,
              tenantId syncConnection.tenantId,
              status "in_progress", trigger "scheduled",
              startedAt now()}} @as [job];

    // Sync the actual files first.
    {CloudFileProxy {action "sync",
                     remoteName syncConnection.remoteName,
                     remotePath syncConnection.remotePath}} @as [result];

    // Detect added files: in staging but no matching KnowledgeDocument.
    {StagingFile {remoteName? syncConnection.remoteName}} @as addedStagingFiles;
    for file in addedStagingFiles {
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

    // Detect modified files: in staging with different remoteModifiedAt.
    {StagingFile {remoteName? syncConnection.remoteName}} @as modStagingFiles;
    for file in modStagingFiles {
        {KnowledgeDocument {connectionId? syncConnection.connectionId,
                            remotePath? file.filePath,
                            isDeleted? false,
                            remoteModifiedAt?<> file.remoteModifiedAt}} @as modDocs;
        for doc in modDocs {
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

    // Detect deleted files: KnowledgeDocument exists but not in staging.
    {KnowledgeDocument {connectionId? syncConnection.connectionId,
                        isDeleted? false}} @as existingDocs;
    for doc in existingDocs {
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

    // Process changelog entries into KnowledgeDocument/DocumentVersion records.
    {processChangelog {syncJobId job.id,
                       tenantId syncConnection.tenantId,
                       connectionId syncConnection.connectionId,
                       remoteName syncConnection.remoteName}};

    // Update SyncJob and bump Connection error count.
    {SyncJob {id? job.id,
              status result.syncStatus,
              stagingPath result.stagingPath,
              errorMessage result.errorMessage,
              completedAt now()}};
    {Connection {id? syncConnection.connectionId,
                 syncErrorCount syncErrorCount + result.errorIncrement}}
}

// Process pending SyncChangelog entries into KnowledgeDocument and DocumentVersion
// records, copying files from staging into the versioned store.
workflow processChangelog {
    // --- Added files ---
    {SyncChangelog {syncJobId? processChangelog.syncJobId,
                    changeType? "added",
                    status? "pending"}} @as addedEntries;
    for entry in addedEntries {
        // Copy staging file to versioned store and get content hash.
        {VersionStore {remoteName processChangelog.remoteName,
                       filePath entry.filePath,
                       remoteModifiedAt entry.remoteModifiedAt}} @as [stored];

        // Create the KnowledgeDocument (version 1).
        {KnowledgeDocument {tenantId processChangelog.tenantId,
                            connectionId processChangelog.connectionId,
                            title entry.fileName,
                            remotePath entry.filePath,
                            fileName entry.fileName,
                            sizeBytes entry.sizeBytes,
                            currentVersion 1,
                            remoteModifiedAt entry.remoteModifiedAt,
                            lastSyncedAt now()}} @as [doc];

        // Create DocumentVersion (version 1, changeType "added").
        {DocumentVersion {tenantId processChangelog.tenantId,
                          documentId doc.id,
                          version 1,
                          sizeBytes entry.sizeBytes,
                          remoteModifiedAt entry.remoteModifiedAt,
                          syncJobId processChangelog.syncJobId,
                          changeType "added",
                          contentHash stored.contentHash}};

        // Mark changelog entry as processed.
        {SyncChangelog {id? entry.id, status "processed"}};

        // Increment SyncJob counters.
        {SyncJob {id? processChangelog.syncJobId,
                  filesAdded filesAdded + 1,
                  versionsCreated versionsCreated + 1}}
    };

    // --- Modified files ---
    {SyncChangelog {syncJobId? processChangelog.syncJobId,
                    changeType? "modified",
                    status? "pending"}} @as modifiedEntries;
    for entry in modifiedEntries {
        // Copy staging file to versioned store and get content hash.
        {VersionStore {remoteName processChangelog.remoteName,
                       filePath entry.filePath,
                       remoteModifiedAt entry.remoteModifiedAt}} @as [stored];

        // Find the existing KnowledgeDocument and bump its version.
        {KnowledgeDocument {connectionId? processChangelog.connectionId,
                            remotePath? entry.filePath,
                            isDeleted? false}} @as matchingDocs;
        for doc in matchingDocs {
            {KnowledgeDocument {id? doc.id,
                                currentVersion currentVersion + 1,
                                sizeBytes entry.sizeBytes,
                                remoteModifiedAt entry.remoteModifiedAt,
                                lastSyncedAt now()}};

            // Create DocumentVersion with bumped version number.
            {DocumentVersion {tenantId processChangelog.tenantId,
                              documentId doc.id,
                              version doc.currentVersion + 1,
                              sizeBytes entry.sizeBytes,
                              remoteModifiedAt entry.remoteModifiedAt,
                              syncJobId processChangelog.syncJobId,
                              changeType "modified",
                              contentHash stored.contentHash}}
        };

        // Mark changelog entry as processed.
        {SyncChangelog {id? entry.id, status "processed"}};

        // Increment SyncJob counters.
        {SyncJob {id? processChangelog.syncJobId,
                  filesUpdated filesUpdated + 1,
                  versionsCreated versionsCreated + 1}}
    };

    // --- Deleted files ---
    {SyncChangelog {syncJobId? processChangelog.syncJobId,
                    changeType? "deleted",
                    status? "pending"}} @as deletedEntries;
    for entry in deletedEntries {
        // Soft-delete the KnowledgeDocument.
        {KnowledgeDocument {connectionId? processChangelog.connectionId,
                            remotePath? entry.filePath,
                            isDeleted? false}} @as deleteDocs;
        for doc in deleteDocs {
            {KnowledgeDocument {id? doc.id,
                                isDeleted true,
                                lastSyncedAt now()}}
        };

        // Mark changelog entry as processed.
        {SyncChangelog {id? entry.id, status "processed"}};

        // Increment SyncJob counter.
        {SyncJob {id? processChangelog.syncJobId,
                  filesDeleted filesDeleted + 1}}
    }
}

// Public workflows to start/stop the sync scheduler timer.

@public workflow startSyncScheduler {
    {Config? {}} @as [config] @empty {Config {}};
    {agentlang/timer {
     name "sync-scheduler",
     duration config.syncSchedulerIntervalSec,
     unit "second",
     trigger "knowledge.core/syncTick"}}
}

@public workflow stopSyncScheduler {
    delete {agentlang/timer {
            name? "sync-scheduler"}}
}

// --- OAuth proxy ---
// Resolver-backed entity for OAuth consent flow operations.
// The "action" field selects the operation: auth-url, access-token, connect.
// Proxies OAuth calls to the integration-manager service.

entity OAuthProxy {
    action String,
    provider String,
    remoteName String @optional,
    redirectUri String @optional,
    code String @optional,
    state String @optional,
    authUrl String @optional,
    accessToken String @optional,
    expiresIn Int @optional,
    tokenType String @optional
}

resolver oauthResolver [knowledge.core/OAuthProxy] {
    query r.queryOAuth,
    create r.createOAuthOp
}

// --- rclone RC API proxy ---
// Resolver-backed entity for cloud file operations via rclone's RC API.
// The "action" field selects the operation: list, stat, sync, copyfile, health.
// The "remoteName" maps to an rclone remote configured via config/create.

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
    query r.queryCloudFiles,
    create r.createCloudFileOp
}

// --- Staging file scanner ---
// Resolver-backed entity for scanning local staging after sync.
// Returns one entry per file in the staging directory.

entity StagingFile {
    remoteName String,
    filePath String,
    fileName String,
    sizeBytes Int,
    remoteModifiedAt DateTime
}

resolver stagingFileResolver [knowledge.core/StagingFile] {
    query r.scanStagingFiles
}

// --- Version store ---
// Resolver-backed entity for copying a staging file into the immutable
// versioned store and computing its content hash.

entity VersionStore {
    remoteName String,
    filePath String,
    remoteModifiedAt String,
    storagePath String @optional,
    contentHash String @optional
}

resolver versionStoreResolver [knowledge.core/VersionStore] {
    create r.storeVersion
}
