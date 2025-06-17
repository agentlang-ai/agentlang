import { DataSource, EntityManager, QueryRunner, SelectQueryBuilder } from 'typeorm';
import { logger } from '../../logger.js';
import { modulesAsOrmSchema } from './dbutil.js';
import { ResolverAuthInfo } from '../interface.js';
import {
  canUserCreate,
  canUserDelete,
  canUserRead,
  canUserUpdate,
  UnauthorisedError,
} from '../../modules/auth.js';
import { Environment } from '../../interpreter.js';
import {
  attributesAsColumns,
  Instance,
  InstanceAttributes,
  newInstanceAttributes,
  RbacPermissionFlag,
  Relationship,
} from '../../module.js';

export let defaultDataSource: DataSource | undefined;

export const PathAttributeName: string = '__path__';
export const DeletedFlagAttributeName: string = '__is_deleted__';

export class DbContext {
  txnId: string | undefined;
  authInfo: ResolverAuthInfo;
  private inKernelMode: boolean = false;
  resourceFqName: string;
  activeEnv: Environment;
  private needAuthCheckFlag: boolean = true;

  constructor(
    resourceFqName: string,
    authInfo: ResolverAuthInfo,
    activeEnv: Environment,
    txnId?: string,
    inKernelMode?: boolean
  ) {
    this.resourceFqName = resourceFqName;
    this.authInfo = authInfo;
    this.activeEnv = activeEnv;
    this.txnId = txnId;
    if (inKernelMode != undefined) {
      this.inKernelMode = inKernelMode;
    }
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

  isPermitted(): boolean {
    return this.inKernelMode || !this.needAuthCheckFlag;
  }

  isInKernelMode(): boolean {
    return this.inKernelMode;
  }
}

function mkDbName(): string {
  return process.env.AGENTLANG_DB_NAME || `db-${Date.now()}`;
}

export async function initDefaultDatabase() {
  if (defaultDataSource == undefined) {
    defaultDataSource = new DataSource({
      type: 'sqlite',
      database: mkDbName(),
      synchronize: true,
      entities: modulesAsOrmSchema(),
    });
    await defaultDataSource.initialize();
  }
}

function ownersTable(tableName: string): string {
  return tableName + `_owners`;
}

async function insertRowsHelper(
  tableName: string,
  rows: object[],
  ctx: DbContext,
  doUpsert: boolean
): Promise<void> {
  const repo = getDatasourceForTransaction(ctx.txnId).getRepository(tableName);
  if (doUpsert) await repo.save(rows);
  else await repo.insert(rows);
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
    if (f != undefined) {
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
    attributesAsColumns(inst.attributes)
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
    if (!ctx.isInKernelMode() && !doUpsert) {
      await createOwnership(tableName, rows, ctx);
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
    const row = attributesAsColumns(attrs);
    await insertRow(n, row, ctx.clone().setNeedAuthCheck(false), false);
  } else {
    throw new UnauthorisedError({ opr: 'insert', entity: n });
  }
}

const PathKey = PathAttributeName as keyof object;

async function createOwnership(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
  const ownerRows: object[] = [];
  rows.forEach((r: object) => {
    ownerRows.push({
      id: crypto.randomUUID(),
      path: r[PathKey],
      user_id: ctx.authInfo.userId,
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

async function isOwner(tableName: string, instPath: string, ctx: DbContext): Promise<boolean> {
  const userId = ctx.getUserId();
  const tabName = ownersTable(tableName);
  const alias = tabName.toLowerCase();
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
  await sq
    .getRawMany()
    .then((r: any) => (result = r))
    .catch((reason: any) => {
      logger.error(`Failed to check ownership on parent ${tableName} - ${reason}`);
    });
  if (result == undefined || result.length == 0) {
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
    .where(objectToWhereClause(queryObj), queryVals)
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

function objectToWhereClause(queryObj: object, tableName?: string): string {
  const clauses: Array<string> = new Array<string>();
  Object.entries(queryObj).forEach((value: [string, any]) => {
    const op: string = value[1] as string;
    clauses.push(
      tableName ? `${tableName}.${value[0]} ${op} :${value[0]}` : `${value[0]} ${op} :${value[0]}`
    );
  });
  return clauses.join(' AND ');
}

export async function getMany(
  tableName: string,
  queryObj: object | undefined,
  queryVals: object | undefined,
  colNamesToSelect: string[],
  ctx: DbContext
): Promise<any> {
  const alias: string = tableName.toLowerCase();
  const queryStr: string = withNotDeletedClause(
    alias,
    queryObj != undefined ? objectToWhereClause(queryObj, alias) : ''
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
  const selCols = new Array<string>();
  colNamesToSelect.forEach((s: string) => {
    selCols.push(`${alias}.${s}`);
  });
  selCols.push(`${alias}.${PathAttributeName}`);

  const qb: SelectQueryBuilder<any> = getDatasourceForTransaction(ctx.txnId)
    .getRepository(tableName)
    .createQueryBuilder();
  if (ownersJoinCond) {
    qb.innerJoin(ot, otAlias, ownersJoinCond.join(' AND '));
  }
  qb.where(queryStr, queryVals);
  return await qb.getMany();
}

function notDeletedClause(alias: string): string {
  return `${alias}.${DeletedFlagAttributeName} = false`;
}

function withNotDeletedClause(alias: string, sql: string): string {
  if (sql == '') {
    return notDeletedClause(alias);
  } else {
    return `${sql} AND ${notDeletedClause(alias)}`;
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
  queryObj: object,
  queryVals: object,
  connInfo: BetweenConnectionInfo,
  ctx: DbContext
) {
  const alias: string = tableName.toLowerCase();
  const connAlias: string = connInfo.connectionTable.toLowerCase();
  const qb = getDatasourceForTransaction(ctx.txnId)
    .createQueryBuilder()
    .select()
    .from(tableName, alias)
    .where(objectToWhereClause(queryObj, alias), queryVals)
    .innerJoin(
      connInfo.connectionTable,
      connAlias,
      buildQueryFromConnnectionInfo(connAlias, alias, connInfo)
    );
  return await qb.getRawMany();
}

const transactionsDb: Map<string, QueryRunner> = new Map<string, QueryRunner>();

export async function startDbTransaction(): Promise<string> {
  if (defaultDataSource != undefined) {
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
    if (qr == undefined) {
      throw new Error(`Transaction not found - ${txnId}`);
    } else {
      return qr.manager;
    }
  } else {
    if (defaultDataSource != undefined) return defaultDataSource;
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
      if (commit)
        await qr.commitTransaction().catch((reason: any) => {
          console.log(reason.type);
          logger.error(`failed to commit transaction ${txnId} - ${reason}`);
        });
      else
        await qr.rollbackTransaction().catch((reason: any) => {
          logger.error(`failed to rollback transaction ${txnId} - ${reason}`);
        });
    } finally {
      await qr.release();
      transactionsDb.delete(txnId);
    }
  }
}
