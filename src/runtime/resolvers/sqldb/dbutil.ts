import { TableColumnOptions, TableIndexOptions } from 'typeorm';
import {
    AttributeSpec, EntityEntry, fetchModule, getAttributeDefaultValue, getAttributeLength,
    getModuleNames, isIdAttribute, isIndexedAttribute, isOptionalAttribute, isUniqueAttribute,
    ModuleEntry, RecordSchema, RuntimeModule
} from '../../module.js';

export type TableSchema = {
    name: string;
    columns: TableSpec;
};

export function modulesAsDbSchema(): TableSchema[] {
    const result: TableSchema[] = new Array<TableSchema>();
    getModuleNames().forEach((n: string) => {
        const mod: RuntimeModule = fetchModule(n);
        const modEntries: ModuleEntry[] = mod.getEntityEntries();
        const entities: EntityEntry[] = modEntries as EntityEntry[];
        entities.forEach((ent: EntityEntry) => {
            const tspec: TableSchema = {
                name: n + '_' + ent.name,
                columns: entitySchemaToTable(ent.schema),
            };
            result.push(tspec);
        });
    });
    return result;
}

export type TableSpec = {
    columns: TableColumnOptions[];
    indices: Array<TableIndexOptions>;
    idColumns: Map<string, AttributeSpec>;
};

function entitySchemaToTable(scm: RecordSchema): TableSpec {
    const cols: Array<TableColumnOptions> = new Array<TableColumnOptions>();
    const indices: Array<TableIndexOptions> = new Array<TableIndexOptions>();
    const idCols: Map<string, AttributeSpec> = new Map<string, AttributeSpec>();
    scm.forEach((attrSpec: AttributeSpec, attrName: string) => {
        let d: any = getAttributeDefaultValue(attrSpec);
        const autoUuid: boolean = d && d == 'uuid()' ? true : false;
        const autoIncr: boolean = !autoUuid && d && d == 'autoincrement()' ? true : false;
        if (autoUuid || autoIncr) d = undefined;
        let genStrat: 'uuid' | 'increment' | 'rowid' | 'identity' = 'identity';
        if (autoIncr) genStrat = 'increment';
        else if (autoUuid) genStrat = 'uuid';
        const colOpt: TableColumnOptions = {
            name: attrName,
            type: asSqlType(attrSpec.type),
            isPrimary: genStrat == 'increment',
            default: d,
            isUnique: isUniqueAttribute(attrSpec),
            isNullable: !isOptionalAttribute(attrSpec),
            isGenerated: autoUuid || autoIncr,
            isArray: false,
        };
        if (colOpt.isGenerated) {
            colOpt.generationStrategy = genStrat;
        }
        const len: number | undefined = getAttributeLength(attrSpec);
        if (len != undefined) {
            colOpt.length = len.toString();
        }
        cols.push(colOpt);
        const isId: boolean = isIdAttribute(attrSpec);
        if (isId) {
            idCols.set(attrName, attrSpec);
        }
        if (isIndexedAttribute(attrSpec) || isId) {
            indices.push({ columnNames: [attrName] });
        }
    });
    return { columns: cols, indices: indices, idColumns: idCols };
}

export function asSqlType(type: string): string {
    if (type == 'String' || type == 'Email') return 'varchar';
    else if (type == 'Int') return 'integer';
    else return type.toLowerCase();
}
