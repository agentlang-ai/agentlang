import { DataSource, Table, TableColumnOptions } from 'typeorm';
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
    await defaultDataSource
      .initialize()
      .then(() => {
        createTables().then((_: void) => {
          const msg: string = 'Database schema initialized';
          logger.debug(msg);
          console.log(chalk.gray(msg));
        });
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
  } else {
    throw new Error('Datasource not initialized, cannot create tables.');
  }
}

export async function insertRows(tableName: string, rows: object[]): Promise<void> {
  if (defaultDataSource != undefined) {
    await defaultDataSource.createQueryBuilder().insert().into(tableName).values(rows).execute();
  }
}

export async function insertRow(tableName: string, row: object): Promise<void> {
  const rows: Array<object> = new Array<object>();
  rows.push(row);
  await insertRows(tableName, rows);
}

export async function updateRow(
  tableName: string,
  queryObj: object,
  queryVals: object,
  updateObj: object
): Promise<boolean> {
  if (defaultDataSource != undefined) {
    await defaultDataSource
      .createQueryBuilder()
      .update(tableName)
      .set(updateObj)
      .where(objectToWhereClause(queryObj), queryVals)
      .execute();
    return true;
  }
  return false;
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
  callback: Function
) {
  if (defaultDataSource != undefined) {
    const alias: string = tableName.toLowerCase();
    const queryStr: string = withNotDeletedClause(
      queryObj != undefined ? objectToWhereClause(queryObj, alias) : ''
    );
    await defaultDataSource
      .createQueryBuilder()
      .select()
      .from(tableName, alias)
      .where(queryStr, queryVals)
      .getRawMany()
      .then((result: any) => callback(result));
  }
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
  callback: Function
) {
  if (defaultDataSource != undefined) {
    const alias: string = tableName.toLowerCase();
    const connAlias: string = connInfo.connectionTable.toLowerCase();
    await defaultDataSource
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
}
