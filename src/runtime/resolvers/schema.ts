import { DataSource, Table } from "typeorm";
import { logger } from "../logger.js";

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
        await queryRunner.createTable(
            new Table({
                name: "question",
                columns: [
                    {
                        name: "id",
                        type: "int",
                        isPrimary: true,
                    },
                    {
                        name: "name",
                        type: "varchar",
                    },
                ],
            }),
            true,
        )
    }
}