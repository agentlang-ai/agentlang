import { AttributeEntry, findIdAttribute, Instance, InstanceAttributes } from '../../module.js';
import { Resolver } from '../interface.js';
import { asTableName } from './dbutil.js';
import { insertRow, PathAttributeName } from './schema.js';

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

  public override async createInstance(inst: Instance): Promise<Instance | undefined> {
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

  public override upsertInstance(inst: Instance): Instance | undefined {
    return inst;
  }

  public override updateInstance(inst: Instance): Instance | null | undefined {
    return inst;
  }

  public override queryInstances(inst: Instance): Instance[] | null | undefined {
    const result: Array<Instance> = new Array<Instance>();
    result.push(inst);
    return result;
  }

  public override deleteInstance(inst: Instance): Instance | null | undefined {
    return inst;
  }
}
