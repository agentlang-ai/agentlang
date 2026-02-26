import 'reflect-metadata';
import {
  DataSource,
  EntityManager,
  EntitySchema,
  QueryRunner,
  SelectQueryBuilder,
  TableForeignKey,
} from 'typeorm';
import { logger } from '../../logger.js';
import {
  asTableReference,
  DefaultVectorDimension,
  modulesAsOrmSchema,
  OwnersSuffix,
  VectorSuffix,
} from './dbutil.js';
import { DefaultAuthInfo, ResolverAuthInfo } from '../authinfo.js';
import { canUserCreate, canUserDelete, canUserRead, canUserUpdate } from '../../modules/auth.js';
import { Environment, GlobalEnvironment } from '../../interpreter.js';
import {
  Instance,
  InstanceAttributes,
  newInstanceAttributes,
  RbacPermissionFlag,
  RbacSpecification,
  Relationship,
  setAllMetaAttributes,
} from '../../module.js';
import { isString } from '../../util.js';
import {
  DeletedFlagAttributeName,
  ForceReadPermFlag,
  getUserTenantId,
  isRuntimeMode_dev,
  isRuntimeMode_generate_migration,
  isRuntimeMode_init_schema,
  isRuntimeMode_migration,
  isRuntimeMode_test,
  isRuntimeMode_undo_migration,
  PathAttributeName,
  TenantAttributeName,
  UnauthorisedError,
} from '../../defs.js';
import { saveMigration } from '../../modules/core.js';
import { getAppSpec } from '../../loader.js';
import { WhereClause } from '../interface.js';
import { AppConfig } from '../../state.js';
import { createLanceDBStore } from '../vector/lancedb-store.js';
import type { VectorStore } from '../vector/types.js';

export let defaultDataSource: DataSource | undefined;

// Detect browser environment
function isBrowser(): boolean {
  // window for DOM pages, self+importScripts for web workers
  return (
    (typeof window !== 'undefined' && typeof (window as any).document !== 'undefined') ||
    (typeof self !== 'undefined' && typeof (self as any).importScripts === 'function')
  );
}

// LanceDB vector store cache - keyed by module name
const lanceDBStores: Map<string, VectorStore> = new Map();

export class DbContext {
  txnId: string | undefined;
  authInfo: ResolverAuthInfo;
  private inKernelMode: boolean = false;
  resourceFqName: string;
  activeEnv: Environment;
  private needAuthCheckFlag: boolean = true;
  rbacRules: RbacSpecification[] | undefined;
  tenantId: string | undefined;

  constructor(
    resourceFqName: string,
    authInfo: ResolverAuthInfo,
    activeEnv: Environment,
    txnId?: string,
    inKernelMode?: boolean,
    rbacRules?: RbacSpecification[]
  ) {
    this.resourceFqName = resourceFqName;
    this.authInfo = authInfo;
    this.activeEnv = activeEnv;
    this.txnId = txnId;
    if (inKernelMode !== undefined) {
      this.inKernelMode = inKernelMode;
    }
    this.rbacRules = rbacRules;
  }
  private static GlobalDbContext: DbContext | undefined;

  static getGlobalContext(): DbContext {
    if (DbContext.GlobalDbContext === undefined) {
      DbContext.GlobalDbContext = new DbContext(
        '',
        DefaultAuthInfo,
        GlobalEnvironment,
        undefined,
        true
      );
    }
    return DbContext.GlobalDbContext;
  }

  // Shallow clone
  clone(): DbContext {
    return new DbContext(
      this.resourceFqName,
      this.authInfo,
      this.activeEnv,
      this.txnId,
      this.inKernelMode
    );
  }

  async getTenantId(): Promise<string> {
    if (this.tenantId === undefined) {
      this.tenantId = await getUserTenantId(this.authInfo.userId, this.activeEnv);
    }
    return this.tenantId;
  }

  getUserId(): string {
    return this.authInfo.userId;
  }

  isForDelete(): boolean {
    return this.authInfo.readForDelete;
  }

  isForUpdate(): boolean {
    return this.authInfo.readForUpdate;
  }

  setResourceFqNameFrom(inst: Instance): DbContext {
    this.resourceFqName = inst.getFqName();
    return this;
  }

  setNeedAuthCheck(flag: boolean): DbContext {
    this.needAuthCheckFlag = flag;
    return this;
  }

  switchAuthCheck(flag: boolean): boolean {
    const old = this.needAuthCheckFlag;
    this.needAuthCheckFlag = flag;
    return old;
  }

  isPermitted(): boolean {
    return this.inKernelMode || !this.needAuthCheckFlag;
  }

  isInKernelMode(): boolean {
    return this.inKernelMode;
  }

  forceReadPermission(): boolean {
    return this.activeEnv.lookup(ForceReadPermFlag);
  }
}

export type JoinOn = {
  attributeName: string;
  operator: string;
  attributeValue: any;
};

export function makeJoinOn(attrName: string, attrValue: any, opr: string = '='): JoinOn {
  return {
    attributeName: attrName,
    attributeValue: attrValue,
    operator: opr,
  };
}

export type JoinClause = {
  tableName: string;
  queryObject?: object;
  queryValues?: object;
  joinType?: string; // 'join' | 'inner join' | 'left join' | 'right join' | 'full join'
  joinOn: JoinOn | JoinOn[];
};

export type DatabaseConfig = {
  type: string;
  host?: string;
  username?: string;
  password?: string;
  dbname?: string;
  port?: number;
};

function mkDbName(): string {
  return process.env.AGENTLANG_DB_NAME || `db-${Date.now()}`;
}

function needSync(): boolean {
  return isRuntimeMode_dev() || isRuntimeMode_test() || isRuntimeMode_init_schema();
}

function makePostgresDataSource(
  entities: EntitySchema[],
  config: DatabaseConfig | undefined
): DataSource {
  const synchronize = needSync();
  //const runMigrations = isRuntimeMode_migration() || isRuntimeMode_undo_migration() || !synchronize;
  return new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST || config?.host || 'localhost',
    port: getPostgressEnvPort() || config?.port || 5432,
    username: process.env.POSTGRES_USER || config?.username || 'postgres',
    password: process.env.POSTGRES_PASSWORD || config?.password || 'postgres',
    database: process.env.POSTGRES_DB || config?.dbname || 'postgres',
    synchronize: synchronize,
    migrationsRun: false,
    dropSchema: false,
    entities: entities,
    invalidWhereValuesBehavior: {
      null: 'sql-null',
      undefined: 'ignore',
    },
  });
}

function getPostgressEnvPort(): number | undefined {
  const s: string | undefined = process.env.POSTGRES_PORT;
  if (s) {
    return Number(s);
  } else {
    return undefined;
  }
}

function makeSqliteDataSource(
  entities: EntitySchema[],
  config: DatabaseConfig | undefined
): DataSource {
  const synchronize = needSync();
  //const runMigrations = isRuntimeMode_migration() || isRuntimeMode_undo_migration() || !synchronize;
  const dbPath = config?.dbname || mkDbName();
  const ds = new DataSource({
    type: 'better-sqlite3',
    database: dbPath,
    synchronize: synchronize,
    entities: entities,
    migrationsRun: false,
    dropSchema: false,
    invalidWhereValuesBehavior: {
      null: 'sql-null',
      undefined: 'ignore',
    },
  });
  const originalInit = ds.initialize.bind(ds);
  ds.initialize = async () => {
    const res = await originalInit();
    try {
      const driver = ds.driver as any;
      const db = driver.databaseConnection || driver.nativeDatabase;
      // Enable WAL mode and additional pragmas for better write performance
      if (db?.pragma) {
        db.pragma('journal_mode = WAL');

        const syncMode = process.env.SQLITE_SYNC_MODE || 'NORMAL';
        const busyTimeout = process.env.SQLITE_BUSY_TIMEOUT || '5000';
        const cacheSize = process.env.SQLITE_CACHE_SIZE || '-20000';

        db.pragma(`synchronous = ${syncMode}`);
        db.pragma(`busy_timeout = ${busyTimeout}`);
        db.pragma(`cache_size = ${cacheSize}`);
        db.pragma('temp_store = MEMORY');

        logger.info(
          `SQLite pragmas enabled: WAL mode, synchronous=${syncMode}, busy_timeout=${busyTimeout}, cache_size=${cacheSize}, temp_store=MEMORY`
        );
      }
    } catch (err: any) {
      logger.warn(`Failed to enable SQLite pragmas: ${err.message}.`);
    }
    return res;
  };
  return ds;
}

async function execMigrationSql(dataSource: DataSource, sql: string[]) {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.startTransaction();
  for (let i = 0; i < sql.length; ++i) {
    await queryRunner.query(sql[i]);
  }
  await queryRunner.commitTransaction();
}

async function maybeHandleMigrations(dataSource: DataSource) {
  const is_migration = isRuntimeMode_migration();
  const is_undo_migration = isRuntimeMode_undo_migration();
  const is_gen_migration = isRuntimeMode_generate_migration();
  if (is_migration || is_undo_migration || is_gen_migration) {
    const sqlInMemory = await dataSource.driver.createSchemaBuilder().log();
    let ups: string[] | undefined;
    if (is_migration || is_gen_migration) {
      ups = new Array<string>();
      sqlInMemory.upQueries.forEach(upQuery => {
        ups?.push(upQuery.query.replaceAll('`', '\\`'));
      });
    }
    let downs: string[] | undefined;
    if (is_undo_migration || is_gen_migration) {
      downs = new Array<string>();
      sqlInMemory.downQueries.forEach(downQuery => {
        downs?.push(downQuery.query.replaceAll('`', '\\`'));
      });
    }
    if (is_migration && ups?.length) {
      await saveMigration(getAppSpec().version, ups, downs);
      await execMigrationSql(dataSource, ups);
    } else if (is_undo_migration && downs?.length) {
      await saveMigration(getAppSpec().version, ups, downs);
      await execMigrationSql(dataSource, downs);
    } else if (is_gen_migration) {
      await saveMigration(getAppSpec().version, ups, downs);
    }
  }
}

function defaultLocateFile(file: string): string {
  // Out-of-the-box: use the official CDN in browsers.
  if (isBrowser()) {
    return `https://sql.js.org/dist/${file}`;
  }
  // Node: resolve from node_modules/sql.js/dist
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const path = require('path');

    const base = require.resolve('sql.js/dist/sql-wasm.js');
    return path.join(path.dirname(base), file);
  } catch {
    return file;
  }
}

function makeSqljsDataSource(
  entities: EntitySchema[],
  _config: DatabaseConfig | undefined,
  synchronize: boolean = true
): DataSource {
  return new DataSource({
    type: 'sqljs',
    autoSave: false,
    sqlJsConfig: {
      locateFile: defaultLocateFile,
    },
    synchronize: synchronize,
    entities: entities,
  });
}

function forceGetDbType(config: DatabaseConfig | undefined): string {
  if (config?.type) return config.type;
  let envType: string | undefined;
  try {
    if (typeof process !== 'undefined' && process.env) {
      envType = process.env.AL_DB_TYPE;
    }
  } catch {}
  if (envType) return envType;
  if (isBrowser()) return 'sqljs';
  return 'sqlite';
}

let DbType: string | undefined;

function getVectorStoreType(): string {
  // Check explicit vectorStore config first
  const vectorStoreConfig = AppConfig?.vectorStore;
  if (vectorStoreConfig?.type) {
    if (vectorStoreConfig.type === 'pgvector') return 'postgres';
    if (vectorStoreConfig.type === 'lancedb') return 'lancedb';
  }

  // Fallback to main store type
  const dbType = getDbType(AppConfig?.store);
  if (dbType === 'postgres') return 'postgres';
  return 'lancedb';
}

function getDbType(config: DatabaseConfig | undefined): string {
  if (DbType === undefined) DbType = forceGetDbType(config);
  return DbType;
}

function getDsFunction(
  config: DatabaseConfig | undefined
): (
  entities: EntitySchema<any>[],
  config: DatabaseConfig | undefined,
  synchronize?: boolean | undefined
) => DataSource {
  switch (getDbType(config)) {
    case 'sqlite':
      return makeSqliteDataSource;
    case 'postgres':
      return makePostgresDataSource;
    case 'sqljs':
      return makeSqljsDataSource;
    default:
      throw new Error(`Unsupported database type - ${config?.type}`);
  }
}

export function isUsingSqlite(): boolean {
  return getDbType(AppConfig?.store) == 'sqlite';
}

export function isUsingSqljs(): boolean {
  return getDbType(AppConfig?.store) == 'sqljs';
}

export async function isVectorStoreSupported(): Promise<boolean> {
  const vectorStoreType = getVectorStoreType();
  if (vectorStoreType === 'postgres') return true;
  if (vectorStoreType === 'lancedb') return true;
  return false;
}

export async function initDatabase(config: DatabaseConfig | undefined) {
  if (defaultDataSource === undefined) {
    const mkds = getDsFunction(config);
    if (mkds) {
      const ormScm = modulesAsOrmSchema();
      defaultDataSource = mkds(ormScm.entities, config) as DataSource;
      await defaultDataSource.initialize();
      await maybeHandleMigrations(defaultDataSource);
      if (ormScm.fkSpecs.length > 0) {
        const qr = defaultDataSource.createQueryRunner();
        for (let i = 0; i < ormScm.fkSpecs.length; ++i) {
          const fk = ormScm.fkSpecs[i];
          const fkobj = new TableForeignKey({
            columnNames: [fk.columnName],
            referencedColumnNames: [fk.targetColumnName],
            referencedTableName: asTableReference(fk.targetModuleName, fk.targetEntityName),
            onDelete: fk.onDelete,
            onUpdate: fk.onUpdate,
          });
          try {
            await qr.createForeignKey(asTableReference(fk.moduleName, fk.entityName), fkobj);
          } catch (reason: any) {
            logger.warn(`initDatabase: ${reason}`);
          }
        }
      }
      const vectEnts = ormScm.vectorEntities.map((es: EntitySchema) => {
        return es.options.name;
      });
      if (vectEnts.length > 0) {
        await initVectorStore(vectEnts, DbContext.getGlobalContext());
      }
    } else {
      throw new Error(`Unsupported database type - ${getDbType(AppConfig?.store)}`);
    }
  }
}

export async function resetDefaultDatabase() {
  if (defaultDataSource && defaultDataSource.isInitialized) {
    await defaultDataSource.destroy();
    defaultDataSource = undefined;
  }
}

function ownersTable(tableName: string): string {
  return (tableName.replace('.', '_') + OwnersSuffix).toLowerCase();
}

async function insertRowsHelper(
  tableName: string,
  rows: object[],
  ctx: DbContext,
  doUpsert: boolean
): Promise<void> {
  const ds = getDatasourceForTransaction(ctx.txnId);
  const repo = ds.getRepository(tableName);

  if (doUpsert) {
    await repo.save(rows);
  } else {
    await repo.insert(rows);
  }
}

export async function addRowForFullTextSearch(
  tableName: string,
  id: string,
  vect: number[],
  ctx: DbContext
) {
  if (!(await isVectorStoreSupported())) {
    logger.warn(`[VECTOR] Vector store not supported, skipping save for ${id}`);
    return;
  }
  try {
    const vecTableName = tableName + VectorSuffix;
    logger.info(
      `[VECTOR] Saving embedding to ${vecTableName} for ${id} (${vect.length} dimensions)`
    );
    const dbType = getVectorStoreType();
    const tenantId = await ctx.getTenantId();

    if (dbType === 'lancedb') {
      let store = lanceDBStores.get(tableName);
      if (!store) {
        store = createLanceDBStore({
          moduleName: tableName,
          vectorDimension: vect.length,
        });
        await store.init();
        lanceDBStores.set(tableName, store);
      }
      await store.addEmbedding({
        id,
        embedding: Array.from(vect),
        tenantId,
      });
    } else if (dbType === 'postgres') {
      const qb = getDatasourceForTransaction(ctx.txnId).createQueryBuilder();
      const { default: pgvector } = await import('pgvector');
      await qb
        .insert()
        .into(vecTableName)
        .values([{ id: id, embedding: pgvector.toSql(vect), agentId: tenantId }])
        .execute();
    }
    logger.info(`[VECTOR] Successfully saved embedding to ${vecTableName} for ${id}`);
  } catch (err: any) {
    logger.error(`[VECTOR] Failed to add row to vector store - ${err}`);
  }
}

export async function initVectorStore(tableNames: string[], ctx: DbContext) {
  if (!(await isVectorStoreSupported())) {
    logger.info(`Vector store not supported for ${getDbType(AppConfig?.store)}, skipping init...`);
    return;
  }
  const dbType = getVectorStoreType();
  let notInited = true;
  for (const vecTableName of tableNames) {
    if (dbType === 'lancedb') {
      if (!lanceDBStores.has(vecTableName)) {
        const store = createLanceDBStore({
          moduleName: vecTableName,
          vectorDimension: DefaultVectorDimension,
        });
        await store.init();
        lanceDBStores.set(vecTableName, store);
        logger.info(`[VECTOR] Initialized LanceDB store for ${vecTableName}`);
      }
    } else if (dbType === 'postgres') {
      const vecRepo = getDatasourceForTransaction(ctx.txnId).getRepository(vecTableName);
      if (notInited) {
        let failure = false;
        try {
          await vecRepo.query('CREATE EXTENSION IF NOT EXISTS vector');
        } catch (err: any) {
          logger.error(`Failed to initialize vector store - ${err}`);
          failure = true;
        }
        if (failure) continue;
        notInited = false;
      }
      await vecRepo.query(
        `CREATE TABLE IF NOT EXISTS ${vecTableName} (
          id varchar PRIMARY KEY,
          embedding vector(${DefaultVectorDimension}),
          ${TenantAttributeName} varchar,
          __is_deleted__ boolean default false
        )`
      );
    }
  }
}

export async function vectorStoreSearch(
  tableName: string,
  searchVec: number[],
  limit: number,
  ctx: DbContext
): Promise<any> {
  if (!(await isVectorStoreSupported())) {
    // Not supported on sqljs/sqlite
    return [];
  }
  try {
    const dbType = getVectorStoreType();
    const tenantId = await ctx.getTenantId();

    if (dbType === 'lancedb') {
      const store = lanceDBStores.get(tableName);
      if (!store) {
        logger.warn(`[VECTOR] LanceDB store not found for ${tableName}`);
        return [];
      }
      // Extract agentId from resourceFqName for agent-level filtering
      const agentId = ctx.resourceFqName || undefined;
      const results = await store.search(searchVec, tenantId, agentId, limit);
      return results.map(r => ({ id: r.id }));
    }

    let hasGlobalPerms = ctx.isPermitted();
    if (!hasGlobalPerms) {
      const userId = ctx.getUserId();
      const fqName = ctx.resourceFqName;
      const env: Environment = ctx.activeEnv;
      hasGlobalPerms = await canUserRead(userId, fqName, env);
    }
    const vecTableName = tableName + VectorSuffix;
    const qb = getDatasourceForTransaction(ctx.txnId).getRepository(tableName).manager;
    let ownersJoinCond: string = '';
    if (!hasGlobalPerms) {
      const ot = ownersTable(tableName);
      ownersJoinCond = `inner join ${ot} on
 ${ot}.path = ${vecTableName}.id and ${ot}.user_id = '${ctx.authInfo.userId}' and ${ot}.r = true
 and ${ot}.${TenantAttributeName} = '${tenantId}'`;
    }
    if (dbType === 'postgres') {
      const { default: pgvector } = await import('pgvector');
      const sql = `select ${vecTableName}.id from ${vecTableName} ${ownersJoinCond} order by embedding <-> $1 LIMIT ${limit}`;
      const args = pgvector.toSql(searchVec);
      return await qb.query(sql, [args]);
    }
  } catch (err: any) {
    logger.error(`Vector store search failed - ${err}`);
    return [];
  }
}

export async function vectorStoreSearchEntryExists(
  tableName: string,
  id: string,
  ctx: DbContext
): Promise<boolean> {
  if (!(await isVectorStoreSupported())) return false;
  try {
    const dbType = getVectorStoreType();

    if (dbType === 'lancedb') {
      const store = lanceDBStores.get(tableName);
      if (!store) {
        logger.warn(`[VECTOR] LanceDB store not found for ${tableName}`);
        return false;
      }
      return await store.exists(id);
    }

    const qb = getDatasourceForTransaction(ctx.txnId).getRepository(tableName).manager;
    const vecTableName = tableName + VectorSuffix;
    const tenantId = await ctx.getTenantId();

    if (dbType === 'postgres') {
      const result: any[] = await qb.query(
        `select id from ${vecTableName} where id = $1 and ${TenantAttributeName} = '${tenantId}'`,
        [id]
      );
      return result !== null && result.length > 0;
    }
  } catch (err: any) {
    logger.error(`Vector store search failed - ${err}`);
  }
  return false;
}

export async function deleteFullTextSearchEntry(tableName: string, id: string, ctx: DbContext) {
  if (!(await isVectorStoreSupported())) return;
  try {
    const dbType = getVectorStoreType();

    if (dbType === 'lancedb') {
      const store = lanceDBStores.get(tableName);
      if (!store) {
        logger.warn(`[VECTOR] LanceDB store not found for ${tableName}`);
        return;
      }
      await store.delete(id);
      return;
    }

    const qb = getDatasourceForTransaction(ctx.txnId).getRepository(tableName).manager;
    const vecTableName = tableName + VectorSuffix;
    const tenantId = await ctx.getTenantId();

    if (dbType === 'postgres') {
      await qb.query(
        `delete from ${vecTableName} where id = $1 and ${TenantAttributeName} = '${tenantId}'`,
        [id]
      );
    }
  } catch (err: any) {
    logger.error(`Vector store delete failed - ${err}`);
  }
}

async function checkUserPerm(
  opr: RbacPermissionFlag,
  ctx: DbContext,
  instRows: object
): Promise<boolean> {
  let hasPerm = ctx.isPermitted();
  if (!hasPerm) {
    const userId = ctx.getUserId();
    let f: Function | undefined;
    switch (opr) {
      case RbacPermissionFlag.CREATE:
        f = canUserCreate;
        break;
      case RbacPermissionFlag.READ:
        f = canUserRead;
        break;
      case RbacPermissionFlag.UPDATE:
        f = canUserUpdate;
        break;
      case RbacPermissionFlag.DELETE:
        f = canUserDelete;
        break;
      default:
        f = undefined;
    }
    if (f !== undefined) {
      hasPerm = await f(userId, ctx.resourceFqName, ctx.activeEnv);
    }
  }
  if (!hasPerm) {
    hasPerm = await isOwnerOfParent(instRows[PathKey], ctx);
  }
  return hasPerm;
}

async function checkCreatePermission(ctx: DbContext, inst: Instance): Promise<boolean> {
  const tmpCtx = ctx.clone().setResourceFqNameFrom(inst);
  return await checkUserPerm(
    RbacPermissionFlag.CREATE,
    tmpCtx,
    Object.fromEntries(inst.attributes)
  );
}

export async function insertRows(
  tableName: string,
  rows: object[],
  ctx: DbContext,
  doUpsert: boolean = false
): Promise<void> {
  let hasPerm = ctx.isPermitted();
  if (!hasPerm) {
    hasPerm = await checkUserPerm(RbacPermissionFlag.CREATE, ctx, rows[0]);
  }
  if (hasPerm) {
    await insertRowsHelper(tableName, rows, ctx, doUpsert);
    if (!doUpsert) {
      if (!ctx.isInKernelMode()) {
        await createOwnership(tableName, rows, ctx);
      } else if (ctx.forceReadPermission()) {
        await createReadPermission(tableName, rows, ctx);
      }
      if (ctx.rbacRules) {
        for (let i = 0; i < ctx.rbacRules.length; ++i) {
          const rbacRule = ctx.rbacRules[i];
          const e = rbacRule.expression;
          if (e) {
            const [selfRef, userRef] = e.lhs.startsWith('this.') ? [e.lhs, e.rhs] : [e.rhs, e.lhs];
            if (userRef == 'auth.user') {
              const attr = selfRef.split('.')[1];
              for (let j = 0; j < rows.length; ++j) {
                const r: any = rows[j];
                const userId = r[attr];
                if (userId) {
                  await createLimitedOwnership(tableName, [r], userId, rbacRule.permissions, ctx);
                }
              }
            }
          }
        }
      }
    }
  } else {
    throw new UnauthorisedError({ opr: 'insert', entity: tableName });
  }
}

export async function insertRow(
  tableName: string,
  row: object,
  ctx: DbContext,
  doUpsert: boolean
): Promise<void> {
  const rows: Array<object> = new Array<object>();
  rows.push(row);
  await insertRows(tableName, rows, ctx, doUpsert);
}

export async function insertBetweenRow(
  n: string,
  a1: string,
  a2: string,
  node1: Instance,
  node2: Instance,
  relEntry: Relationship,
  ctx: DbContext
): Promise<void> {
  let hasPerm = await checkCreatePermission(ctx, node1);
  if (hasPerm) {
    hasPerm = await checkCreatePermission(ctx, node2);
  }
  if (hasPerm) {
    const attrs: InstanceAttributes = newInstanceAttributes();
    const p1 = node1.attributes.get(PathAttributeName);
    const p2 = node2.attributes.get(PathAttributeName);
    attrs.set(a1, p1);
    attrs.set(a2, p2);
    attrs.set(PathAttributeName, crypto.randomUUID());
    if (relEntry.isOneToMany()) {
      attrs.set(relEntry.joinNodesAttributeName(), `${p1}_${p2}`);
    }
    await setAllMetaAttributes(attrs, ctx.activeEnv);
    const row = Object.fromEntries(attrs);
    await insertRow(n, row, ctx.clone().setNeedAuthCheck(false), false);
  } else {
    throw new UnauthorisedError({ opr: 'insert', entity: n });
  }
}

const PathKey = PathAttributeName as keyof object;

const AllPerms = new Set<RbacPermissionFlag>()
  .add(RbacPermissionFlag.CREATE)
  .add(RbacPermissionFlag.READ)
  .add(RbacPermissionFlag.UPDATE)
  .add(RbacPermissionFlag.DELETE);

async function createOwnership(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
  await createLimitedOwnership(tableName, rows, ctx.authInfo.userId, AllPerms, ctx);
}

const ReadPermOnly = new Set<RbacPermissionFlag>().add(RbacPermissionFlag.READ);

async function createReadPermission(
  tableName: string,
  rows: object[],
  ctx: DbContext
): Promise<void> {
  await createLimitedOwnership(tableName, rows, ctx.authInfo.userId, ReadPermOnly, ctx);
}

async function createLimitedOwnership(
  tableName: string,
  rows: object[],
  userId: string,
  perms: Set<RbacPermissionFlag>,
  ctx: DbContext
): Promise<void> {
  const ownerRows: object[] = [];
  const tenantId = await ctx.getTenantId();
  rows.forEach((r: object) => {
    ownerRows.push({
      id: crypto.randomUUID(),
      path: r[PathKey],
      user_id: userId,
      c: perms.has(RbacPermissionFlag.CREATE),
      r: perms.has(RbacPermissionFlag.READ),
      d: perms.has(RbacPermissionFlag.DELETE),
      u: perms.has(RbacPermissionFlag.UPDATE),
      agentId: tenantId,
    });
  });
  const tname = ownersTable(tableName);
  await insertRowsHelper(tname, ownerRows, ctx, false);
}

async function isOwnerOfParent(path: string, ctx: DbContext): Promise<boolean> {
  const parts = path.split('/');
  if (parts.length <= 2) {
    return false;
  }
  const parentPaths = new Array<[string, string]>();
  let i = 0;
  let lastPath: string | undefined;
  while (i < parts.length - 2) {
    const parentName = parts[i].replace('$', '_');
    const parentPath = `${lastPath ? lastPath + '/' : ''}${parts[i]}/${parts[i + 1]}`;
    lastPath = `${parentPath}/${parts[i + 2]}`;
    parentPaths.push([parentName, parentPath]);
    i += 3;
  }
  if (parentPaths.length == 0) {
    return false;
  }
  for (let i = 0; i < parentPaths.length; ++i) {
    const [parentName, parentPath] = parentPaths[i];
    const result = await isOwner(parentName, parentPath, ctx);
    if (result) return result;
  }
  return false;
}

async function isOwner(parentName: string, instPath: string, ctx: DbContext): Promise<boolean> {
  const userId = ctx.getUserId();
  const tabName = ownersTable(parentName);
  const alias = tabName;
  const query = [
    `${alias}.path = '${instPath}'`,
    `${alias}.user_id = '${userId}'`,
    `${alias}.type = 'o'`,
  ];
  let result: any = undefined;
  const sq: SelectQueryBuilder<any> = getDatasourceForTransaction(ctx.txnId)
    .createQueryBuilder()
    .select()
    .from(tabName, alias)
    .where(query.join(' AND '));
  try {
    await sq.getRawMany().then((r: any) => (result = r));
  } catch (reason: any) {
    logger.error(`Failed to check ownership on parent ${parentName} - ${reason}`);
  }
  if (result === undefined || result.length === 0) {
    return false;
  }
  return true;
}

export async function upsertRows(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
  await insertRows(tableName, rows, ctx, true);
}

export async function upsertRow(tableName: string, row: object, ctx: DbContext): Promise<void> {
  const rows: Array<object> = new Array<object>();
  rows.push(row);
  await upsertRows(tableName, rows, ctx);
}

export async function updateRow(
  tableName: string,
  queryObj: object,
  queryVals: object,
  updateObj: object,
  ctx: DbContext
): Promise<boolean> {
  await getDatasourceForTransaction(ctx.txnId)
    .createQueryBuilder()
    .update(tableName)
    .set(updateObj)
    .where(objectToWhereClause(queryObj, queryVals), queryVals)
    .execute();
  return true;
}

type QueryObjectEntry = [string, any];
export type QueryObject = Array<QueryObjectEntry>;

function queryObjectAsWhereClause(qobj: QueryObject): string {
  const ss: Array<string> = [];
  qobj.forEach((kv: QueryObjectEntry) => {
    const k = kv[0];
    ss.push(`${k} = :${k}`);
  });
  return ss.join(' AND ');
}

export async function hardDeleteRow(tableName: string, queryObject: QueryObject, ctx: DbContext) {
  const clause = queryObjectAsWhereClause(queryObject);
  await getDatasourceForTransaction(ctx.txnId)
    .createQueryBuilder()
    .delete()
    .from(tableName)
    .where(clause, Object.fromEntries(queryObject))
    .execute();
  return true;
}

function mkBetweenClause(tableName: string | undefined, k: string, queryVals: any): string {
  const ov = queryVals[k];
  if (ov instanceof Array) {
    const isstr = isString(ov[0]);
    const v1 = isstr ? `'${ov[0]}'` : ov[0];
    const v2 = isstr ? `'${ov[1]}'` : ov[1];
    const s = tableName
      ? `"${tableName}"."${k}" BETWEEN ${v1} AND ${v2}`
      : `"${k}" BETWEEN ${v1} AND ${v2}`;
    delete queryVals[k];
    return s;
  } else {
    throw new Error(`between requires an array argument, not ${ov}`);
  }
}

function objectToWhereClause(queryObj: object, queryVals: any, tableName?: string): string {
  const clauses: Array<string> = new Array<string>();
  Object.entries(queryObj).forEach((value: [string, any]) => {
    let op: string = value[1] as string;
    const k = value[0];
    const isnullcheck = queryVals[k] === null;
    if (isnullcheck) {
      if (op === '=') {
        op = 'IS';
      } else if (op === '<>' || op === '!=') {
        op = 'IS NOT';
      } else {
        throw new Error(`Operator ${op} cannot be appplied to SQL NULL`);
      }
    }
    const v = isnullcheck ? 'NULL' : `:${k}`;
    const clause =
      op == 'between'
        ? mkBetweenClause(tableName, k, queryVals)
        : tableName
          ? `"${tableName}"."${k}" ${op} ${v}`
          : `"${k}" ${op} ${v}`;
    clauses.push(clause);
  });
  return clauses.join(' AND ');
}

function objectToRawWhereClause(queryObj: object, queryVals: any, tableName?: string): string {
  const clauses: Array<string> = new Array<string>();
  Object.entries(queryObj).forEach((value: [string, any]) => {
    let op: string = value[1] as string;
    const k: string = value[0];
    if (queryVals[k] === null) {
      if (op === '=') {
        op = 'IS';
      } else if (op === '<>' || op === '!=') {
        op = 'IS NOT';
      } else {
        throw new Error(`Operator ${op} cannot be appplied to SQL NULL`);
      }
    }
    let clause = '';
    if (op == 'between') {
      clause = mkBetweenClause(tableName, k, queryVals);
    } else {
      const ov: any = queryVals[k];
      const v = isString(ov) ? `'${ov}'` : ov;
      clause = tableName ? `"${tableName}"."${k}" ${op} ${v}` : `"${k}" ${op} ${v}`;
    }
    clauses.push(clause);
  });
  if (clauses.length > 0) {
    return clauses.join(' AND ');
  } else {
    return '';
  }
}

export type QuerySpec = {
  queryObj: object | undefined;
  queryVals: object | undefined;
  aggregates: Map<string, string> | undefined;
  groupBy: string[] | undefined;
  orderBy: string[] | undefined;
  orderByDesc: 'DESC' | 'ASC';
  joinClauses: JoinClause[] | undefined;
  intoSpec: Map<string, string> | undefined;
  whereClauses: WhereClause[] | undefined;
  distinct: boolean;
  limit: number | undefined;
  offset: number | undefined;
};

export function makeSimpleQuerySpec(queryObj: object, queryVals: object): QuerySpec {
  return {
    queryObj,
    queryVals,
    aggregates: undefined,
    groupBy: undefined,
    orderBy: undefined,
    orderByDesc: 'ASC',
    joinClauses: undefined,
    intoSpec: undefined,
    whereClauses: undefined,
    distinct: false,
    limit: undefined,
    offset: undefined,
  };
}

export async function getMany(
  tableName: string,
  querySpec: QuerySpec,
  ctx: DbContext
): Promise<any> {
  const alias: string = tableName.toLowerCase();
  const tenantId = await ctx.getTenantId();
  const queryStr: string = withNotDeletedClause(
    alias,
    tenantId,
    querySpec.queryObj !== undefined
      ? objectToWhereClause(querySpec.queryObj, querySpec.queryVals, alias)
      : ''
  );
  let ownersJoinCond: string[] | undefined;
  let ot: string = '';
  let otAlias: string = '';
  if (!ctx.isPermitted()) {
    const userId = ctx.getUserId();
    const fqName = ctx.resourceFqName;
    const env: Environment = ctx.activeEnv;
    let hasGlobalPerms = await canUserRead(userId, fqName, env);
    if (hasGlobalPerms) {
      if (ctx.isForUpdate()) {
        hasGlobalPerms = await canUserUpdate(userId, fqName, env);
      } else if (ctx.isForDelete()) {
        hasGlobalPerms = await canUserDelete(userId, fqName, env);
      }
    }
    if (!hasGlobalPerms) {
      ot = ownersTable(tableName);
      otAlias = ot.toLowerCase();
      ownersJoinCond = [
        `${otAlias}.path = ${alias}.${PathAttributeName}`,
        `${otAlias}.user_id = '${ctx.authInfo.userId}'`,
        `${otAlias}.r = true`,
      ];
      if (ctx.isForUpdate()) {
        ownersJoinCond.push(`${otAlias}.u = true`);
      }
      if (ctx.isForDelete()) {
        ownersJoinCond.push(`${otAlias}.d = true`);
      }
    }
  }

  const qb: SelectQueryBuilder<any> = getDatasourceForTransaction(ctx.txnId)
    .getRepository(tableName)
    .createQueryBuilder();
  const hasAggregates = querySpec.aggregates !== undefined;
  if (hasAggregates) {
    qb.select([]);
    querySpec.aggregates?.forEach((f: string, n: string) => {
      qb.addSelect(f, n);
    });
  }
  if (querySpec.groupBy !== undefined) {
    querySpec.groupBy.forEach((gb: string) => {
      qb.addGroupBy(gb);
    });
  }
  if (querySpec.orderBy !== undefined) {
    querySpec.orderBy.forEach((ob: string) => {
      qb.addOrderBy(ob, querySpec.orderByDesc);
    });
  }
  if (ownersJoinCond) {
    qb.innerJoin(ot, otAlias, ownersJoinCond.join(' AND '));
  }
  if (querySpec.distinct) {
    qb.distinct(true);
  }
  if (querySpec.limit !== undefined) {
    qb.take(querySpec.limit);
  }
  if (querySpec.offset !== undefined) {
    qb.skip(querySpec.offset);
  }
  qb.where(queryStr, querySpec.queryVals);
  if (hasAggregates) return await qb.getRawMany();
  else return await qb.getMany();
}

export async function getManyByRawQuery(
  tableName: string,
  querySpec: QuerySpec,
  ctx: DbContext
): Promise<any> {
  const qb: SelectQueryBuilder<any> = getDatasourceForTransaction(ctx.txnId)
    .getRepository(tableName)
    .createQueryBuilder();
  qb.where('', querySpec.queryVals);
  return await qb.getMany();
}

export async function getManyByJoin(
  tableName: string,
  querySpec: QuerySpec,
  ctx: DbContext
): Promise<any> {
  const alias: string = tableName.toLowerCase();
  const tenantId = await ctx.getTenantId();
  let queryStr: string = withNotDeletedClause(
    alias,
    tenantId,
    querySpec.queryObj !== undefined
      ? objectToRawWhereClause(querySpec.queryObj, querySpec.queryVals, alias)
      : ''
  );
  if (querySpec.whereClauses) {
    const qs = new Array<string>();
    querySpec.whereClauses.forEach((wc: WhereClause) => {
      const v = isString(wc.qval) ? `'${wc.qval}'` : wc.qval;
      qs.push(`${wc.attrName} ${wc.op} ${v}`);
    });
    queryStr = `${queryStr} AND ${qs.join(' AND ')}`;
  }
  let ot: string = '';
  let otAlias: string = '';
  if (!ctx.isPermitted()) {
    const userId = ctx.getUserId();
    const fqName = ctx.resourceFqName;
    const env: Environment = ctx.activeEnv;
    const hasGlobalPerms = await canUserRead(userId, fqName, env);
    if (!hasGlobalPerms) {
      ot = ownersTable(tableName);
      otAlias = ot.toLowerCase();
      querySpec.joinClauses?.push({
        tableName: otAlias,
        joinOn: [
          makeJoinOn(`${otAlias}.path`, `${alias}.${PathAttributeName}`),
          makeJoinOn(`${otAlias}.user_id`, `'${ctx.authInfo.userId}'`),
          makeJoinOn(`${otAlias}.r`, true),
        ],
      });
    }
  }
  const joinSql = new Array<string>();
  querySpec.joinClauses?.forEach((jc: JoinClause) => {
    const joinType = jc.joinType ? jc.joinType : 'inner join';
    joinSql.push(
      `${joinType} ${jc.tableName} as ${jc.tableName} on ${joinOnAsSql(jc.joinOn)} 
      AND ${jc.tableName}.${DeletedFlagAttributeName} = false
      AND ${jc.tableName}.${TenantAttributeName} = '${tenantId}'`
    );
    if (jc.queryObject) {
      const q = objectToRawWhereClause(jc.queryObject, jc.queryValues, jc.tableName);
      if (q.length > 0) {
        joinSql.push(` AND ${q}`);
      }
    }
  });
  if (querySpec.intoSpec === undefined) {
    throw new Error('SELECT-INTO pattern is missing');
  }
  const intos = querySpec.intoSpec.size > 0 ? intoSpecToSql(querySpec.intoSpec) : '';
  const intos_sep = intos.length === 0 ? '' : ',';
  const aggrs =
    querySpec.aggregates !== undefined ? intoSpecToSql(querySpec.aggregates) : undefined;
  const cols = aggrs ? `${intos} ${intos_sep} ${aggrs}` : intos;
  let sql = `SELECT ${querySpec.distinct ? 'DISTINCT' : ''} ${cols} FROM ${tableName} ${joinSql.join('\n')} WHERE ${queryStr}`;
  if (querySpec.groupBy !== undefined) {
    sql = `${sql} GROUP BY ${querySpec.groupBy.join(', ')}`;
  }
  if (querySpec.orderBy !== undefined) {
    sql = `${sql} ORDER BY ${querySpec.orderBy.join(', ')} ${querySpec.orderByDesc}`;
  }
  if (querySpec.limit !== undefined) {
    sql = `${sql} LIMIT ${querySpec.limit}`;
  }
  if (querySpec.offset !== undefined) {
    sql = `${sql} OFFSET ${querySpec.offset}`;
  }
  logger.debug(`Join Query: ${sql}`);
  const qb = getDatasourceForTransaction(ctx.txnId).getRepository(tableName).manager;
  return await qb.query(sql);
}

function intoSpecToSql(intoSpec: Map<string, string>): string {
  const cols = new Array<string>();
  intoSpec.forEach((v: string, k: string) => {
    cols.push(`${v} AS "${k}"`);
  });
  return cols.join(', ');
}

function joinOnAsSql(joinOn: JoinOn | JoinOn[]): string {
  if (joinOn instanceof Array) {
    return joinOn.map(joinOnAsSql).join(' AND ');
  } else {
    return `${joinOn.attributeName} ${joinOn.operator} ${joinOn.attributeValue}`;
  }
}

function notDeletedClause(alias: string, tenantId: string): string {
  return `${alias}.${DeletedFlagAttributeName} = false AND ${alias}.${TenantAttributeName} = '${tenantId}'`;
}

function withNotDeletedClause(alias: string, tenantId: string, sql: string): string {
  if (sql == '') {
    return notDeletedClause(alias, tenantId);
  } else {
    return `${sql} AND ${notDeletedClause(alias, tenantId)}`;
  }
}

export type BetweenConnectionInfo = {
  connectionTable: string;
  fromColumn: string;
  fromValue: string;
  toColumn: string;
  toRef: string;
};

function buildQueryFromConnnectionInfo(
  connAlias: string,
  mainAlias: string,
  connInfo: BetweenConnectionInfo
): string {
  return `${connAlias}.${connInfo.fromColumn} = ${connInfo.fromValue} AND ${connAlias}.${connInfo.toColumn} = ${mainAlias}.${connInfo.toRef}`;
}

export async function getAllConnected(
  tableName: string,
  queryObj: any,
  queryVals: any,
  connInfo: BetweenConnectionInfo,
  ctx: DbContext
) {
  const alias: string = tableName.toLowerCase();
  const connAlias: string = connInfo.connectionTable.toLowerCase();
  queryObj[DeletedFlagAttributeName] = '=';
  queryVals[DeletedFlagAttributeName] = false;
  queryObj[TenantAttributeName] = '=';
  queryVals[TenantAttributeName] = await ctx.getTenantId();
  const qb = getDatasourceForTransaction(ctx.txnId)
    .createQueryBuilder()
    .select()
    .from(tableName, alias)
    .where(objectToWhereClause(queryObj, queryVals, alias), queryVals)
    .innerJoin(
      connInfo.connectionTable,
      connAlias,
      buildQueryFromConnnectionInfo(connAlias, alias, connInfo)
    );
  return await qb.getRawMany();
}

const transactionsDb: Map<string, QueryRunner> = new Map<string, QueryRunner>();

export async function startDbTransaction(): Promise<string> {
  if (defaultDataSource !== undefined) {
    const queryRunner = defaultDataSource.createQueryRunner();
    await queryRunner.startTransaction();
    const txnId: string = crypto.randomUUID();
    transactionsDb.set(txnId, queryRunner);
    return txnId;
  } else {
    throw new Error('Database not initialized');
  }
}

function getDatasourceForTransaction(txnId: string | undefined): DataSource | EntityManager {
  if (txnId) {
    const qr: QueryRunner | undefined = transactionsDb.get(txnId);
    if (qr === undefined) {
      throw new Error(`Transaction not found - ${txnId}`);
    } else {
      return qr.manager;
    }
  } else {
    if (defaultDataSource !== undefined) return defaultDataSource;
    else throw new Error('No default datasource is initialized');
  }
}

export async function commitDbTransaction(txnId: string): Promise<void> {
  await endTransaction(txnId, true);
}

export async function rollbackDbTransaction(txnId: string): Promise<void> {
  await endTransaction(txnId, false);
}

async function endTransaction(txnId: string, commit: boolean): Promise<void> {
  const qr: QueryRunner | undefined = transactionsDb.get(txnId);
  if (qr && qr.isTransactionActive) {
    try {
      if (commit) {
        await qr.commitTransaction();
      } else {
        await qr.rollbackTransaction();
      }
    } catch (err: any) {
      logger.error(
        `Failed to ${commit ? 'commit' : 'rollback'} transaction ${txnId}: ${err.message}`
      );
      throw err;
    } finally {
      await qr.release();
      transactionsDb.delete(txnId);
    }
  }
}
