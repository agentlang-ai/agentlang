import {
  DataSource,
  EntityManager,
  QueryRunner,
  SelectQueryBuilder,
  Table,
  TableColumnOptions,
} from 'typeorm';
import { logger } from '../../logger.js';
import { modulesAsDbSchema, TableSchema } from './dbutil.js';
import chalk from 'chalk';
import { ResolverAuthInfo } from '../interface.js';
import {
  canUserCreate,
  canUserDelete,
  canUserRead,
  canUserUpdate,
  UnauthorisedError,
} from '../../modules/auth.js';

let defaultDataSource: DataSource | undefined;

export const PathAttributeName: string = '__path__';
export const DeletedFlagAttributeName: string = '__is_deleted__';

export class DbContext {
  txnId: string | undefined;
  authInfo: ResolverAuthInfo;
  inKernelMode: boolean = false;
  resourceFqName: string;

  constructor(
    resourceFqName: string,
    authInfo: ResolverAuthInfo,
    txnId?: string,
    inKernelMode?: boolean
  ) {
    this.resourceFqName = resourceFqName;
    this.authInfo = authInfo;
    this.txnId = txnId;
    if (inKernelMode != undefined) {
      this.inKernelMode = inKernelMode;
    }
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
}

export async function initDefaultDatabase() {
  if (defaultDataSource == undefined) {
    defaultDataSource = new DataSource({
      type: 'sqlite',
      database: 'db',
    });
    await defaultDataSource.initialize();
    await createTables()
      .then((_: void) => {
        const msg: string = 'Database schema initialized';
        logger.debug(msg);
        console.log(chalk.gray(msg));
      })
      .catch(err => {
        logger.error('Error during Data Source initialization', err);
      });
  }
}

function ownersTable(tableName: string): string {
  return tableName + `_owners`;
}

async function createTables(): Promise<void> {
  if (defaultDataSource != undefined) {
    const queryRunner = defaultDataSource.createQueryRunner();
    const tableSpecs: TableSchema[] = modulesAsDbSchema();
    try {
      for (let i = 0; i < tableSpecs.length; ++i) {
        const ts: TableSchema = tableSpecs[i];
        const hasPk: boolean =
          ts.columns.columns.find((tco: TableColumnOptions) => {
            return tco.isPrimary == true;
          }) == undefined
            ? false
            : true;
        ts.columns.columns.push({
          name: PathAttributeName,
          type: 'varchar',
          isPrimary: !hasPk,
          isUnique: hasPk,
          isNullable: false,
        });
        ts.columns.columns.push({
          name: DeletedFlagAttributeName,
          type: 'boolean',
          isNullable: false,
          default: false,
        });
        if (hasPk) {
          ts.columns.indices.push({ columnNames: [PathAttributeName] });
        }
        await queryRunner
          .createTable(
            new Table({
              name: ts.name,
              columns: ts.columns.columns,
              indices: ts.columns.indices,
            }),
            true
          )
          .catch((reason: any) => {
            logger.error(`failed to create table ${ts.name} - ${reason}`);
          });
        await queryRunner
          .createTable(
            new Table({
              name: ownersTable(ts.name),
              columns: [
                {
                  name: 'path',
                  type: 'varchar',
                  isPrimary: true,
                },
                {
                  name: 'user_id',
                  type: 'varchar',
                },
                {
                  name: 'type',
                  type: 'char(1)',
                  default: "'u'",
                },
                {
                  name: 'c',
                  type: 'boolean',
                  default: true,
                },
                {
                  name: 'r',
                  type: 'boolean',
                  default: true,
                },
                {
                  name: 'u',
                  type: 'boolean',
                  default: true,
                },
                {
                  name: 'd',
                  type: 'boolean',
                  default: true,
                },
              ],
            }),
            true
          )
          .catch((reason: any) => {
            logger.error(`failed to create owners table for ${ts.name} - ${reason}`);
          });
        if (ts.columns.fks != undefined) {
          for (let j = 0; j < ts.columns.fks.length; ++j) {
            await queryRunner.createForeignKey(ts.name, ts.columns.fks[j]).catch((reason: any) => {
              logger.error(`failed to create fk constraint for ${ts.name} - ${reason}`);
            });
          }
        }
      }
    } finally {
      queryRunner.release();
    }
  } else {
    throw new Error('Datasource not initialized, cannot create tables.');
  }
}

async function insertRowsHelper(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
  await getDatasourceForTransaction(ctx.txnId)
    .createQueryBuilder()
    .insert()
    .into(tableName)
    .values(rows)
    .execute();
}

export async function insertRows(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
  let hasPerm = ctx.inKernelMode;
  if (!hasPerm) {
    await canUserCreate(ctx.getUserId(), ctx.resourceFqName).then((r: boolean) => {
      hasPerm = r;
    });
  }
  if (hasPerm) {
    await insertRowsHelper(tableName, rows, ctx);
    if (!ctx.inKernelMode) {
      await createOwnership(tableName, rows, ctx);
    }
  } else {
    throw new UnauthorisedError();
  }
}

async function createOwnership(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
  const ownerRows: object[] = [];
  rows.forEach((r: object) => {
    const k = PathAttributeName as keyof object;
    ownerRows.push({
      path: r[k],
      user_id: ctx.authInfo.userId,
      type: 'u',
      c: true,
      r: true,
      u: true,
      d: true,
    });
  });
  const tname = ownersTable(tableName);
  await insertRowsHelper(tname, ownerRows, ctx);
}

export async function insertRow(tableName: string, row: object, ctx: DbContext): Promise<void> {
  const rows: Array<object> = new Array<object>();
  rows.push(row);
  await insertRows(tableName, rows, ctx);
}

export async function upsertRows(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
  // This is the right way to do an upsert in TypeORM, but `orUpdate` does not seem to work
  // without a (TypeORM) entity definition.

  /*const rowsForUpsert: Array<string> = Object.keys(rows[0]);
  const idx = rowsForUpsert.findIndex((s: string) => {
    return s == PathAttributeName;
  });
  if (idx >= 0) {
    rowsForUpsert.splice(idx, 1);
  }
  await getDatasourceForTransaction(txnId)
    .createQueryBuilder()
    .insert()
    .into(tableName)
    .values(rows)
    .orUpdate(rowsForUpsert, PathAttributeName)
    .execute();*/
  let hasPerm = ctx.inKernelMode;
  if (!hasPerm) {
    await canUserCreate(ctx.getUserId(), ctx.resourceFqName).then((r: boolean) => {
      hasPerm = r;
    });
  }
  if (hasPerm) {
    type ObjectKey = keyof (typeof rows)[0];
    const k = PathAttributeName as ObjectKey;
    for (let i = 0; i < rows.length; ++i) {
      const r: object = rows[i];
      await hardDeleteRow(tableName, [[PathAttributeName, r[k]]], ctx);
    }
    await insertRows(tableName, rows, ctx);
  } else {
    throw new UnauthorisedError();
  }
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
  callback: Function,
  ctx: DbContext
) {
  const alias: string = tableName.toLowerCase();
  const queryStr: string = withNotDeletedClause(
    queryObj != undefined ? objectToWhereClause(queryObj, alias) : ''
  );
  let ownersJoinCond: string[] | undefined;
  let ot: string = '';
  let otAlias: string = '';
  if (!ctx.inKernelMode) {
    const userId = ctx.getUserId();
    const fqName = ctx.resourceFqName;
    let hasGlobalPerms: boolean = ctx.inKernelMode;
    await canUserRead(userId, fqName).then((r: boolean) => {
      hasGlobalPerms = r;
    });
    if (hasGlobalPerms) {
      if (ctx.isForUpdate()) {
        await canUserUpdate(userId, fqName).then((r: boolean) => {
          hasGlobalPerms = r;
        });
      } else if (ctx.isForDelete()) {
        await canUserDelete(userId, fqName).then((r: boolean) => {
          hasGlobalPerms = r;
        });
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
  }
  const selCols = new Array<string>();
  colNamesToSelect.forEach((s: string) => {
    selCols.push(`${alias}.${s}`);
  });
  selCols.push(`${alias}.${PathAttributeName}`);

  const qb: SelectQueryBuilder<any> = getDatasourceForTransaction(ctx.txnId)
    .createQueryBuilder()
    .select(selCols.join(','))
    .from(tableName, alias);
  if (ownersJoinCond) {
    qb.innerJoin(ot, otAlias, ownersJoinCond.join(' AND '));
  }
  qb.where(queryStr, queryVals);
  await qb.getRawMany().then((result: any) => callback(result));
}

const NotDeletedClause: string = `${DeletedFlagAttributeName} = false`;

function withNotDeletedClause(sql: string): string {
  if (sql == '') {
    return NotDeletedClause;
  } else {
    return `${sql} AND ${NotDeletedClause}`;
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
  callback: Function,
  ctx: DbContext
) {
  const alias: string = tableName.toLowerCase();
  const connAlias: string = connInfo.connectionTable.toLowerCase();
  await getDatasourceForTransaction(ctx.txnId)
    .createQueryBuilder()
    .select()
    .from(tableName, alias)
    .where(objectToWhereClause(queryObj, alias), queryVals)
    .innerJoin(
      connInfo.connectionTable,
      connAlias,
      buildQueryFromConnnectionInfo(connAlias, alias, connInfo)
    )
    .getRawMany()
    .then((result: any) => callback(result));
}

const transactionsDb: Map<string, QueryRunner> = new Map<string, QueryRunner>();

export function startDbTransaction(): string {
  if (defaultDataSource != undefined) {
    const queryRunner = defaultDataSource.createQueryRunner();
    queryRunner.startTransaction();
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
          logger.error(`failed to commit transaction ${txnId} - ${reason}`);
        });
      else
        await qr.rollbackTransaction().catch((reason: any) => {
          logger.error(`failed to rollback transaction ${txnId} - ${reason}`);
        });
    } finally {
      qr.release();
      transactionsDb.delete(txnId);
    }
  }
}
