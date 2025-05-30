import { DataSource, EntityManager, QueryRunner, Table, TableColumnOptions } from 'typeorm';
import { logger } from '../../logger.js';
import { modulesAsDbSchema, TableSchema } from './dbutil.js';
import chalk from 'chalk';

let defaultDataSource: DataSource | undefined;

export const PathAttributeName: string = '__path__';
export const DeletedFlagAttributeName: string = '__is_deleted__';

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
              name: ts.name + '_owners',
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
                  name: 'can_read',
                  type: 'boolean',
                  default: true,
                },
                {
                  name: 'can_write',
                  type: 'boolean',
                  default: true,
                },
                {
                  name: 'can_delete',
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

export async function insertRows(tableName: string, rows: object[], txnId?: string): Promise<void> {
  await getDatasourceForTransaction(txnId)
    .createQueryBuilder()
    .insert()
    .into(tableName)
    .values(rows)
    .execute();
}

export async function insertRow(tableName: string, row: object, txnId?: string): Promise<void> {
  const rows: Array<object> = new Array<object>();
  rows.push(row);
  await insertRows(tableName, rows, txnId);
}

export async function upsertRows(tableName: string, rows: object[], txnId?: string): Promise<void> {
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

  type ObjectKey = keyof (typeof rows)[0];
  const k = PathAttributeName as ObjectKey;
  for (let i = 0; i < rows.length; ++i) {
    const r: object = rows[i];
    await hardDeleteRow(tableName, [[PathAttributeName, r[k]]], txnId);
  }
  await insertRows(tableName, rows, txnId);
}

export async function upsertRow(tableName: string, row: object, txnId?: string): Promise<void> {
  const rows: Array<object> = new Array<object>();
  rows.push(row);
  await upsertRows(tableName, rows, txnId);
}

export async function updateRow(
  tableName: string,
  queryObj: object,
  queryVals: object,
  updateObj: object,
  txnId?: string
): Promise<boolean> {
  await getDatasourceForTransaction(txnId)
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
  return ss.join('AND');
}

export async function hardDeleteRow(tableName: string, queryObject: QueryObject, txnId?: string) {
  const clause = queryObjectAsWhereClause(queryObject);
  await getDatasourceForTransaction(txnId)
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
  callback: Function,
  txtId?: string
) {
  const alias: string = tableName.toLowerCase();
  const queryStr: string = withNotDeletedClause(
    queryObj != undefined ? objectToWhereClause(queryObj, alias) : ''
  );
  await getDatasourceForTransaction(txtId)
    .createQueryBuilder()
    .select()
    .from(tableName, alias)
    .where(queryStr, queryVals)
    .getRawMany()
    .then((result: any) => callback(result));
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
  txtId?: string
) {
  const alias: string = tableName.toLowerCase();
  const connAlias: string = connInfo.connectionTable.toLowerCase();
  await getDatasourceForTransaction(txtId)
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

export function getDatasourceForTransaction(txnId: string | undefined): DataSource | EntityManager {
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
