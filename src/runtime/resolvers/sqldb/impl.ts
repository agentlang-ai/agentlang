import {
  AttributeEntry,
  attributesAsColumns,
  findIdAttribute,
  Instance,
  InstanceAttributes,
  MarkDeletedAttributes,
  newInstanceAttributes,
  RelationshipEntry,
} from '../../module.js';
import { escapeFqName } from '../../util.js';
import { Resolver } from '../interface.js';
import { asTableName } from './dbutil.js';
import { getMany, insertRow, PathAttributeName, updateRow } from './schema.js';

function addDefaultIdAttribute(inst: Instance): string | undefined {
  const attrEntry: AttributeEntry | undefined = findIdAttribute(inst);
  const attributes: InstanceAttributes = inst.attributes;
  if (attrEntry != undefined) {
    if (attrEntry.props != undefined && !attributes.has(attrEntry.name)) {
      const d: any | undefined = attrEntry.props.get('default');
      if (d != undefined && d == 'uuid()') {
        attributes.set(attrEntry.name, crypto.randomUUID());
      }
    }
    return attrEntry.name;
  }
  return undefined;
}

export class SqlDbResolver extends Resolver {
  public override async createInstance(inst: Instance): Promise<Instance> {
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
    await insertRow(n, rowObj);
    return inst;
  }

  public override async upsertInstance(inst: Instance): Promise<Instance> {
    return inst;
  }

  public override async updateInstance(inst: Instance): Promise<Instance> {
    return inst;
  }

  static EmptyResultSet: Array<Instance> = new Array<Instance>();

  public override async queryInstances(inst: Instance): Promise<Instance[]> {
    let result = SqlDbResolver.EmptyResultSet;
    await getMany(
      asTableName(inst.moduleName, inst.name),
      inst.queryAttributesAsObject(),
      inst.queryAttributeValuesAsObject(),
      (rslt: any) => {
        if (rslt instanceof Array) {
          result = new Array<Instance>();
          rslt.forEach((r: Object) => {
            result.push(Instance.newWithAttributes(inst, new Map(Object.entries(r))));
          });
        }
      }
    );
    return result;
  }

  static MarkDeletedObject: Object = Object.fromEntries(MarkDeletedAttributes);

  public override async deleteInstance(
    target: Instance | Instance[] | null
  ): Promise<Instance | Instance[] | null> {
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

  private async deleteInstanceHelper(target: Instance) {
    target.addQuery(PathAttributeName);
    const queryVals: Object = Object.fromEntries(
      newInstanceAttributes().set(PathAttributeName, target.attributes.get(PathAttributeName))
    );
    await updateRow(
      asTableName(target.moduleName, target.name),
      target.queryAttributesAsObject(),
      queryVals,
      SqlDbResolver.MarkDeletedObject
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
        await insertBetweenRow(n, a1, a2, node1, otherNodeOrNodes[i]);
      }
    } else {
      await insertBetweenRow(n, a1, a2, node1, otherNodeOrNodes);
    }
    return node1;
  }
}

async function insertBetweenRow(
  n: string,
  a1: string,
  a2: string,
  node1: Instance,
  node2: Instance
): Promise<void> {
  const attrs: InstanceAttributes = newInstanceAttributes();
  attrs.set(a1, node1.attributes.get(PathAttributeName));
  attrs.set(a2, node2.attributes.get(PathAttributeName));
  attrs.set(PathAttributeName, crypto.randomUUID());
  const row = attributesAsColumns(attrs);
  await insertRow(n, row);
}
