import { Instance } from '../../module.js';
import { Resolver } from '../interface.js';
import { asTableName } from './dbutil.js';
import { insertRow } from './schema.js';

export class SqlDbResolver extends Resolver {
  public override createInstance(inst: Instance): Instance {
    const n: string = asTableName(inst.moduleName, inst.name);
    insertRow(n, inst.asObject());
    return inst;
  }
  public override upsertInstance(inst: Instance): Instance {
    return inst;
  }
  public override updateInstance(inst: Instance): Instance {
    return inst;
  }
  public override queryInstances(inst: Instance): Instance[] | null {
    const result: Array<Instance> = new Array<Instance>();
    result.push(inst);
    return result;
  }
  public override deleteInstance(inst: Instance): Instance | null {
    return inst;
  }
}
