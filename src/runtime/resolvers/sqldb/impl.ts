import {
  assertInstance,
  AttributeEntry,
  BetweenInstanceNodeValuesResult,
  findIdAttribute,
  getAllBetweenRelationships,
  getAllOneToOneRelationshipsForEntity,
  getBetweenInstanceNodeValues,
  getEntityRbacRules,
  Instance,
  InstanceAttributes,
  isBetweenRelationship,
  newInstanceAttributes,
  Relationship,
} from '../../module.js';
import {
  escapeFqName,
  escapeQueryName,
  isFqName,
  makeFqName,
  nameToPath,
  splitFqName,
  splitRefs,
} from '../../util.js';
import { JoinInfo, Resolver, WhereClause } from '../interface.js';
import { asColumnReference, asTableReference } from './dbutil.js';
import {
  addRowForFullTextSearch,
  commitDbTransaction,
  DbContext,
  deleteFullTextSearchEntry,
  getAllConnected,
  getMany,
  getManyByJoin,
  hardDeleteRow,
  insertBetweenRow,
  insertRow,
  isVectorStoreSupported,
  JoinClause,
  JoinOn,
  makeJoinOn,
  QuerySpec,
  rollbackDbTransaction,
  startDbTransaction,
  updateRow,
  vectorStoreSearch,
  vectorStoreSearchEntryExists,
} from './database.js';
import { AggregateFunctionCall, Environment } from '../../interpreter.js';
import {
  DeletedFlagAttributeName,
  ParentAttributeName,
  PathAttributeName,
  TenantAttributeName,
} from '../../defs.js';
import { logger } from '../../logger.js';
import { JoinSpec } from '../../../language/generated/ast.js';
import { EmbeddingProvider, EmbeddingProviderConfig } from '../../embeddings/provider.js';
import { embeddingProvider } from '../../embeddings/registry.js';
import { TextChunker } from '../../embeddings/chunker.js';

interface EmbeddingServiceConfig extends EmbeddingProviderConfig {
  provider?: string;
}

export class EmbeddingService {
  private provider: EmbeddingProvider;
  private config: EmbeddingServiceConfig;
  private chunker: TextChunker;

  constructor(config?: EmbeddingServiceConfig) {
    this.config = config || {};
    const providerClass = embeddingProvider(this.config.provider || 'openai');
    this.provider = new providerClass(this.config);
    this.chunker = new TextChunker(this.getChunkSize(), this.getChunkOverlap());
  }

  private getChunkSize(): number {
    return this.config.chunkSize || 1000;
  }

  private getChunkOverlap(): number {
    return this.config.chunkOverlap || 200;
  }

  async embedText(text: string): Promise<number[]> {
    const chunks = this.chunker.splitText(text);

    if (chunks.length === 1) {
      return await this.provider.embedText(chunks[0]);
    }

    const chunkEmbeddings = await Promise.all(
      chunks.map((chunk: string) => this.provider.embedText(chunk))
    );

    return this.averageEmbeddings(chunkEmbeddings);
  }

  async embedQuery(query: string): Promise<number[]> {
    return await this.provider.embedText(query);
  }

  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];
    const dimension = embeddings[0].length;
    const averaged = new Array(dimension).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimension; i++) {
        averaged[i] += embedding[i];
      }
    }

    return averaged.map((v: number) => v / embeddings.length);
  }
}

function maybeFindIdAttributeName(inst: Instance): string | undefined {
  const attrEntry: AttributeEntry | undefined = findIdAttribute(inst);
  if (attrEntry !== undefined) {
    return attrEntry.name;
  }
  return undefined;
}

export class SqlDbResolver extends Resolver {
  private txnId: string | undefined;
  private _embeddingService: EmbeddingService | undefined;

  constructor(name: string) {
    super();
    this.name = name;
  }

  private get embeddingService(): EmbeddingService {
    if (!this._embeddingService) {
      this._embeddingService = new EmbeddingService();
    }
    return this._embeddingService;
  }

  public override getName(): string {
    return this.name;
  }

  private getDbContext(resourceFqName: string): DbContext {
    const activeEnv: Environment = this.getEnvironment() as Environment;
    if (!activeEnv) {
      throw new Error('Active environment context is required by SqlDbResolver');
    }
    return new DbContext(
      resourceFqName,
      this.authInfo,
      activeEnv,
      this.txnId,
      activeEnv.isInKernelMode(),
      getEntityRbacRules(resourceFqName)
    );
  }

  public override onSetPath(moduleName: string, entryName: string): string {
    return entryName;
  }

  private extractTextForEmbedding(rowObj: object, searchAttributes: string[] | undefined): string {
    const obj = rowObj as Record<string, any>;
    const ftsAttrs =
      !searchAttributes || searchAttributes.length === 0 || searchAttributes[0] === '*'
        ? Object.keys(obj).filter(k => this.shouldIncludeAttribute(k))
        : searchAttributes;

    const parts: string[] = [];
    for (const attr of ftsAttrs) {
      const value = obj[attr];
      if (value !== undefined && value !== null) {
        parts.push(this.valueToString(value));
      }
    }

    return parts.join(' ');
  }

  private shouldIncludeAttribute(key: string): boolean {
    const excludedAttrs = [
      PathAttributeName,
      DeletedFlagAttributeName,
      TenantAttributeName,
      '__tenant__',
      '__is_deleted__',
    ];
    return !excludedAttrs.includes(key);
  }

  private valueToString(value: any): string {
    if (Array.isArray(value)) {
      return value.join(' ');
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }
    return String(value);
  }

  private async insertInstance(inst: Instance, orUpdate = false): Promise<Instance> {
    const ctx = this.getDbContext(inst.getFqName());
    if (isBetweenRelationship(inst.name, inst.moduleName)) {
      const nodeVals: BetweenInstanceNodeValuesResult = getBetweenInstanceNodeValues(inst);
      assertInstance(nodeVals.node1);
      assertInstance(nodeVals.node2);
      await this.handleInstancesLink(
        nodeVals.node1,
        nodeVals.node2,
        nodeVals.entry,
        orUpdate,
        ctx.activeEnv.isInDeleteMode()
      );
      return inst;
    }
    const idAttrName: string | undefined = maybeFindIdAttributeName(inst);
    ensureOneToOneAttributes(inst);
    const attrs: InstanceAttributes = inst.attributes;
    const idAttrVal: any = idAttrName ? attrs.get(idAttrName) : crypto.randomUUID();
    if (idAttrVal !== undefined) {
      const pp: string | undefined = attrs.get(PathAttributeName);
      const n: string = `${inst.moduleName}/${inst.name}`;
      let p: string = '';
      if (pp !== undefined) p = `${pp}/${escapeFqName(n)}/${idAttrVal}`;
      else p = `${n.replace('/', '$')}/${idAttrVal}`;
      attrs.set(PathAttributeName, p);
    }
    const n: string = asTableReference(inst.moduleName, inst.name);
    const rowObj: object = inst.attributesWithStringifiedObjects();
    await insertRow(n, rowObj, ctx, orUpdate);
    if (inst.record.getEmbeddingConfig() || inst.record.getFullTextSearchAttributes()) {
      const path = attrs.get(PathAttributeName);
      try {
        if (
          (await isVectorStoreSupported()) &&
          !(await vectorStoreSearchEntryExists(n, path, ctx))
        ) {
          const ftsAttrs = inst.record.getFullTextSearchAttributes() || ['*'];
          const textToEmbed = this.extractTextForEmbedding(rowObj, ftsAttrs);
          let embeddingConfig: any = undefined;
          const instanceEmbeddingConfig = inst.get('embeddingConfig');
          if (instanceEmbeddingConfig) {
            try {
              embeddingConfig =
                typeof instanceEmbeddingConfig === 'string'
                  ? JSON.parse(instanceEmbeddingConfig)
                  : instanceEmbeddingConfig;
            } catch {
              // If parsing fails, will fall back to env vars
            }
          }
          if (!embeddingConfig) {
            embeddingConfig = {
              provider: process.env.AGENTLANG_EMBEDDING_PROVIDER || 'openai',
              model: process.env.AGENTLANG_EMBEDDING_MODEL || 'text-embedding-3-small',
              chunkSize: process.env.AGENTLANG_EMBEDDING_CHUNKSIZE
                ? parseInt(process.env.AGENTLANG_EMBEDDING_CHUNKSIZE, 10)
                : 1000,
              chunkOverlap: process.env.AGENTLANG_EMBEDDING_CHUNKOVERLAP
                ? parseInt(process.env.AGENTLANG_EMBEDDING_CHUNKOVERLAP, 10)
                : 200,
            };
          }
          const embeddingService = new EmbeddingService(embeddingConfig);
          const res = await embeddingService.embedText(textToEmbed);
          await addRowForFullTextSearch(n, path, res, ctx);
        }
      } catch (reason: any) {
        logger.warn(`Full text indexing failed for ${path} - ${reason}`);
      }
    }
    return inst;
  }

  public override async createInstance(inst: Instance): Promise<Instance> {
    return await this.insertInstance(inst);
  }

  public override async upsertInstance(inst: Instance): Promise<Instance> {
    return await this.insertInstance(inst, true);
  }

  public override async updateInstance(
    inst: Instance,
    newAttrs: InstanceAttributes
  ): Promise<Instance> {
    const queryObj: object = Object.fromEntries(new Map<string, any>().set(PathAttributeName, '='));
    const queryVals: object = Object.fromEntries(
      new Map<string, any>().set(PathAttributeName, inst.attributes.get(PathAttributeName))
    );
    const updateObj: object = Instance.stringifyObjects(newAttrs);
    await updateRow(
      asTableReference(inst.moduleName, inst.name),
      queryObj,
      queryVals,
      updateObj,
      this.getDbContext(inst.getFqName())
    );
    return Instance.clone(inst).mergeAttributes(newAttrs);
  }

  private static normalizedAggregates(
    inst: Instance,
    tableName: string
  ): Map<string, string> | undefined {
    if (inst.aggregates !== undefined) {
      const entn = inst.name;
      const entfqn = inst.getFqName();
      const mn = inst.moduleName;
      const result = new Map<string, string>();
      inst.aggregates.forEach((f: AggregateFunctionCall, n: string) => {
        const args = f.args.map((v: string) => {
          return asColumnReference(v, tableName, entn, entfqn, mn, true);
        });
        result.set(n, `${f.name}(${args.join(', ')})`);
      });
      return result;
    }
    return undefined;
  }

  static EmptyResultSet: Array<Instance> = new Array<Instance>();

  public override async queryInstances(
    inst: Instance,
    queryAll: boolean = false,
    distinct: boolean = false
  ): Promise<Instance[]> {
    let result = SqlDbResolver.EmptyResultSet;

    const tableName = asTableReference(inst.moduleName, inst.name);
    const fqName = inst.getFqName();
    const ctx = this.getDbContext(fqName);
    const qattrs: any = queryAll ? undefined : inst.queryAttributesAsObject();
    const qvals: any = queryAll ? undefined : inst.queryAttributeValuesAsObject();
    const groupBy = inst.groupBy
      ? inst.groupBy.map((gb: string) => {
          return asColumnReference(gb, tableName, inst.name, fqName, inst.moduleName, true);
        })
      : undefined;
    const orderBy = inst.orderBy
      ? inst.orderBy.map((ob: string) => {
          return asColumnReference(ob, tableName, inst.name, fqName, inst.moduleName, true);
        })
      : undefined;
    const orderByDesc = inst.orderByDesc ? 'DESC' : 'ASC';
    const aggregates = SqlDbResolver.normalizedAggregates(inst, tableName);

    let vectorResult: Instance[] | undefined;
    // Use environment variable based embedding config for queries
    const embeddingConfig = {
      provider: process.env.AGENTLANG_EMBEDDING_PROVIDER || 'openai',
      model: process.env.AGENTLANG_EMBEDDING_MODEL || 'text-embedding-3-small',
      chunkSize: process.env.AGENTLANG_EMBEDDING_CHUNKSIZE
        ? parseInt(process.env.AGENTLANG_EMBEDDING_CHUNKSIZE, 10)
        : 1000,
      chunkOverlap: process.env.AGENTLANG_EMBEDDING_CHUNKOVERLAP
        ? parseInt(process.env.AGENTLANG_EMBEDDING_CHUNKOVERLAP, 10)
        : 200,
    };
    const ftsAttrs = inst.record.getFullTextSearchAttributes();
    if (
      (await isVectorStoreSupported()) &&
      qattrs &&
      (ftsAttrs || Object.keys(qattrs).some(k => k.endsWith('?')))
    ) {
      const vectorSearchAttr = Object.keys(qattrs).find(k => k.endsWith('?'));
      if (vectorSearchAttr) {
        const queryVal = qvals[vectorSearchAttr];
        const searchString = this.valueToString(queryVal);
        const embeddingService = new EmbeddingService(embeddingConfig);
        const queryVec = await embeddingService.embedQuery(searchString);
        const rslt: any = await vectorStoreSearch(tableName, queryVec, 10, ctx);
        if (rslt instanceof Array) {
          vectorResult = new Array<Instance>();
          rslt.forEach((r: any) => {
            const attrs: InstanceAttributes = maybeNormalizeAttributeNames(
              tableName,
              new Map(Object.entries(r))
            );
            attrs.delete(DeletedFlagAttributeName);
            vectorResult!.push(Instance.newWithAttributes(inst, attrs));
          });
        }
        delete qattrs[vectorSearchAttr];
        delete qvals[vectorSearchAttr];
      }
    }

    const qspec: QuerySpec = {
      queryObj: Object.keys(qattrs || {}).length > 0 ? qattrs : undefined,
      queryVals: Object.keys(qvals || {}).length > 0 ? qvals : undefined,
      distinct,
      groupBy,
      orderBy,
      orderByDesc,
      aggregates,
      joinClauses: undefined,
      intoSpec: undefined,
      whereClauses: undefined,
    };
    const readOnlyAttrs = inst.record.getWriteOnlyAttributes();
    const rslt: any =
      vectorResult !== undefined && qspec.queryObj === undefined
        ? vectorResult
        : await getMany(tableName, qspec, ctx);
    if (rslt instanceof Array) {
      if (vectorResult !== undefined && qspec.queryObj !== undefined) {
        // Merge results if both vector and standard queries were performed
        const vectorPaths = new Set(vectorResult.map(i => i.lookup(PathAttributeName)));
        result = new Array<Instance>();
        rslt.forEach((r: any) => {
          const attrs: InstanceAttributes = maybeNormalizeAttributeNames(
            tableName,
            new Map(Object.entries(r))
          );
          if (vectorPaths.has(attrs.get(PathAttributeName))) {
            attrs.delete(DeletedFlagAttributeName);
            readOnlyAttrs?.forEach((n: string) => {
              attrs.delete(n);
            });
            result.push(Instance.newWithAttributes(inst, attrs));
          }
        });
      } else {
        result =
          vectorResult !== undefined && qspec.queryObj === undefined
            ? vectorResult
            : new Array<Instance>();
        if (vectorResult === undefined || qspec.queryObj !== undefined) {
          rslt.forEach((r: any) => {
            const attrs: InstanceAttributes = maybeNormalizeAttributeNames(
              tableName,
              new Map(Object.entries(r))
            );
            attrs.delete(DeletedFlagAttributeName);
            readOnlyAttrs?.forEach((n: string) => {
              attrs.delete(n);
            });
            result.push(Instance.newWithAttributes(inst, attrs));
          });
        }
      }
    }
    return result;
  }

  static MarkDeletedObject: object = Object.fromEntries(
    newInstanceAttributes().set(DeletedFlagAttributeName, true)
  );

  public override async deleteInstance(
    target: Instance | Instance[],
    purge: boolean
  ): Promise<Instance[] | Instance> {
    if (target !== null) {
      if (target instanceof Array) {
        for (let i = 0; i < target.length; ++i) {
          await this.deleteInstanceHelper(target[i], purge);
        }
      } else {
        await this.deleteInstanceHelper(target, purge);
      }
    }
    return target;
  }

  public override async queryChildInstances(
    parentPath: string,
    inst: Instance
  ): Promise<Instance[]> {
    inst.addQuery(PathAttributeName, 'like', parentPath + '%');
    return await this.queryInstances(inst, false);
  }

  public override async queryConnectedInstances(
    relationship: Relationship,
    connectedInstance: Instance,
    inst: Instance
  ): Promise<Instance[]> {
    let result = SqlDbResolver.EmptyResultSet;
    if (relationship.isOneToOne()) {
      const col = relationship.getAliasFor(connectedInstance);
      inst.addQuery(col, '=', connectedInstance.lookup(PathAttributeName));
      return await this.queryInstances(inst, false);
    } else {
      const from = relationship.getAliasFor(connectedInstance);
      const to = relationship.getInverseAliasFor(connectedInstance);
      await getAllConnected(
        asTableReference(inst.moduleName, inst.name),
        inst.queryAttributesAsObject(),
        inst.queryAttributeValuesAsObject(),
        {
          connectionTable: asTableReference(inst.moduleName, relationship.name),
          fromColumn: from,
          fromValue: `'${connectedInstance.lookup(PathAttributeName)}'`,
          toColumn: to,
          toRef: PathAttributeName,
        },
        this.getDbContext(inst.getFqName())
      ).then((rslt: any) => {
        if (rslt instanceof Array) {
          result = new Array<Instance>();
          const connInst: Instance = Instance.EmptyInstance(inst.name, inst.moduleName);
          rslt.forEach((r: object) => {
            const attrs: InstanceAttributes = new Map(Object.entries(r));
            attrs.delete(DeletedFlagAttributeName);
            result.push(Instance.newWithAttributes(connInst, attrs));
          });
        }
      });
      return result;
    }
  }

  public override async queryByJoin(
    inst: Instance,
    joinInfo: JoinInfo[],
    intoSpec: Map<string, string>,
    distinct: boolean = false,
    rawJoinSpec?: JoinSpec[],
    whereClauses?: WhereClause[]
  ): Promise<any> {
    const tableName = asTableReference(inst.moduleName, inst.name);
    const joinClauses: JoinClause[] = [];
    if (rawJoinSpec) {
      rawJoinSpec.forEach((rjs: JoinSpec) => {
        this.processRawJoinSpec(tableName, inst, rjs, joinClauses);
      });
    } else {
      this.processJoinInfo(tableName, inst, joinInfo, joinClauses);
    }
    intoSpec.forEach((v: string, k: string) => {
      const p = nameToPath(v);
      const mn = p.hasModule() ? p.getModuleName() : inst.moduleName;
      intoSpec.set(k, asTableReference(mn, p.getEntryName()));
    });
    const fqName = inst.getFqName();
    const groupBy = inst.groupBy
      ? inst.groupBy.map((gb: string) => {
          return asColumnReference(gb, tableName, inst.name, fqName, inst.moduleName, true);
        })
      : undefined;
    const orderBy = inst.orderBy
      ? inst.orderBy.map((ob: string) => {
          return asColumnReference(ob, tableName, inst.name, fqName, inst.moduleName, true);
        })
      : undefined;
    const orderByDesc = inst.orderByDesc ? 'DESC' : 'ASC';
    const aggregates = SqlDbResolver.normalizedAggregates(inst, tableName);
    whereClauses?.forEach((wc: WhereClause) => {
      wc.attrName = asColumnReference(wc.attrName, tableName, inst.name, fqName, inst.moduleName);
    });
    const qspec: QuerySpec = {
      queryObj: inst.queryAttributesAsObject(),
      queryVals: inst.queryAttributeValuesAsObject(),
      distinct,
      groupBy,
      orderBy,
      orderByDesc,
      aggregates,
      joinClauses,
      whereClauses,
      intoSpec,
    };
    const rslt: any = await getManyByJoin(tableName, qspec, this.getDbContext(inst.getFqName()));
    return rslt;
  }

  private processRawJoinSpec(
    tableName: string,
    inst: Instance,
    rawJoinSpec: JoinSpec,
    joinClauses: JoinClause[]
  ) {
    const n = rawJoinSpec.name;
    let joinTableName = '';
    if (isFqName(n)) {
      const parts = splitFqName(n);
      joinTableName = asTableReference(parts[0], parts[1]);
    } else {
      joinTableName = asTableReference(inst.moduleName, n);
    }
    let rhs = rawJoinSpec.rhs;
    if (isFqName(rhs)) {
      rhs = splitFqName(rhs)[1];
    }
    const refParts = splitRefs(rhs);
    if (refParts.length != 2) {
      throw new Error(`Invalid join referene - ${rawJoinSpec.rhs}`);
    }
    if (refParts[0] !== inst.name) {
      throw new Error(`Invalid table name in join reference - ${rawJoinSpec.rhs}`);
    }
    const joinOn = makeJoinOn(
      `"${joinTableName}"."${escapeQueryName(rawJoinSpec.lhs)}"`,
      `"${tableName}"."${escapeQueryName(refParts[1])}"`,
      rawJoinSpec.op
    );
    joinClauses.push({
      tableName: joinTableName,
      joinOn: joinOn,
      joinType: rawJoinSpec.type.substring(1).replace('_', ' '),
    });
  }

  private processJoinInfo(
    joinParentTable: string,
    joinInst: Instance,
    joinInfo: JoinInfo[],
    joinClauses: JoinClause[]
  ) {
    joinInfo.forEach((ji: JoinInfo) => {
      const rel: Relationship = ji.relationship;
      const joinTableName = asTableReference(ji.queryInstance.moduleName, ji.queryInstance.name);
      let joinOn: JoinOn | JoinOn[] | undefined;
      if (rel.isContains()) {
        const walkDown = rel.isParent(joinInst);
        const pathRef = `${joinParentTable}.${walkDown ? PathAttributeName : ParentAttributeName}`;
        joinOn = makeJoinOn(
          `"${joinTableName}"."${walkDown ? ParentAttributeName : PathAttributeName}"`,
          pathRef
        );
      } else {
        const pathRef = `${joinParentTable}.${PathAttributeName}`;
        if (rel.isOneToOne()) {
          joinOn = makeJoinOn(
            `"${joinTableName}"."${rel.getAliasForName(joinInst.getFqName())}"`,
            pathRef
          );
        } else {
          const relTableName = asTableReference(rel.moduleName, rel.name);
          const jPathRef = `"${joinTableName}"."${PathAttributeName}"`;
          const fqn = ji.queryInstance.getFqName();
          const n1 = rel.getAliasForName(fqn);
          const n2 = rel.getInverseAliasForName(fqn);
          joinClauses.push({
            tableName: relTableName,
            joinOn: makeJoinOn(`"${relTableName}"."${n2}"`, pathRef),
          });
          joinOn = [
            makeJoinOn(jPathRef, `"${relTableName}"."${n1}"`),
            makeJoinOn(`"${relTableName}"."${n1}"`, jPathRef),
          ];
        }
      }
      if (joinOn) {
        joinClauses.push({
          tableName: joinTableName,
          queryObject: ji.queryInstance.queryAttributesAsObject(),
          queryValues: ji.queryInstance.queryAttributeValuesAsObject(),
          joinOn: joinOn,
        });
      } else {
        throw new Error(
          `Relationship type for ${ji.relationship.name} not supported for join-queries`
        );
      }
      if (ji.subJoins) {
        this.processJoinInfo(joinTableName, ji.queryInstance, ji.subJoins, joinClauses);
      }
    });
  }

  private async deleteInstanceHelper(target: Instance, purge: boolean) {
    target.addQuery(PathAttributeName);
    const queryVals: object = Object.fromEntries(
      newInstanceAttributes().set(PathAttributeName, target.attributes.get(PathAttributeName))
    );
    const tableName = asTableReference(target.moduleName, target.name);
    const ctx = this.getDbContext(target.getFqName());
    if (purge) {
      await hardDeleteRow(tableName, [[PathAttributeName, target.lookup(PathAttributeName)]], ctx);
    } else {
      await updateRow(
        tableName,
        target.queryAttributesAsObject(),
        queryVals,
        SqlDbResolver.MarkDeletedObject,
        ctx
      );
    }
    if (target.record.getFullTextSearchAttributes()) {
      await deleteFullTextSearchEntry(tableName, target.lookup(PathAttributeName), ctx);
    }
  }

  public override async handleInstancesLink(
    node1: Instance,
    otherNodeOrNodes: Instance | Instance[],
    relEntry: Relationship,
    orUpdate: boolean,
    inDeleteMode: boolean
  ): Promise<Instance> {
    if (otherNodeOrNodes instanceof Array) {
      for (let i = 0; i < otherNodeOrNodes.length; ++i) {
        await this.connectInstancesHelper(
          node1,
          otherNodeOrNodes[i],
          relEntry,
          orUpdate,
          inDeleteMode
        );
      }
      return node1;
    } else {
      await this.connectInstancesHelper(
        node1,
        otherNodeOrNodes as Instance,
        relEntry,
        orUpdate,
        inDeleteMode
      );
      return node1;
    }
  }

  async connectInstancesHelper(
    node1: Instance,
    node2: Instance,
    relEntry: Relationship,
    orUpdate: boolean,
    inDeleteMode: boolean
  ): Promise<void> {
    if (!node1 || !node2) {
      return;
    }
    const n: string = asTableReference(relEntry.moduleName, relEntry.name);
    const [firstNode, secondNode] = relEntry.isFirstNode(node1) ? [node1, node2] : [node2, node1];
    const a1: string = relEntry.node1.alias;
    const a2: string = relEntry.node2.alias;
    const ctx = this.getDbContext(relEntry.getFqName());
    if (relEntry.isOneToOne()) {
      const n1p = inDeleteMode ? crypto.randomUUID() : node1.lookup(PathAttributeName);
      const n2p = inDeleteMode ? crypto.randomUUID() : node2.lookup(PathAttributeName);
      await this.updateInstance(node1, newInstanceAttributes().set(relEntry.node2.alias, n2p));
      await this.updateInstance(node2, newInstanceAttributes().set(relEntry.node1.alias, n1p));
    } else {
      const n1path: any =
        orUpdate || inDeleteMode ? firstNode.lookup(PathAttributeName) : undefined;
      if (n1path !== undefined) {
        await hardDeleteRow(
          n,
          [
            [a1, n1path],
            [a2, secondNode.lookup(PathAttributeName)],
          ],
          ctx
        );
      }
      if (!inDeleteMode) await insertBetweenRow(n, a1, a2, firstNode, secondNode, relEntry, ctx);
    }
  }

  public override async fullTextSearch(
    entryName: string,
    moduleName: string,
    query: string,
    options?: any
  ): Promise<any> {
    const queryVec = await this.embeddingService.embedQuery(query);
    const ctx = this.getDbContext(makeFqName(moduleName, entryName));
    let limit = 5;
    if (options && options.limit) {
      limit = options.limit as number;
    }
    return await vectorStoreSearch(asTableReference(moduleName, entryName), queryVec, limit, ctx);
  }

  public override async startTransaction(): Promise<string> {
    this.txnId = await startDbTransaction();
    return this.txnId;
  }

  public override async commitTransaction(txnId: string): Promise<string> {
    if (txnId == this.txnId) {
      await commitDbTransaction(txnId);
      this.txnId = undefined;
    }
    return txnId;
  }

  public override async rollbackTransaction(txnId: string): Promise<string> {
    if (txnId == this.txnId) {
      await rollbackDbTransaction(txnId);
      this.txnId = undefined;
    }
    return txnId;
  }
}

function ensureOneToOneAttributes(inst: Instance) {
  const betRels = getAllBetweenRelationships();
  getAllOneToOneRelationshipsForEntity(inst.moduleName, inst.name, betRels).forEach(
    (re: Relationship) => {
      const n = re.getInverseAliasFor(inst);
      if (!inst.attributes.has(n)) {
        inst.attributes.set(n, crypto.randomUUID());
      }
    }
  );
}

function maybeNormalizeAttributeNames(
  tableName: string,
  attrs: InstanceAttributes
): InstanceAttributes {
  const ks = [...attrs.keys()];
  if (ks[0].startsWith(tableName)) {
    const n = tableName.length;
    ks.forEach((k: string) => {
      const v = attrs.get(k);
      attrs.delete(k);
      attrs.set(k.substring(n + 1) || k, v);
    });
  }
  return attrs;
}
