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
      return isInstanceOfType(inst, entName);
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
    await crp(3, 'p04', 500.0);
    const q = async (pat: string, n: number = 3): Promise<Instance[]> => {
      const insts: Instance[] = await parseAndEvaluateStatement(pat);
      assert(insts.length === n);
      assert(insts.every(isp));
      return insts;
    };
    let insts: Instance[] = await q(
      `{${entName}? {}, @orderBy(id) @desc}`
    );
    assert(insts[0].lookup('id') == 3);
    insts = await q(
      `{${entName}? {}, @orderBy(id)}`
    );
    assert(insts[0].lookup('id') == 1);
    insts = await q(
      `{${entName} {mp @max(price)}, @groupBy(id)}`
    );
    assert(insts[0].lookup('price') == insts[0].lookup('mp'))
    insts = await q(
      `{${entName} {mp @max(price)}}`, 1
    );
    assert(insts[0].lookup('mp') == 784.42)
  });
});
