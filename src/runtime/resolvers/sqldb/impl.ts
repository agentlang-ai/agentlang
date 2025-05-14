import { AttributeEntry, findIdAttribute, Instance, InstanceAttributes } from '../../module.js';
import { Resolver } from '../interface.js';
import { asTableName } from './dbutil.js';
import { getMany, insertRow, PathAttributeName } from './schema.js';

function addDefaultIdAttribute(inst: Instance): string | undefined {
  const attrEntry: AttributeEntry | undefined = findIdAttribute(inst)
  let attributes: InstanceAttributes = inst.getAttributes()
  if (attrEntry != undefined && attrEntry.props != undefined && !attributes.has(attrEntry.name)) {
    const d: any | undefined = attrEntry.props.get("default")
    if (d != undefined && d == "uuid()") {
      attributes.set(attrEntry.name, crypto.randomUUID())
      return attrEntry.name
    }
  }
  return undefined
}

export class SqlDbResolver extends Resolver {

  public override async createInstance(inst: Instance): Promise<Instance> {
    const idAttrName: string | undefined = addDefaultIdAttribute(inst)
    const attrs: InstanceAttributes = inst.getAttributes()
    if (idAttrName != undefined) {
      const idAttrVal: any = attrs.get(idAttrName)
      attrs.set(PathAttributeName, `${inst.moduleName}/${inst.name}/${idAttrVal}`)
    }
    const n: string = asTableName(inst.moduleName, inst.name);
    const rowObj: Object = inst.attributesAsObject()
    await insertRow(n, rowObj)
    return inst
  }

  public override async upsertInstance(inst: Instance): Promise<Instance> {
    return inst
  }

  public override async updateInstance(inst: Instance): Promise<Instance> {
    return inst
  }

  public override async queryInstances(inst: Instance): Promise<Instance[]> {
      return getMany(asTableName(inst.moduleName, inst.name), inst.queryAttributesAsObject(), inst.queryAttributeValuesAsObject())
  }

  public override async deleteInstance(inst: Instance): Promise<Instance> {
    return (inst)
  }
}
