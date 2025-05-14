import { DataSource, Table } from "typeorm";
import { logger } from "../../logger.js";
import { modulesAsDbSchema, TableSchema } from "./dbutil.js";

let defaultDataSource: DataSource | undefined

export const PathAttributeName: string = "__path__"

export async function initDefaultDatabase() {
    if (defaultDataSource == undefined) {
        defaultDataSource = new DataSource({
            type: "sqlite",
            database: "db"
        })
        defaultDataSource.initialize()
            .then(() => {
                createTables().then((_: void) => {
                    logger.debug("Data Source has been initialized!")
                })
            })
            .catch((err) => {
                logger.error("Error during Data Source initialization", err)
            })
    }
}

async function createTables(): Promise<void> {
    if (defaultDataSource != undefined) {
        const queryRunner = defaultDataSource.createQueryRunner()
        const tableSpecs: TableSchema[] = modulesAsDbSchema()
        tableSpecs.forEach((ts: TableSchema) => {
            ts.columns.columns.push({
                name: PathAttributeName,
                type: "varchar",
                isUnique: true,
                isNullable: false
            })
            ts.columns.indices.push({columnNames: [PathAttributeName]})
            queryRunner.createTable(new Table({
                name: ts.name,
                columns: ts.columns.columns,
                indices: ts.columns.indices
            }), true)
            queryRunner.createTable(new Table({
                name: ts.name + "_owners",
                columns: [{
                    name: "path",
                    type: "varchar",
                    isPrimary: true
                },
                {
                    name: "user_id",
                    type: "varchar"
                },
                {
                    name: "type",
                    type: "char(1)",
                    default: "'u'"
                },
                {
                    name: "can_read",
                    type: "boolean",
                    default: true
                },
                {
                    name: "can_write",
                    type: "boolean",
                    default: true
                },
                {
                    name: "can_delete",
                    type: "boolean",
                    default: true
                }
                ]
            }), true)
        })
    } else {
        throw new Error("Datasource not initialized, cannot create tables.")
    }
}