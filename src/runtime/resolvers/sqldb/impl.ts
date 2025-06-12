import {
  assertInstance,
  AttributeEntry,
  BetweenInstanceNodeValuesResult,
  findIdAttribute,
  getAllBetweenRelationships,
  getAllOneToOneRelationshipsForEntity,
  getBetweenInstanceNodeValues,
  Instance,
  InstanceAttributes,
  isBetweenRelationship,
  newInstanceAttributes,
  Relationship,
} from '../../module.js';
import { escapeFqName } from '../../util.js';
import { Resolver } from '../interface.js';
import { asTableName } from './dbutil.js';
import {
  getMany,
  insertRow,
  PathAttributeName,
  updateRow,
  getAllConnected,
  DeletedFlagAttributeName,
  startDbTransaction,
  commitDbTransaction,
  rollbackDbTransaction,
  hardDeleteRow,
  DbContext,
  insertBetweenRow,
} from './database.js';
import { Environment } from '../../interpreter.js';

function addDefaultIdAttribute(inst: Instance): string | undefined {
  const attrEntry: AttributeEntry | undefined = findIdAttribute(inst);
  const attributes: InstanceAttributes = inst.attributes;
  if (attrEntry != undefined) {
    if (attrEntry.spec.properties != undefined && !attributes.has(attrEntry.name)) {
      const d: any | undefined = attrEntry.spec.properties.get('default');
      if (d != undefined && d == 'uuid()') {
        attributes.set(attrEntry.name, crypto.randomUUID());
      }
    }
    return attrEntry.name;
  }
  return undefined;
}

export class SqlDbResolver extends Resolver {
  private txnId: string | undefined;

  constructor(name: string) {
    super();
    this.name = name;
  }

  public override getName(): string {
    return this.name;
  }

  private getDbContext(resourceFqName: string): DbContext {
    const activeEnv: Environment = this.getUserData() as Environment;
    if (!activeEnv) {
      throw new Error('Active environment context is required by SqlDbResolver');
    }
    return new DbContext(
      resourceFqName,
      this.authInfo,
      activeEnv,
      this.txnId,
      activeEnv.isInKernelMode()
    );
  }

  public override onSetPath(moduleName: string, entryName: string): string {
    return entryName;
  }

  private async insertInstance(inst: Instance, orUpdate = false): Promise<Instance> {
    if (isBetweenRelationship(inst.name, inst.moduleName)) {
      const nodeVals: BetweenInstanceNodeValuesResult = getBetweenInstanceNodeValues(inst);
      assertInstance(nodeVals.node1);
      assertInstance(nodeVals.node2);
      await this.connectInstances(nodeVals.node1, nodeVals.node2, nodeVals.entry, orUpdate);
      return inst;
    } else {
      const idAttrName: string | undefined = addDefaultIdAttribute(inst);
      ensureOneToOneAttributes(inst);
      const attrs: InstanceAttributes = inst.attributes;
      if (idAttrName != undefined) {
        const idAttrVal: any = attrs.get(idAttrName);
        const pp: string | undefined = attrs.get(PathAttributeName);
        const n: string = `${inst.moduleName}/${inst.name}`;
        let p: string = '';
        if (pp != undefined) p = `${pp}/${escapeFqName(n)}/${idAttrVal}`;
        else p = `${n.replace('/', '$')}/${idAttrVal}`;
        attrs.set(PathAttributeName, p);
      }
      const n: string = asTableName(inst.moduleName, inst.name);
      const rowObj: object = inst.attributesAsObject();
      /*if (orUpdate) {
        f = upsertRow;
      }*/
      await insertRow(n, rowObj, this.getDbContext(inst.getFqName()));
      return inst;
    }
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
    const updateObj: object = Object.fromEntries(newAttrs);
    await updateRow(
      asTableName(inst.moduleName, inst.name),
      queryObj,
      queryVals,
      updateObj,
      this.getDbContext(inst.getFqName())
    );
    return inst.mergeAttributes(newAttrs);
  }

  static EmptyResultSet: Array<Instance> = new Array<Instance>();

  public override async queryInstances(
    inst: Instance,
    queryAll: boolean = false
  ): Promise<Instance[]> {
    let result = SqlDbResolver.EmptyResultSet;

    const rslt: any = await getMany(
      asTableName(inst.moduleName, inst.name),
      queryAll ? undefined : inst.queryAttributesAsObject(),
      queryAll ? undefined : inst.queryAttributeValuesAsObject(),
      inst.getAllUserAttributeNames(),
      this.getDbContext(inst.getFqName())
    );
    if (rslt instanceof Array) {
      result = new Array<Instance>();
      rslt.forEach((r: object) => {
        const attrs: InstanceAttributes = new Map(Object.entries(r));
        attrs.delete(DeletedFlagAttributeName);
        result.push(Instance.newWithAttributes(inst, attrs));
      });
    }
    return result;
  }

  static MarkDeletedObject: object = Object.fromEntries(
    newInstanceAttributes().set(DeletedFlagAttributeName, true)
  );

  public override async deleteInstance(
    target: Instance | Instance[]
  ): Promise<Instance[] | Instance> {
    if (target != null) {
      if (target instanceof Array) {
        for (let i = 0; i < target.length; ++i) {
          await this.deleteInstanceHelper(target[i]);
        }
      } else {
        await this.deleteInstanceHelper(target);
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
      await getAllConnected(
        asTableName(inst.moduleName, inst.name),
        inst.queryAttributesAsObject(),
        inst.queryAttributeValuesAsObject(),
        {
          connectionTable: asTableName(inst.moduleName, relationship.name),
          fromColumn: relationship.node1.alias,
          fromValue: `'${connectedInstance.lookup(PathAttributeName)}'`,
          toColumn: relationship.node2.alias,
          toRef: PathAttributeName,
        },
        this.getDbContext(inst.getFqName())
      ).then((rslt: any) => {
        if (rslt instanceof Array) {
          result = new Array<Instance>();
          const connInst: Instance = Instance.EmptyInstance(
            relationship.node2.path.getEntryName(),
            relationship.node2.path.getModuleName()
          );
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

  private async deleteInstanceHelper(target: Instance) {
    target.addQuery(PathAttributeName);
    const queryVals: object = Object.fromEntries(
      newInstanceAttributes().set(PathAttributeName, target.attributes.get(PathAttributeName))
    );
    await updateRow(
      asTableName(target.moduleName, target.name),
      target.queryAttributesAsObject(),
      queryVals,
      SqlDbResolver.MarkDeletedObject,
      this.getDbContext(target.getFqName())
    );
  }

  public override async connectInstances(
    node1: Instance,
    otherNodeOrNodes: Instance | Instance[],
    relEntry: Relationship,
    orUpdate: boolean
  ): Promise<Instance> {
    if (otherNodeOrNodes instanceof Array) {
      for (let i = 0; i < otherNodeOrNodes.length; ++i) {
        await this.connectInstancesHelper(node1, otherNodeOrNodes[i], relEntry, orUpdate);
      }
      return node1;
    } else {
      await this.connectInstancesHelper(node1, otherNodeOrNodes as Instance, relEntry, orUpdate);
      return node1;
    }
  }

  async connectInstancesHelper(
    node1: Instance,
    node2: Instance,
    relEntry: Relationship,
    orUpdate: boolean
  ): Promise<void> {
    const n: string = asTableName(relEntry.moduleName, relEntry.name);
    const [firstNode, secondNode] = relEntry.isFirstNode(node1) ? [node1, node2] : [node2, node1];
    const a1: string = relEntry.node1.alias;
    const a2: string = relEntry.node2.alias;
    const n1path: any = orUpdate ? firstNode.lookup(PathAttributeName) : undefined;
    if (relEntry.isOneToOne()) {
      await this.updateInstance(
        node1,
        newInstanceAttributes().set(relEntry.node2.alias, node2.lookup(PathAttributeName))
      );
      await this.updateInstance(
        node2,
        newInstanceAttributes().set(relEntry.node1.alias, node1.lookup(PathAttributeName))
      );
    } else {
      if (orUpdate) {
        await hardDeleteRow(
          n,
          [
            [a1, n1path],
            [a2, secondNode.lookup(PathAttributeName)],
          ],
          this.getDbContext(relEntry.getFqName())
        );
      }
      await insertBetweenRow(
        n,
        a1,
        a2,
        firstNode,
        secondNode,
        relEntry,
        this.getDbContext(relEntry.getFqName())
      );
    }
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
