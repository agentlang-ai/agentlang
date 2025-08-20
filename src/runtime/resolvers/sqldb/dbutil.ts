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
  Record,
  RecordSchema,
  Relationship,
  Module,
} from '../../module.js';
import { buildGraph } from '../../relgraph.js';
import { makeFqName } from '../../util.js';
import { DeletedFlagAttributeName, ParentAttributeName, PathAttributeName } from '../../defs.js';

export const DefaultVectorDimension = 1536

export type TableSchema = {
  name: string;
  columns: TableSpec;
};

export function asTableReference(moduleName: string, ref: string): string {
  const modName = moduleName.replace('.', '_')
  if (ref.indexOf('.') > 0) {
    const parts = ref.split('.')
    const r = `${modName}_${parts[0]}`.toLowerCase()
    const colref = parts.slice(1).join('.')
    return `"${r}"."${colref}"`;
  } else {
    return `${modName}_${ref}`.toLowerCase()
  }
}

export function modulesAsDbSchema(): TableSchema[] {
  const result: TableSchema[] = new Array<TableSchema>();
  getModuleNames().forEach((n: string) => {
    buildGraph(n);
    const mod: Module = fetchModule(n);
    const entities: Record[] = mod.getEntityEntries();
    const betRels: Record[] = mod
      .getBetweenRelationshipEntries()
      .filter((v: Relationship) => v.isManyToMany());
    const allEntries: Record[] = entities.concat(betRels) as Record[];
    allEntries.forEach((ent: Record) => {
      const tspec: TableSchema = {
        name: asTableReference(n, ent.name),
        columns: entitySchemaToTable(ent.schema),
      };
      result.push(tspec);
    });
  });
  return result;
}

export type OrmSchema = {
  entities: EntitySchema[],
  vectorEntities: EntitySchema[]
}

export function modulesAsOrmSchema(): OrmSchema {
  const ents: EntitySchema[] = [];
  const vects: EntitySchema[] = []
  getModuleNames().forEach((n: string) => {
    buildGraph(n);
    const mod: Module = fetchModule(n);
    const entities: Record[] = mod.getEntityEntries()
    const rels: Record[] = mod.getBetweenRelationshipEntriesThatNeedStore();
    entities.concat(rels).forEach((entry: Record) => {
      ents.push(new EntitySchema<any>(ormSchemaFromRecordSchema(n, entry)))
      const ownerEntry = createOwnersEntity(entry)
      ents.push(new EntitySchema<any>(ormSchemaFromRecordSchema(n, ownerEntry, true)))
      if (entry.getFullTextSearchAttributes()) {
        const vectorEntry = createVectorEntity(entry)
        vects.push(new EntitySchema<any>(ormSchemaFromRecordSchema(n, vectorEntry, true)))
      }
    })
  })
  return { entities: ents, vectorEntities: vects }
}

function ormSchemaFromRecordSchema(moduleName: string, entry: Record, hasOwnPk?: boolean): EntitySchemaOptions<any> {
  const entityName = entry.name
  const scm: RecordSchema = entry.schema
  const result = new EntitySchemaOptions<any>()
  result.tableName = asTableReference(moduleName, entityName)
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
      nullable: isOptionalAttribute(attrSpec)
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
  if (needPath) {
    cols.set(PathAttributeName, { type: "varchar", primary: true })
    cols.set(ParentAttributeName, { type: "varchar", default: '', indexed: true })
  }
  cols.set(DeletedFlagAttributeName, { type: "boolean", default: false })
  const allBetRels = getAllBetweenRelationships()
  const relsSpec = new Map()
  const fqName = makeFqName(moduleName, entityName)
  getAllOneToOneRelationshipsForEntity(moduleName, entityName, allBetRels)
    .forEach((re: Relationship) => {
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
  const compUqs = entry.getCompositeUniqueAttributes()
  if (compUqs) {
    indices.push(Object.fromEntries(new Map()
      .set('name', `${result.tableName}__comp__index`)
      .set('columns', compUqs)
      .set('unique', true)))
  }
  if (indices.length > 0) {
    result.indices = indices
  }
  return result
}

export const OwnersSuffix = '_owners'
export const VectorSuffix = '_vector'

function createOwnersEntity(entry: Record): Record {
  const ownersEntry = new Record(`${entry.name}${OwnersSuffix}`, entry.moduleName)
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

function createVectorEntity(entry: Record): Record {
  const ownersEntry = new Record(`${entry.name}${VectorSuffix}`, entry.moduleName)
  return ownersEntry.addAttribute('id', { type: 'String', properties: new Map().set('id', true) })
    .addAttribute('embedding', { type: `vector(${DefaultVectorDimension})` })
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
  const t = type.toLowerCase()
  if (t == 'string' || t == 'datetime' || t == 'email' || t == 'url'
    || t == 'map' || t == 'any' || t == 'path')
    return 'varchar';
  else if (t == 'int') return 'integer';
  else if (t == 'number') return 'double precision'
  else if (!isBuiltInType(type)) return 'varchar';
  else return t as ColumnType;
}

export function isSqlTrue(v: true | false | 1 | 0): boolean {
  return v == true || v == 1;
}
