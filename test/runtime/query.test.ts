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
    let insts: Instance[] = await q(`{${entName}? {}, @orderBy(id) @desc}`);
    assert(insts[0].lookup('id') == 3);
    insts = await q(`{${entName}? {}, @orderBy(id)}`);
    assert(insts[0].lookup('id') == 1);
    insts = await q(`{${entName} {mp @max(price)}, @groupBy(id)}`);
    assert(insts[0].lookup('price') == insts[0].lookup('mp'));
    insts = await q(`{${entName} {mp @max(price)}}`, 1);
    assert(insts[0].lookup('mp') == 784.42);
  });
});

describe('olap-test01', () => {
  test('olap tests for sales demo', async () => {
    const moduleName = 'olap01';
    await doInternModule(
      moduleName,
      `entity SalesFact {
          id UUID @id @default(uuid()),
          sale_id Int @indexed,
          date_id Int,
          product_id Int,
          region_id Int,
          revenue Decimal,
          quantity Int
      }
      entity DateDim {
        id UUID @id @default(uuid()),
        date_id Int,
        year Int,
        quarter Int,
        month Int
      }
      entity ProductDim {
        id UUID @id @default(uuid()),
        product_id Int,
        category String,
        product String
      }
      entity RegionDim {
        id UUID @id @default(uuid()),
        region_id Int,
        country String,
        state String,
        city String
    }

    workflow totalRevenueByYear {
      {SalesFact? {},
       @join DateDim {date_id? SalesFact.date_id},
       @groupBy(DateDim.year),
       @orderBy(DateDim.year),
       @into {year DateDim.year, total_revenue @sum(SalesFact.revenue)}
      }
    }
  `
    );
    // create data
    const date_dims = [
      [1, 2024, 1, 2],
      [2, 2024, 1, 1],
      [3, 2023, 2, 4],
      [4, 2023, 4, 12],
    ];
    const dateDimsEnt = `${moduleName}/DateDim`;
    for (let i = 0; i < date_dims.length; ++i) {
      const xs = date_dims[i];
      const inst = await parseAndEvaluateStatement(`{${dateDimsEnt} {
      date_id ${xs[0]},
      year ${xs[1]},
      quarter ${xs[2]},
      month ${xs[3]}
    }}`);
      assert(isInstanceOfType(inst, dateDimsEnt));
    }
    const sales_facts = [
      [101, 1, 501, 603, 56788.89, 12],
      [102, 1, 502, 604, 45000.0, 10],
      [103, 2, 501, 601, 22001.1, 5],
    ];
    const salesFactEnt = `${moduleName}/SalesFact`;
    let totrev1 = 0
    for (let i = 0; i < sales_facts.length; ++i) {
      const xs = sales_facts[i];
      const inst = await parseAndEvaluateStatement(`{${salesFactEnt} {
      sale_id ${xs[0]},
      date_id ${xs[1]},
      product_id ${xs[2]},
      region_id ${xs[3]},
      revenue ${xs[4]},
      quantity ${xs[5]}
    }}`);
      assert(isInstanceOfType(inst, salesFactEnt));
      totrev1 += xs[4]
    }

    const r1: any[] = await parseAndEvaluateStatement(`{${moduleName}/totalRevenueByYear {}}`)
    assert(r1.length == 1)
    assert(r1[0].year == 2024)
    assert(r1[0].total_revenue == totrev1)
  });
});
