import {
  AttributeEntry,
  findIdAttribute,
  Instance,
  InstanceAttributes,
  newInstanceAttributes,
  RelationshipEntry,
} from '../../module.js';
import { Resolver } from '../interface.js';
import { asTableName } from './dbutil.js';
import { getMany, insertRow, PathAttributeName } from './schema.js';

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
      let p = `${inst.moduleName}/${inst.name}/${idAttrVal}`;
      if (pp != undefined) p = `${pp}/${p}`;
      attrs.set(PathAttributeName, p);
    }
    const n: string = asTableName(inst.moduleName, inst.name);
    const rowObj: Object = inst.attributesAsObject();
    await insertRow(n, rowObj);
    return inst;
  }

  public override async upsertInstance(inst: Instance): Promise<Instance> {
    return inst;
  }

  public override async updateInstance(inst: Instance): Promise<Instance> {
    return inst;
  }

  public override async queryInstances(inst: Instance): Promise<Instance[]> {
    return getMany(
      asTableName(inst.moduleName, inst.name),
      inst.queryAttributesAsObject(),
      inst.queryAttributeValuesAsObject()
    );
  }

  public override async deleteInstance(inst: Instance): Promise<Instance> {
    return inst;
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
  const row = Object.fromEntries(attrs);
  await insertRow(n, row);
}
