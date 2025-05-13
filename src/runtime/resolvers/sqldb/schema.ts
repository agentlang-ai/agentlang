import { DataSource, Table } from "typeorm";
import { logger } from "../../logger.js";
import { modulesAsDbSchema, TableSchema, asSqlType } from "./dbutil.js";
import { AttributeSpec } from "../../module.js";

let defaultDataSource: DataSource | undefined;

export async function initDefaultDatabase() {
    if (defaultDataSource == undefined) {
        defaultDataSource = new DataSource({
            type: "sqlite",
            database: "db"
        })
        defaultDataSource.initialize()
            .then(() => {
                logger.debug("Data Source has been initialized!")
                createTables()
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
            let idCol: [string, AttributeSpec] | undefined = ts.columns.idColumns.entries().next().value
            queryRunner.createTable(new Table({
                name: ts.name,
                columns: ts.columns.columns,
                indices: ts.columns.indices
            }), true)
            if (idCol != undefined) {
                queryRunner.createTable(new Table({
                    name: ts.name + "_paths",
                    columns: [{
                        name: "path",
                        type: "varchar",
                        isPrimary: true
                    },
                    {
                        name: "id",
                        type: asSqlType(idCol[1].type)
                    }]
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
            }
        })
    } else {
        throw new Error("Datasource not initialized, cannot create tables.")
    }
}