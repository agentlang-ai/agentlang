import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';

describe('basic-aggregate-queries', () => {
  test('Aggegates like count, min and max', async () => {
    const moduleName = 'agq';
    await doInternModule(
      moduleName,
      `entity Product {
            id Int @id,
            name String,
            price Decimal
        }
        `
    );
    const entName = `${moduleName}/Product`;
    const isp = (inst: any) => {
      return (isInstanceOfType(inst, entName));
    };
    const crp = async (id: number, name: string, price: number): Promise<Instance> => {
      const inst: Instance = await parseAndEvaluateStatement(`{${entName} {
                id ${id},
                name "${name}",
                price ${price}
      }}`);
      assert(isp(inst));
      return inst;
    };
    await crp(1, 'p01', 673.44);
    await crp(2, 'p02', 784.42);
    const insts: Instance[] = await parseAndEvaluateStatement(`{${entName}? {}}`);
    assert(insts.length === 2);
    assert(insts.every(isp));
  });
});
