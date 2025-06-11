import { ColumnType, EntitySchema, EntitySchemaColumnOptions, EntitySchemaOptions, TableColumnOptions, TableForeignKey, TableIndexOptions } from 'typeorm';
import {
  AttributeSpec,
  fetchModule,
  getAllBetweenRelationships,
  getAllOneToOneRelationshipsForEntity,
  getAttributeDefaultValue,
  getAttributeLength,
  getFkSpec,
  getModuleNames,
  isArrayAttribute,
  isBuiltInType,
  isIdAttribute,
  isIndexedAttribute,
  isOptionalAttribute,
  isUniqueAttribute,
  RecordEntry,
  RecordSchema,
  RelationshipEntry,
  RuntimeModule,
} from '../../module.js';
import { buildGraph } from '../../relgraph.js';
import { DeletedFlagAttributeName, PathAttributeName } from './database.js';
import { makeFqName } from '../../util.js';

export type TableSchema = {
  name: string;
  columns: TableSpec;
};

export function asTableName(moduleName: string, entityName: string): string {
  return `${moduleName}_${entityName}`;
}

export function modulesAsDbSchema(): TableSchema[] {
  const result: TableSchema[] = new Array<TableSchema>();
  getModuleNames().forEach((n: string) => {
    buildGraph(n);
    const mod: RuntimeModule = fetchModule(n);
    const entities: RecordEntry[] = mod.getEntityEntries();
    const betRels: RecordEntry[] = mod
      .getBetweenRelationshipEntries()
      .filter((v: RelationshipEntry) => v.isManyToMany());
    const allEntries: RecordEntry[] = entities.concat(betRels) as RecordEntry[];
    allEntries.forEach((ent: RecordEntry) => {
      const tspec: TableSchema = {
        name: asTableName(n, ent.name),
        columns: entitySchemaToTable(ent.schema),
      };
      result.push(tspec);
    });
  });
  return result;
}

export function modulesAsOrmSchema(): EntitySchema[] {
  const result: EntitySchema[] = new Array<EntitySchema>();
  getModuleNames().forEach((n: string) => {
    buildGraph(n);
    const mod: RuntimeModule = fetchModule(n);
    const entities: RecordEntry[] = mod.getEntityEntries()
    const rels: RecordEntry[] = mod.getBetweenRelationshipEntriesThatNeedStore();
    entities.concat(rels).forEach((entry: RecordEntry) => {
      result.push(new EntitySchema<any>(ormSchemaFromRecordSchema(n, entry)))
      const ownerEntry = createOwnersEntity(entry)
      result.push(new EntitySchema<any>(ormSchemaFromRecordSchema(n, ownerEntry, true)))
    })
  })
  return result
}

function ormSchemaFromRecordSchema(moduleName: string, entry: RecordEntry, hasOwnPk?: boolean): EntitySchemaOptions<any> {
  const entityName = entry.name
  const scm: RecordSchema = entry.schema
  const result = new EntitySchemaOptions<any>()
  result.tableName = asTableName(moduleName, entityName)
  result.name = result.tableName
  const cols = new Map<string, any>()
  const indices = new Array<any>()
  const chkforpk: boolean = hasOwnPk == undefined ? false : true
  let needPath = true
  scm.forEach((attrSpec: AttributeSpec, attrName: string) => {
    let d: any = getAttributeDefaultValue(attrSpec);
    const autoUuid: boolean = d && d == 'uuid()' ? true : false;
    const autoIncr: boolean = !autoUuid && d && d == 'autoincrement()' ? true : false;
    if (autoUuid || autoIncr) d = undefined;
    let genStrat: 'uuid' | 'increment' | undefined = undefined
    if (autoIncr) genStrat = 'increment';
    else if (autoUuid) genStrat = 'uuid';
    const isuq: boolean = isUniqueAttribute(attrSpec)
    const ispk: boolean = chkforpk && isIdAttribute(attrSpec)
    const colDef: EntitySchemaColumnOptions = {
      type: asSqlType(attrSpec.type),
      generated: genStrat,
      default: d,
      unique: isuq,
      primary: ispk,
      nullable: isOptionalAttribute(attrSpec),
      array: isArrayAttribute(attrSpec)
    };
    if (ispk) {
      needPath = false
    }
    if (isIndexedAttribute(attrSpec)) {
      indices.push(Object.fromEntries(new Map()
        .set('name', `${result.tableName}_${attrName}_index`)
        .set('columns', [attrName])
        .set('unique', isuq)))
    }
    cols.set(attrName, colDef)
  });
  if (needPath) cols.set(PathAttributeName, { type: "varchar", primary: true })
  cols.set(DeletedFlagAttributeName, { type: "boolean", default: false })
  const allBetRels = getAllBetweenRelationships()
  const relsSpec = new Map()
  const fqName = makeFqName(moduleName, entityName)
  getAllOneToOneRelationshipsForEntity(moduleName, entityName, allBetRels)
    .forEach((re: RelationshipEntry) => {
      const colName = re.getInverseAliasForName(fqName)
      if (cols.has(colName)) {
        throw new Error(`Cannot establish relationship ${re.name}, ${entityName}.${colName} already exists`)
      }
      cols.set(colName, { type: "varchar", unique: true })
    })
  if (relsSpec.size > 0) {
    result.relations = Object.fromEntries(relsSpec)
  }
  result.columns = Object.fromEntries(cols)
  if (indices.length > 0) {
    result.indices = indices
  }
  return result
}

function createOwnersEntity(entry: RecordEntry): RecordEntry {
  const ownersEntry = new RecordEntry(`${entry.name}_owners`, entry.moduleName)
  const permProps = new Map().set('default', true)
  return ownersEntry.addAttribute('id', { type: 'UUID', properties: new Map().set('id', true) })
    .addAttribute('user_id', { type: 'String' })
    .addAttribute('type', { type: 'String', properties: new Map().set('default', 'o') })
    .addAttribute('c', { type: 'Boolean', properties: permProps })
    .addAttribute('r', { type: 'Boolean', properties: permProps })
    .addAttribute('u', { type: 'Boolean', properties: permProps })
    .addAttribute('d', { type: 'Boolean', properties: permProps })
    .addAttribute('path', { type: 'String', properties: new Map().set('indexed', true) })
}

export type TableSpec = {
  columns: TableColumnOptions[];
  indices: Array<TableIndexOptions>;
  idColumns: Map<string, AttributeSpec>;
  fks?: Array<TableForeignKey>;
};

function entitySchemaToTable(scm: RecordSchema): TableSpec {
  const cols: Array<TableColumnOptions> = new Array<TableColumnOptions>();
  const indices: Array<TableIndexOptions> = new Array<TableIndexOptions>();
  const idCols: Map<string, AttributeSpec> = new Map<string, AttributeSpec>();
  let fkSpecs: Array<TableForeignKey> | undefined;
  scm.forEach((attrSpec: AttributeSpec, attrName: string) => {
    let d: any = getAttributeDefaultValue(attrSpec);
    const autoUuid: boolean = d && d == 'uuid()' ? true : false;
    const autoIncr: boolean = !autoUuid && d && d == 'autoincrement()' ? true : false;
    if (autoUuid || autoIncr) d = undefined;
    let genStrat: 'uuid' | 'increment' | 'rowid' | 'identity' = 'identity';
    if (autoIncr) genStrat = 'increment';
    else if (autoUuid) genStrat = 'uuid';
    const fkSpec: string | undefined = getFkSpec(attrSpec);
    if (fkSpec != undefined) {
      const parts: string[] = fkSpec.split('.');
      if (parts.length != 2) {
        throw new Error(`Invalid reference - ${fkSpec}`);
      }
      if (fkSpecs == undefined) {
        fkSpecs = new Array<TableForeignKey>();
      }
      const fk: TableForeignKey = new TableForeignKey({
        columnNames: [attrName],
        referencedColumnNames: [parts[1]],
        referencedTableName: parts[0],
        onDelete: 'CASCADE',
      });
      fkSpecs.push(fk);
    }
    const colOpt: TableColumnOptions = {
      name: attrName,
      type: asSqlType(attrSpec.type) as string,
      isPrimary: genStrat == 'increment',
      default: d,
      isUnique: isUniqueAttribute(attrSpec),
      isNullable: isOptionalAttribute(attrSpec),
      isGenerated: autoUuid || autoIncr,
      isArray: isArrayAttribute(attrSpec),
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
  return { columns: cols, indices: indices, idColumns: idCols, fks: fkSpecs };
}

export function asSqlType(type: string): ColumnType {
  if (type == 'String' || type == 'Email' || type == 'URL') return 'varchar';
  else if (type == 'Int') return 'integer';
  else if (!isBuiltInType(type)) return 'varchar';
  else return type.toLowerCase() as ColumnType;
}

export function isSqlTrue(v: true | false | 1 | 0): boolean {
  return v == true || v == 1;
}
