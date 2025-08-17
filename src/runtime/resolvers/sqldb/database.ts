import { DataSource, EntityManager, EntitySchema, QueryRunner, SelectQueryBuilder } from 'typeorm';
import { logger } from '../../logger.js';
import {
	DefaultVectorDimension,
	modulesAsOrmSchema,
	OwnersSuffix,
	VectorSuffix,
} from './dbutil.js';
import { DefaultAuthInfo, ResolverAuthInfo } from '../authinfo.js';
import { canUserCreate, canUserDelete, canUserRead, canUserUpdate } from '../../modules/auth.js';
import { Environment, GlobalEnvironment } from '../../interpreter.js';
import {
	Instance,
	InstanceAttributes,
	newInstanceAttributes,
	RbacPermissionFlag,
	RbacSpecification,
	Relationship,
} from '../../module.js';
import { isString } from '../../util.js';
import {
  DeletedFlagAttributeName,
  ForceReadPermFlag,
  PathAttributeName,
  UnauthorisedError,
} from '../../defs.js';

export let defaultDataSource: DataSource | undefined;

export class DbContext {
	txnId: string | undefined;
	authInfo: ResolverAuthInfo;
	private inKernelMode: boolean = false;
	resourceFqName: string;
	activeEnv: Environment;
	private needAuthCheckFlag: boolean = true;
	rbacRules: RbacSpecification[] | undefined;

	constructor(
		resourceFqName: string,
		authInfo: ResolverAuthInfo,
		activeEnv: Environment,
		txnId?: string,
		inKernelMode?: boolean,
		rbacRules?: RbacSpecification[]
	) {
		this.resourceFqName = resourceFqName;
		this.authInfo = authInfo;
		this.activeEnv = activeEnv;
		this.txnId = txnId;
		if (inKernelMode != undefined) {
			this.inKernelMode = inKernelMode;
		}
		this.rbacRules = rbacRules;
	}
	private static GlobalDbContext: DbContext | undefined;

	static getGlobalContext(): DbContext {
		if (DbContext.GlobalDbContext == undefined) {
			DbContext.GlobalDbContext = new DbContext(
				'',
				DefaultAuthInfo,
				GlobalEnvironment,
				undefined,
				true
			);
		}
		return DbContext.GlobalDbContext;
	}

	// Shallow clone
	clone(): DbContext {
		return new DbContext(
			this.resourceFqName,
			this.authInfo,
			this.activeEnv,
			this.txnId,
			this.inKernelMode
		);
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

	setResourceFqNameFrom(inst: Instance): DbContext {
		this.resourceFqName = inst.getFqName();
		return this;
	}

	setNeedAuthCheck(flag: boolean): DbContext {
		this.needAuthCheckFlag = flag;
		return this;
	}

	switchAuthCheck(flag: boolean): boolean {
		const old = this.needAuthCheckFlag;
		this.needAuthCheckFlag = flag;
		return old;
	}

	isPermitted(): boolean {
		return this.inKernelMode || !this.needAuthCheckFlag;
	}

	isInKernelMode(): boolean {
		return this.inKernelMode;
	}

  forceReadPermission(): boolean {
    return this.activeEnv.lookup(ForceReadPermFlag);
  }
}

export type JoinOn = {
	attributeName: string;
	operator: string;
	attributeValue: any;
};

export function makeJoinOn(attrName: string, attrValue: any, opr: string = '='): JoinOn {
	return {
		attributeName: attrName,
		attributeValue: attrValue,
		operator: opr,
	};
}

export type JoinClause = {
	tableName: string;
	queryObject?: object;
	queryValues?: object;
	joinOn: JoinOn | JoinOn[];
};

export type DatabaseConfig = {
	type: string;
	host?: string;
	username?: string;
	password?: string;
	dbname?: string;
	port?: number;
};

function mkDbName(): string {
	return process.env.AGENTLANG_DB_NAME || `db-${Date.now()}`;
}

function makePostgresDataSource(
	entities: EntitySchema[],
	config: DatabaseConfig | undefined,
	synchronize: boolean = true
): DataSource {
	return new DataSource({
		type: 'postgres',
		host: process.env.POSTGRES_HOST || config?.host || 'localhost',
		port: getPostgressEnvPort() || config?.port || 5432,
		username: process.env.POSTGRES_USER || config?.username || 'postgres',
		password: process.env.POSTGRES_PASSWORD || config?.password || 'postgres',
		database: process.env.POSTGRES_DB || config?.dbname || 'postgres',
		synchronize: synchronize,
		entities: entities,
	});
}

function getPostgressEnvPort(): number | undefined {
	const s: string | undefined = process.env.POSTGRES_PORT;
	if (s) {
		return Number(s);
	} else {
		return undefined;
	}
}

function makeSqliteDataSource(
	entities: EntitySchema[],
	config: DatabaseConfig | undefined,
	synchronize: boolean = true
): DataSource {
	return new DataSource({
		type: 'sqlite',
		database: config?.dbname || mkDbName(),
		synchronize: synchronize,
		entities: entities,
	});
}

function isBrowser(): boolean {
	// window for DOM pages, self+importScripts for web workers
	return (
		(typeof window !== 'undefined' && typeof (window as any).document !== 'undefined') ||
		(typeof self !== 'undefined' && typeof (self as any).importScripts === 'function')
	);
}

function defaultLocateFile(file: string): string {
	// Out-of-the-box: use the official CDN in browsers.
	if (isBrowser()) {
		return `https://sql.js.org/dist/${file}`;
	}
	// Node: resolve from node_modules/sql.js/dist
	try {
		const path = require('path');
		const base = require.resolve('sql.js/dist/sql-wasm.js');
		return path.join(path.dirname(base), file);
	} catch {
		return file;
	}
}

function makeSqljsDataSource(
	entities: EntitySchema[],
	_config: DatabaseConfig | undefined,
	synchronize: boolean = true
): DataSource {
	return new DataSource({
		type: 'sqljs',
		autoSave: false,
		sqlJsConfig: {
			locateFile: defaultLocateFile,
		},
		synchronize: synchronize,
		entities: entities,
	});
}

const DbType = 'sqlite';

function getDbType(config?: DatabaseConfig): string {
	if (config?.type) return config.type;
	let envType: string | undefined;
	try {
		if (typeof process !== 'undefined' && process.env) {
			envType = process.env.AL_DB_TYPE;
		}
	} catch {}
	if (envType) return envType;
	if (isBrowser()) return 'sqljs';
	return DbType;
}

function getDsFunction(
	config: DatabaseConfig | undefined
): (
	entities: EntitySchema<any>[],
	config: DatabaseConfig | undefined,
	synchronize?: boolean | undefined
) => DataSource {
	switch (getDbType(config)) {
		case 'sqlite':
			return makeSqliteDataSource;
		case 'postgres':
			return makePostgresDataSource;
		case 'sqljs':
			return makeSqljsDataSource;
		default:
			throw new Error(`Unsupported database type - ${config?.type}`);
	}
}

export function isUsingSqlite(): boolean {
	return getDbType() == 'sqlite';
}

export function isUsingSqljs(): boolean {
	return getDbType() == 'sqljs';
}

export function isVectorStoreSupported(): boolean {
	// Only Postgres supports pgvector
	return getDbType() === 'postgres';
}

export async function initDatabase(config: DatabaseConfig | undefined) {
	if (defaultDataSource == undefined) {
		const mkds = getDsFunction(config);
		if (mkds) {
			const ormScm = modulesAsOrmSchema();
			defaultDataSource = mkds(ormScm.entities, config) as DataSource;
			await defaultDataSource.initialize();
			const vectEnts = ormScm.vectorEntities.map((es: EntitySchema) => {
				return es.options.name;
			});
			if (vectEnts.length > 0) {
				await initVectorStore(vectEnts, DbContext.getGlobalContext());
			}
		} else {
			throw new Error(`Unsupported database type - ${DbType}`);
		}
	}
}

export async function resetDefaultDatabase() {
	if (defaultDataSource) {
		await defaultDataSource.destroy();
		defaultDataSource = undefined;
	}
}

function ownersTable(tableName: string): string {
	return (tableName.replace('.', '_') + OwnersSuffix).toLowerCase();
}

async function insertRowsHelper(
	tableName: string,
	rows: object[],
	ctx: DbContext,
	doUpsert: boolean
): Promise<void> {
	const repo = getDatasourceForTransaction(ctx.txnId).getRepository(tableName);
	if (doUpsert) await repo.save(rows);
	else await repo.insert(rows);
}

export async function addRowForFullTextSearch(
	tableName: string,
	id: string,
	vect: number[],
	ctx: DbContext
) {
	if (!isVectorStoreSupported()) return;
	try {
		const vecTableName = tableName + VectorSuffix;
		const qb = getDatasourceForTransaction(ctx.txnId).createQueryBuilder();
		const { default: pgvector } = await import('pgvector');
		await qb
			.insert()
			.into(vecTableName)
			.values([{ id: id, embedding: pgvector.toSql(vect) }])
			.execute();
	} catch (err: any) {
		logger.error(`Failed to add row to vector store - ${err}`);
	}
}

export async function initVectorStore(tableNames: string[], ctx: DbContext) {
	if (!isVectorStoreSupported()) {
		logger.info(`Vector store not supported for ${getDbType()}, skipping init...`);
		return;
	}
	let notInited = true;
	tableNames.forEach(async (vecTableName: string) => {
		const vecRepo = getDatasourceForTransaction(ctx.txnId).getRepository(vecTableName);
		if (notInited) {
			let failure = false;
			try {
				await vecRepo.query('CREATE EXTENSION IF NOT EXISTS vector');
			} catch (err: any) {
				logger.error(`Failed to initialize vector store - ${err}`);
				failure = true;
			}
			if (failure) return;
			notInited = false;
		}
		await vecRepo.query(
			`CREATE TABLE IF NOT EXISTS ${vecTableName} (
          id varchar PRIMARY KEY,
          embedding vector(${DefaultVectorDimension}),
          __is_deleted__ boolean default false
        )`
		);
	});
}

export async function vectorStoreSearch(
	tableName: string,
	searchVec: number[],
	limit: number,
	ctx: DbContext
): Promise<any> {
	if (!isVectorStoreSupported()) {
		// Not supported on sqljs/sqlite
		return [];
	}
	try {
		const vecTableName = tableName + VectorSuffix;
		const qb = getDatasourceForTransaction(ctx.txnId).getRepository(tableName).manager;
		const { default: pgvector } = await import('pgvector');
		return await qb.query(
			`select id from ${vecTableName} order by embedding <-> $1 LIMIT ${limit}`,
			[pgvector.toSql(searchVec)]
		);
	} catch (err: any) {
		logger.error(`Vector store search failed - ${err}`);
	}
}

export async function vectorStoreSearchEntryExists(
	tableName: string,
	id: string,
	ctx: DbContext
): Promise<boolean> {
	if (!isVectorStoreSupported()) return false;
	try {
		const qb = getDatasourceForTransaction(ctx.txnId).getRepository(tableName).manager;
		const vecTableName = tableName + VectorSuffix;
		const result: any[] = await qb.query(`select id from ${vecTableName} where id = $1`, [id]);
		return result != null && result.length > 0;
	} catch (err: any) {
		logger.error(`Vector store search failed - ${err}`);
	}
	return false;
}

export async function deleteFullTextSearchEntry(tableName: string, id: string, ctx: DbContext) {
	if (!isVectorStoreSupported()) return;
	try {
		const qb = getDatasourceForTransaction(ctx.txnId).getRepository(tableName).manager;
		const vecTableName = tableName + VectorSuffix;
		await qb.query(`delete from ${vecTableName} where id = $1`, [id]);
	} catch (err: any) {
		logger.error(`Vector store delete failed - ${err}`);
	}
}

async function checkUserPerm(
	opr: RbacPermissionFlag,
	ctx: DbContext,
	instRows: object
): Promise<boolean> {
	let hasPerm = ctx.isPermitted();
	if (!hasPerm) {
		const userId = ctx.getUserId();
		let f: Function | undefined;
		switch (opr) {
			case RbacPermissionFlag.CREATE:
				f = canUserCreate;
				break;
			case RbacPermissionFlag.READ:
				f = canUserRead;
				break;
			case RbacPermissionFlag.UPDATE:
				f = canUserUpdate;
				break;
			case RbacPermissionFlag.DELETE:
				f = canUserDelete;
				break;
			default:
				f = undefined;
		}
		if (f != undefined) {
			hasPerm = await f(userId, ctx.resourceFqName, ctx.activeEnv);
		}
	}
	if (!hasPerm) {
		hasPerm = await isOwnerOfParent(instRows[PathKey], ctx);
	}
	return hasPerm;
}

async function checkCreatePermission(ctx: DbContext, inst: Instance): Promise<boolean> {
	const tmpCtx = ctx.clone().setResourceFqNameFrom(inst);
	return await checkUserPerm(
		RbacPermissionFlag.CREATE,
		tmpCtx,
		Object.fromEntries(inst.attributes)
	);
}

export async function insertRows(
	tableName: string,
	rows: object[],
	ctx: DbContext,
	doUpsert: boolean = false
): Promise<void> {
	let hasPerm = ctx.isPermitted();
	if (!hasPerm) {
		hasPerm = await checkUserPerm(RbacPermissionFlag.CREATE, ctx, rows[0]);
	}
	if (hasPerm) {
		await insertRowsHelper(tableName, rows, ctx, doUpsert);
		if (!doUpsert) {
			if (!ctx.isInKernelMode()) {
				await createOwnership(tableName, rows, ctx);
			} else if (ctx.forceReadPermission()) {
			  await createReadPermission(tableName, rows, ctx);
			}
			if (ctx.rbacRules) {
				for (let i = 0; i < ctx.rbacRules.length; ++i) {
					const rbacRule = ctx.rbacRules[i];
					const e = rbacRule.expression;
					if (e) {
						const [selfRef, userRef] = e.lhs.startsWith('this.') ? [e.lhs, e.rhs] : [e.rhs, e.lhs];
						if (userRef == 'auth.user') {
							const attr = selfRef.split('.')[1];
							for (let j = 0; j < rows.length; ++j) {
								const r: any = rows[j];
								const userId = r[attr];
								if (userId) {
									await createLimitedOwnership(tableName, [r], userId, rbacRule.permissions, ctx);
								}
							}
						}
					}
				}
			}
		}
	} else {
		throw new UnauthorisedError({ opr: 'insert', entity: tableName });
	}
}

export async function insertRow(
	tableName: string,
	row: object,
	ctx: DbContext,
	doUpsert: boolean
): Promise<void> {
	const rows: Array<object> = new Array<object>();
	rows.push(row);
	await insertRows(tableName, rows, ctx, doUpsert);
}

export async function insertBetweenRow(
	n: string,
	a1: string,
	a2: string,
	node1: Instance,
	node2: Instance,
	relEntry: Relationship,
	ctx: DbContext
): Promise<void> {
	let hasPerm = await checkCreatePermission(ctx, node1);
	if (hasPerm) {
		hasPerm = await checkCreatePermission(ctx, node2);
	}
	if (hasPerm) {
		const attrs: InstanceAttributes = newInstanceAttributes();
		const p1 = node1.attributes.get(PathAttributeName);
		const p2 = node2.attributes.get(PathAttributeName);
		attrs.set(a1, p1);
		attrs.set(a2, p2);
		attrs.set(PathAttributeName, crypto.randomUUID());
		if (relEntry.isOneToMany()) {
			attrs.set(relEntry.joinNodesAttributeName(), `${p1}_${p2}`);
		}
		const row = Object.fromEntries(attrs);
		await insertRow(n, row, ctx.clone().setNeedAuthCheck(false), false);
	} else {
		throw new UnauthorisedError({ opr: 'insert', entity: n });
	}
}

const PathKey = PathAttributeName as keyof object;

const AllPerms = new Set<RbacPermissionFlag>()
	.add(RbacPermissionFlag.CREATE)
	.add(RbacPermissionFlag.READ)
	.add(RbacPermissionFlag.UPDATE)
	.add(RbacPermissionFlag.DELETE);

async function createOwnership(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
	await createLimitedOwnership(tableName, rows, ctx.authInfo.userId, AllPerms, ctx);
}

const ReadPermOnly = new Set<RbacPermissionFlag>().add(RbacPermissionFlag.READ);

async function createReadPermission(
  tableName: string,
  rows: object[],
  ctx: DbContext
): Promise<void> {
  await createLimitedOwnership(tableName, rows, ctx.authInfo.userId, ReadPermOnly, ctx);
}

async function createLimitedOwnership(
	tableName: string,
	rows: object[],
	userId: string,
	perms: Set<RbacPermissionFlag>,
	ctx: DbContext
): Promise<void> {
	const ownerRows: object[] = [];
	rows.forEach((r: object) => {
		ownerRows.push({
			id: crypto.randomUUID(),
			path: r[PathKey],
			user_id: userId,
			c: perms.has(RbacPermissionFlag.CREATE),
			r: perms.has(RbacPermissionFlag.READ),
			d: perms.has(RbacPermissionFlag.DELETE),
			u: perms.has(RbacPermissionFlag.UPDATE),
		});
	});
	const tname = ownersTable(tableName);
	await insertRowsHelper(tname, ownerRows, ctx, false);
}

async function isOwnerOfParent(path: string, ctx: DbContext): Promise<boolean> {
	const parts = path.split('/');
	if (parts.length <= 2) {
		return false;
	}
	const parentPaths = new Array<[string, string]>();
	let i = 0;
	let lastPath: string | undefined;
	while (i < parts.length - 2) {
		const parentName = parts[i].replace('$', '_');
		const parentPath = `${lastPath ? lastPath + '/' : ''}${parts[i]}/${parts[i + 1]}`;
		lastPath = `${parentPath}/${parts[i + 2]}`;
		parentPaths.push([parentName, parentPath]);
		i += 3;
	}
	if (parentPaths.length == 0) {
		return false;
	}
	for (let i = 0; i < parentPaths.length; ++i) {
		const [parentName, parentPath] = parentPaths[i];
		const result = await isOwner(parentName, parentPath, ctx);
		if (result) return result;
	}
	return false;
}

async function isOwner(parentName: string, instPath: string, ctx: DbContext): Promise<boolean> {
	const userId = ctx.getUserId();
	const tabName = ownersTable(parentName);
	const alias = tabName;
	const query = [
		`${alias}.path = '${instPath}'`,
		`${alias}.user_id = '${userId}'`,
		`${alias}.type = 'o'`,
	];
	let result: any = undefined;
	const sq: SelectQueryBuilder<any> = getDatasourceForTransaction(ctx.txnId)
		.createQueryBuilder()
		.select()
		.from(tabName, alias)
		.where(query.join(' AND '));
	try {
		await sq.getRawMany().then((r: any) => (result = r));
	} catch (reason: any) {
		logger.error(`Failed to check ownership on parent ${parentName} - ${reason}`);
	}
	if (result == undefined || result.length == 0) {
		return false;
	}
	return true;
}

export async function upsertRows(tableName: string, rows: object[], ctx: DbContext): Promise<void> {
	await insertRows(tableName, rows, ctx, true);
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
		.where(objectToWhereClause(queryObj, queryVals), queryVals)
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

function mkBetweenClause(tableName: string | undefined, k: string, queryVals: any): string {
	const ov = queryVals[k];
	if (ov instanceof Array) {
		const isstr = isString(ov[0]);
		const v1 = isstr ? `'${ov[0]}'` : ov[0];
		const v2 = isstr ? `'${ov[1]}'` : ov[1];
		const s = tableName
			? `"${tableName}"."${k}" BETWEEN ${v1} AND ${v2}`
			: `"${k}" BETWEEN ${v1} AND ${v2}`;
		delete queryVals[k];
		return s;
	} else {
		throw new Error(`between requires an array argument, not ${ov}`);
	}
}

function objectToWhereClause(queryObj: object, queryVals: any, tableName?: string): string {
	const clauses: Array<string> = new Array<string>();
	Object.entries(queryObj).forEach((value: [string, any]) => {
		const op: string = value[1] as string;
		const clause =
			op == 'between'
				? mkBetweenClause(tableName, value[0], queryVals)
				: tableName
					? `"${tableName}"."${value[0]}" ${op} :${value[0]}`
					: `"${value[0]}" ${op} :${value[0]}`;
		clauses.push(clause);
	});
	return clauses.join(' AND ');
}

function objectToRawWhereClause(queryObj: object, queryVals: any, tableName?: string): string {
	const clauses: Array<string> = new Array<string>();
	Object.entries(queryObj).forEach((value: [string, any]) => {
		const op: string = value[1] as string;
		const k: string = value[0];
		let clause = '';
		if (op == 'between') {
			clause = mkBetweenClause(tableName, k, queryVals);
		} else {
			const ov: any = queryVals[k];
			const v = isString(ov) ? `'${ov}'` : ov;
			clause = tableName ? `"${tableName}"."${k}" ${op} ${v}` : `"${k}" ${op} ${v}`;
		}
		clauses.push(clause);
	});
	if (clauses.length > 0) {
		return clauses.join(' AND ');
	} else {
		return '';
	}
}

export async function getMany(
	tableName: string,
	queryObj: object | undefined,
	queryVals: object | undefined,
	distinct: boolean,
	ctx: DbContext
): Promise<any> {
	const alias: string = tableName.toLowerCase();
	const queryStr: string = withNotDeletedClause(
		alias,
		queryObj != undefined ? objectToWhereClause(queryObj, queryVals, alias) : ''
	);
	let ownersJoinCond: string[] | undefined;
	let ot: string = '';
	let otAlias: string = '';
	if (!ctx.isPermitted()) {
		const userId = ctx.getUserId();
		const fqName = ctx.resourceFqName;
		const env: Environment = ctx.activeEnv;
		let hasGlobalPerms = await canUserRead(userId, fqName, env);
		if (hasGlobalPerms) {
			if (ctx.isForUpdate()) {
				hasGlobalPerms = await canUserUpdate(userId, fqName, env);
			} else if (ctx.isForDelete()) {
				hasGlobalPerms = await canUserDelete(userId, fqName, env);
			}
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

	const qb: SelectQueryBuilder<any> = getDatasourceForTransaction(ctx.txnId)
		.getRepository(tableName)
		.createQueryBuilder();
	if (ownersJoinCond) {
		qb.innerJoin(ot, otAlias, ownersJoinCond.join(' AND '));
	}
	if (distinct) {
		qb.distinct(true);
	}
	qb.where(queryStr, queryVals);
	return await qb.getMany();
}

export async function getManyByJoin(
	tableName: string,
	queryObj: object | undefined,
	queryVals: object | undefined,
	joinClauses: JoinClause[],
	intoSpec: Map<string, string>,
	distinct: boolean,
	ctx: DbContext
): Promise<any> {
	const alias: string = tableName.toLowerCase();
	const queryStr: string = withNotDeletedClause(
		alias,
		queryObj != undefined ? objectToRawWhereClause(queryObj, queryVals, alias) : ''
	);
	let ot: string = '';
	let otAlias: string = '';
	if (!ctx.isPermitted()) {
		const userId = ctx.getUserId();
		const fqName = ctx.resourceFqName;
		const env: Environment = ctx.activeEnv;
		const hasGlobalPerms = await canUserRead(userId, fqName, env);
		if (!hasGlobalPerms) {
			ot = ownersTable(tableName);
			otAlias = ot.toLowerCase();
			joinClauses.push({
				tableName: otAlias,
				joinOn: [
					makeJoinOn(`${otAlias}.path`, `${alias}.${PathAttributeName}`),
					makeJoinOn(`${otAlias}.user_id`, `'${ctx.authInfo.userId}'`),
					makeJoinOn(`${otAlias}.r`, true),
				],
			});
		}
	}
	const joinSql = new Array<string>();
	joinClauses.forEach((jc: JoinClause) => {
		joinSql.push(
			`inner join ${jc.tableName} as ${jc.tableName} on ${joinOnAsSql(jc.joinOn)} AND ${jc.tableName}.${DeletedFlagAttributeName} = false`
		);
		if (jc.queryObject) {
			const q = objectToRawWhereClause(jc.queryObject, jc.queryValues, jc.tableName);
			if (q.length > 0) {
				joinSql.push(` AND ${q}`);
			}
		}
	});
	const sql = `SELECT ${distinct ? 'DISTINCT' : ''} ${intoSpecToSql(intoSpec)} FROM ${tableName} ${joinSql.join('\n')} WHERE ${queryStr}`;
	logger.debug(`Join Query: ${sql}`);
	const qb = getDatasourceForTransaction(ctx.txnId).getRepository(tableName).manager;
	return await qb.query(sql);
}

function intoSpecToSql(intoSpec: Map<string, string>): string {
	const cols = new Array<string>();
	intoSpec.forEach((v: string, k: string) => {
		cols.push(`${v} AS "${k}"`);
	});
	return cols.join(', ');
}

function joinOnAsSql(joinOn: JoinOn | JoinOn[]): string {
	if (joinOn instanceof Array) {
		return joinOn.map(joinOnAsSql).join(' AND ');
	} else {
		return `${joinOn.attributeName} ${joinOn.operator} ${joinOn.attributeValue}`;
	}
}

function notDeletedClause(alias: string): string {
	return `${alias}.${DeletedFlagAttributeName} = false`;
}

function withNotDeletedClause(alias: string, sql: string): string {
	if (sql == '') {
		return notDeletedClause(alias);
	} else {
		return `${sql} AND ${notDeletedClause(alias)}`;
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
	ctx: DbContext
) {
	const alias: string = tableName.toLowerCase();
	const connAlias: string = connInfo.connectionTable.toLowerCase();
	const qb = getDatasourceForTransaction(ctx.txnId)
		.createQueryBuilder()
		.select()
		.from(tableName, alias)
		.where(objectToWhereClause(queryObj, alias), queryVals)
		.innerJoin(
			connInfo.connectionTable,
			connAlias,
			buildQueryFromConnnectionInfo(connAlias, alias, connInfo)
		);
	return await qb.getRawMany();
}

const transactionsDb: Map<string, QueryRunner> = new Map<string, QueryRunner>();

export async function startDbTransaction(): Promise<string> {
	if (defaultDataSource != undefined) {
		const queryRunner = defaultDataSource.createQueryRunner();
		await queryRunner.startTransaction();
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
			await qr.release();
			transactionsDb.delete(txnId);
		}
	}
}
