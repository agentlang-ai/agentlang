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

    // Total Revenue by Year
    // SELECT d.year, SUM(f.revenue) AS total_revenue
    // FROM sales_fact f
    // JOIN date_dim d ON f.date_id = d.date_id
    // GROUP BY d.year
    // ORDER BY d.year
    workflow totalRevenueByYear {
      {
        SalesFact? {},
        @join DateDim {date_id? SalesFact.date_id},
        @into {year DateDim.year, total_revenue @sum(SalesFact.revenue)},
        @groupBy(DateDim.year),
        @orderBy(DateDim.year)
      }
    }

    // Drill down - revenue by year, quarter and month.
    // SELECT d.year, d.quarter, d.month, SUM(f.revenue) AS total_revenue
    // FROM sales_fact f
    // JOIN date_dim d ON f.date_id = d.date_id
    // GROUP BY d.year, d.quarter, d.month
    // ORDER BY d.year, d.quarter, d.month
    workflow revenueByYearQuarterMonth {
        {
          SalesFact? {},
          @join DateDim {date_id? SalesFact.date_id},
          @into {year DateDim.year, quarter DateDim.quarter, month DateDim.month, total_revenue @sum(SalesFact.revenue)},
          @groupBy(DateDim.year, DateDim.quarter, DateDim.month),
          @orderBy(DateDim.year, DateDim.quarter, DateDim.month)
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
    const crsf = async (xs: number[]) => {
      return await parseAndEvaluateStatement(`{${salesFactEnt} {
      sale_id ${xs[0]},
      date_id ${xs[1]},
      product_id ${xs[2]},
      region_id ${xs[3]},
      revenue ${xs[4]},
      quantity ${xs[5]}
    }}`);
    };
    let totrev1 = 0;
    for (let i = 0; i < sales_facts.length; ++i) {
      const xs = sales_facts[i];
      const inst = await crsf(xs);
      assert(isInstanceOfType(inst, salesFactEnt));
      totrev1 += xs[4];
    }

    const r1: any[] = await parseAndEvaluateStatement(`{${moduleName}/totalRevenueByYear {}}`);
    const rby = (r: any[]) => {
      assert(r.length == 1);
      assert(r[0].year == 2024);
      assert(r[0].total_revenue == totrev1);
    };
    rby(r1);
    const r2: any[] = await parseAndEvaluateStatement(
      `{${moduleName}/revenueByYearQuarterMonth {}}`
    );
    const rbyqm = (r: any[]) => {
      assert(r.length == 2);
      assert(r[0].year == 2024);
      assert(r[0].quarter == 1);
      assert(r[0].month == 1);
      assert(r[0].total_revenue == 22001.1);
      assert(r[1].year == 2024);
      assert(r[1].quarter == 1);
      assert(r[1].month == 2);
      assert(r[1].total_revenue == 56788.89 + 45000);
    };
    rbyqm(r2)

    await crsf([104, 3, 501, 604, 10000.0, 3]);
    const r3: any[] = await parseAndEvaluateStatement(`{${moduleName}/totalRevenueByYear {}}`);
    assert(r3.length == 2);
    assert(r3[0].year == 2023);
    assert(r3[0].total_revenue == 10000.0);
    rby(r3.slice(1))
    const r4: any[] = await parseAndEvaluateStatement(
      `{${moduleName}/revenueByYearQuarterMonth {}}`
    );
    assert(r4.length == 3)
    assert(r4[0].year == 2023)
    assert(r4[0].quarter == 2)
    assert(r4[0].month == 4)
    rbyqm(r4.slice(1))
  });
});
