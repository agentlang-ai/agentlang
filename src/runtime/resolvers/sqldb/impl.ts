import {
  assertInstance,
  AttributeEntry,
  attributesAsColumns,
  BetweenInstanceNodeValuesResult,
  findIdAttribute,
  getBetweenInstanceNodeValues,
  Instance,
  InstanceAttributes,
  isBetweenRelationship,
  MarkDeletedAttributes,
  newInstanceAttributes,
  RelationshipEntry,
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
  upsertRow,
} from './database.js';

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
  private name: string = '';
  private txnId: string | undefined;
  constructor(name: string) {
    super();
    this.name = name;
  }
  public override getName(): string {
    return this.name;
  }
  public override onSetPath(moduleName: string, entryName: string): string {
    return entryName;
  }

  private async insertInstance(inst: Instance, orUpdate = false): Promise<Instance> {
    if (isBetweenRelationship(inst.name, inst.moduleName)) {
      const nodeVals: BetweenInstanceNodeValuesResult = getBetweenInstanceNodeValues(inst);
      assertInstance(nodeVals.node1);
      assertInstance(nodeVals.node2);
      await this.connectInstances(nodeVals.node1, nodeVals.node2, nodeVals.entry);
      return inst;
    } else {
      const idAttrName: string | undefined = addDefaultIdAttribute(inst);
      const attrs: InstanceAttributes = inst.attributes;
      if (idAttrName != undefined) {
        const idAttrVal: any = attrs.get(idAttrName);
        const pp: string | undefined = attrs.get(PathAttributeName);
        const n: string = `${inst.moduleName}/${inst.name}`;
        let p: string = '';
        if (pp != undefined) p = `${pp}/${escapeFqName(n)}/${idAttrVal}`;
        else p = `${n}/${idAttrVal}`;
        attrs.set(PathAttributeName, p);
      }
      const n: string = asTableName(inst.moduleName, inst.name);
      const rowObj: object = inst.attributesAsObject();
      let f = insertRow;
      if (orUpdate) {
        f = upsertRow;
      }
      await f(n, rowObj, this.txnId);
      return inst;
    }
  }

  public override async createInstance(inst: Instance): Promise<Instance> {
    let result: Instance = inst;
    await this.insertInstance(inst).then((r: Instance) => (result = r));
    return result;
  }

  public override async upsertInstance(inst: Instance): Promise<Instance> {
    let result: Instance = inst;
    await this.insertInstance(inst, true).then((r: Instance) => (result = r));
    return result;
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
      this.txnId
    );
    return inst.mergeAttributes(newAttrs);
  }

  static EmptyResultSet: Array<Instance> = new Array<Instance>();

  public override async queryInstances(
    inst: Instance,
    queryAll: boolean = false
  ): Promise<Instance[]> {
    let result = SqlDbResolver.EmptyResultSet;
    await getMany(
      asTableName(inst.moduleName, inst.name),
      queryAll ? undefined : inst.queryAttributesAsObject(),
      queryAll ? undefined : inst.queryAttributeValuesAsObject(),
      (rslt: any) => {
        if (rslt instanceof Array) {
          result = new Array<Instance>();
          rslt.forEach((r: object) => {
            const attrs: InstanceAttributes = new Map(Object.entries(r));
            attrs.delete(DeletedFlagAttributeName);
            result.push(Instance.newWithAttributes(inst, attrs));
          });
        }
      },
      this.txnId
    );
    return result;
  }

  static MarkDeletedObject: object = Object.fromEntries(MarkDeletedAttributes);

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
    let result = SqlDbResolver.EmptyResultSet;
    await this.queryInstances(inst, false).then((rs: Instance[]) => {
      result = rs;
    });
    return result;
  }

  public override async queryConnectedInstances(
    relationship: RelationshipEntry,
    connectedInstance: Instance,
    inst: Instance
  ): Promise<Instance[]> {
    let result = SqlDbResolver.EmptyResultSet;
    if (relationship.isManyToMany()) {
      await getAllConnected(
        asTableName(inst.moduleName, inst.name),
        inst.queryAttributesAsObject(),
        inst.queryAttributeValuesAsObject(),
        {
          connectionTable: asTableName(inst.moduleName, relationship.name),
          fromColumn: relationship.node1.alias,
          fromValue: `'${connectedInstance.attributes.get(PathAttributeName)}'`,
          toColumn: relationship.node2.alias,
          toRef: PathAttributeName,
        },
        (rslt: any) => {
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
        },
        this.txnId
      );
      return result;
    } else {
      relationship.setBetweenRef(inst, connectedInstance.attributes.get(PathAttributeName), true);
      await this.queryInstances(inst, false).then((rs: Instance[]) => {
        result = rs;
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
      this.txnId
    );
  }

  public override async connectInstances(
    node1: Instance,
    otherNodeOrNodes: Instance | Instance[],
    relEntry: RelationshipEntry
  ): Promise<Instance> {
    const n: string = asTableName(relEntry.moduleName, relEntry.name);
    const a1: string = relEntry.node1.alias;
    const a2: string = relEntry.node2.alias;
    if (otherNodeOrNodes instanceof Array) {
      for (let i = 0; i < otherNodeOrNodes.length; ++i) {
        await insertBetweenRow(n, a1, a2, node1, otherNodeOrNodes[i], this.txnId);
      }
    } else {
      await insertBetweenRow(n, a1, a2, node1, otherNodeOrNodes, this.txnId);
    }
    return node1;
  }

  public override startTransaction(): string {
    this.txnId = startDbTransaction();
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

async function insertBetweenRow(
  n: string,
  a1: string,
  a2: string,
  node1: Instance,
  node2: Instance,
  txnId?: string
): Promise<void> {
  const attrs: InstanceAttributes = newInstanceAttributes();
  attrs.set(a1, node1.attributes.get(PathAttributeName));
  attrs.set(a2, node2.attributes.get(PathAttributeName));
  attrs.set(PathAttributeName, crypto.randomUUID());
  const row = attributesAsColumns(attrs);
  await insertRow(n, row, txnId);
}
