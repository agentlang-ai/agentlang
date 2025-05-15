import { DataSource, Table, TableColumnOptions } from 'typeorm';
import { logger } from '../../logger.js';
import { modulesAsDbSchema, TableSchema } from './dbutil.js';
import chalk from 'chalk';

let defaultDataSource: DataSource | undefined;

export const PathAttributeName: string = '__path__';

export async function initDefaultDatabase() {
  if (defaultDataSource == undefined) {
    defaultDataSource = new DataSource({
      type: 'sqlite',
      database: 'db',
    });
    defaultDataSource
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
    tableSpecs.forEach((ts: TableSchema) => {
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
      if (hasPk) {
        ts.columns.indices.push({ columnNames: [PathAttributeName] });
      }
      queryRunner.createTable(
        new Table({
          name: ts.name,
          columns: ts.columns.columns,
          indices: ts.columns.indices,
        }),
        true
      );
      queryRunner.createTable(
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
      );
    });
  } else {
    throw new Error('Datasource not initialized, cannot create tables.');
  }
}

export async function insertRows(tableName: string, rows: Object[]): Promise<void> {
  if (defaultDataSource != undefined) {
    await defaultDataSource.createQueryBuilder().insert().into(tableName).values(rows).execute();
  }
}

export async function insertRow(tableName: string, row: Object): Promise<void> {
  const rows: Array<Object> = new Array<Object>();
  rows.push(row);
  await insertRows(tableName, rows);
}

function objectToWhereClause(tableName: string, queryObj: Object): string {
  const clauses: Array<string> = new Array<string>();
  Object.entries(queryObj).forEach((value: [string, any]) => {
    const op: string = value[1] as string;
    clauses.push(`${tableName}.${value[0]} ${op} :${value[0]}`);
  });
  return clauses.join(' AND ');
}

const EmptyResultPromise: Promise<any[]> = new Promise(function (resolve) {
  resolve(new Array<any[]>());
});

export async function getMany(
  tableName: string,
  queryObj: Object,
  queryVals: Object
): Promise<any[]> {
  if (defaultDataSource != undefined) {
    return defaultDataSource
      .createQueryBuilder()
      .select()
      .from(tableName, 'user')
      .where(objectToWhereClause('user', queryObj), queryVals)
      .getRawMany();
  } else {
    return EmptyResultPromise;
  }
}
