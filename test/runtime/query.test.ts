import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { objectToQueryPattern } from '../../src/language/parser.js';

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
    let totalPrice = 0.0
    const crp = async (id: number, name: string, price: number): Promise<Instance> => {
      const inst: Instance = await parseAndEvaluateStatement(`{${entName} {
                id ${id},
                name "${name}",
                price ${price}
      }}`);
      assert(isp(inst));
      totalPrice += price
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
    insts = await q(`{${entName} {mp? @max(price)}, @groupBy(__path__)}`);
    let tp = 0.0
    insts.forEach((inst: Instance) => {
      tp += Number(inst.lookup('mp'))
    })
    assert(Math.round(tp) == Math.round(totalPrice))
    insts = await q(`{${entName} {mp? @max(price)}}`, 1);
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

    // Slice - revenue for a Single Year (e.g., 2024)
    // SELECT p.category, SUM(f.revenue) AS revenue
    // FROM sales_fact f
    // JOIN product_dim p ON f.product_id = p.product_id
    // JOIN date_dim d ON f.date_id = d.date_id
    // WHERE d.year = 2024
    // GROUP BY p.category
    workflow revenueForYear {
        {
           SalesFact? {},
           @join ProductDim {product_id? SalesFact.product_id},
           @join DateDim {date_id? SalesFact.date_id},
           @into {category ProductDim.category, revenue @sum(SalesFact.revenue)},
           @where {DateDim.year? revenueForYear.year},
           @groupBy(ProductDim.category)
        }
    }

    // Dice - revenue for a particular category (e.g 'Electronics') in a country during a year.
    // SELECT r.state, SUM(f.revenue) AS revenue
    // FROM sales_fact f
    // JOIN product_dim p ON f.product_id = p.product_id
    // JOIN region_dim r ON f.region_id = r.region_id
    // JOIN date_dim d ON f.date_id = d.date_id
    // WHERE d.year = 2024 AND p.category = 'Electronics' AND r.country = 'India'
    workflow categoryRevenueForYear {
        {
           SalesFact? {},
           @join ProductDim {product_id? SalesFact.product_id},
           @join RegionDim {region_id? SalesFact.region_id},
           @join DateDim {date_id? SalesFact.date_id},
           @into {state RegionDim.state, revenue @sum(SalesFact.revenue)},
           @where {ProductDim.category categoryRevenueForYear.category,
                   RegionDim.country categoryRevenueForYear.country,
                   DateDim.year? categoryRevenueForYear.year},
           @groupBy(RegionDim.state, SalesFact.revenue),
           @orderBy(revenue)
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
    const prod_dims = [
      [501, 'Cat01', 'Px501'],
      [502, 'Cat02', 'Px502'],
      [503, 'Cat01', 'Px503'],
    ];
    const prodDimsEnt = `${moduleName}/ProductDim`;
    for (let i = 0; i < prod_dims.length; ++i) {
      const xs = prod_dims[i];
      const inst = await parseAndEvaluateStatement(`{${prodDimsEnt} {
      product_id ${xs[0]},
      category "${xs[1]}",
      product "${xs[2]}"
    }}`);
      assert(isInstanceOfType(inst, prodDimsEnt));
    }
    const region_dims = [
      [601, 'India', 'Kerala', 'Kottayam'],
      [602, 'India', 'Tamilnadu', 'Chennai'],
      [603, 'USA', 'New York', 'New York'],
    ];
    const regionDimsEnt = `${moduleName}/RegionDim`;
    for (let i = 0; i < region_dims.length; ++i) {
      const xs = region_dims[i];
      const inst = await parseAndEvaluateStatement(`{${regionDimsEnt} {
      region_id ${xs[0]},
      country "${xs[1]}",
      state "${xs[2]}",
      city "${xs[3]}"
    }}`);
      assert(isInstanceOfType(inst, regionDimsEnt));
    }
    const sales_facts = [
      [101, 1, 501, 602, 56788.89, 12],
      [102, 1, 502, 603, 45000.0, 10],
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
    totrev1 = Math.round(totrev1);

    const r1: any[] = await parseAndEvaluateStatement(`{${moduleName}/totalRevenueByYear {}}`);
    const rby = (r: any[]) => {
      assert(r.length == 1);
      assert(r[0].year == 2024);
      const tr = Math.round(Number(r[0].total_revenue));
      assert(tr == totrev1);
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
      assert(Math.round(Number(r[0].total_revenue)) == Math.round(22001.1));
      assert(r[1].year == 2024);
      assert(r[1].quarter == 1);
      assert(r[1].month == 2);
      assert(Math.round(Number(r[1].total_revenue)) == Math.round(56788.89 + 45000));
    };
    rbyqm(r2);

    await crsf([104, 3, 501, 604, 10000.0, 3]);
    const r3: any[] = await parseAndEvaluateStatement(`{${moduleName}/totalRevenueByYear {}}`);
    assert(r3.length == 2);
    assert(r3[0].year == 2023);
    assert(Math.round(Number(r3[0].total_revenue)) == Math.round(10000.0));
    rby(r3.slice(1));
    const r4: any[] = await parseAndEvaluateStatement(
      `{${moduleName}/revenueByYearQuarterMonth {}}`
    );
    assert(r4.length == 3);
    assert(r4[0].year == 2023);
    assert(r4[0].quarter == 2);
    assert(r4[0].month == 4);
    rbyqm(r4.slice(1));

    const r5: any[] = await parseAndEvaluateStatement(`{${moduleName}/revenueForYear {year 2024}}`);
    const chkry = (r: any[]) => {
      assert(r.length == 2);
      assert(
        r.every((v: any) => {
          const r = v.category == 'Cat01' || v.category == 'Cat02';
          if (r) {
            if (v.category == 'Cat01') {
              return Math.round(Number(v.revenue)) == Math.round(56788.89 + 22001.1);
            } else {
              return Math.round(Number(v.revenue)) == 45000;
            }
          }
          return r;
        })
      );
    };
    chkry(r5)
    const r6: any[] = await parseAndEvaluateStatement(
      `{${moduleName}/categoryRevenueForYear {year 2024, category "Cat01", country "India"}}`
    );
    assert(r6.length === 2);
    assert(r6[0].state === 'Kerala' && Math.round(r6[0].revenue) === Math.round(22001.1));
    assert(r6[1].state === 'Tamilnadu' && Math.round(r6[1].revenue) === Math.round(56788.89));

    //
    // JSON encoded queries
    //
    const qobj1 = { 'olap01/SalesFact?': {} };
    const qs1 = objectToQueryPattern(qobj1);
    const qr1: Instance[] = await parseAndEvaluateStatement(qs1);
    assert(qr1.length === 4);
    assert(
      qr1.every((inst: Instance) => {
        return isInstanceOfType(inst, 'olap01/SalesFact');
      })
    );
    const qobj2 = {
      'olap01/SalesFact': { 'revenue?>=': 45000 },
    };
    const qs2 = objectToQueryPattern(qobj2);
    const qr2 = await parseAndEvaluateStatement(qs2);
    assert(qr2.length === 2);
    assert(
      qr2.every((inst: Instance) => {
        return isInstanceOfType(inst, 'olap01/SalesFact') && inst.lookup('revenue') >= 45000;
      })
    );

    // workflow revenueForYear:
    const qobj3 = {
      'olap01/SalesFact?': {},
      '@join': [
        ['olap01/ProductDim', { 'product_id?': 'olap01/SalesFact.product_id' }],
        ['olap01/DateDim', { 'date_id?': 'olap01/SalesFact.date_id' }],
      ],
      '@into': {
        category: 'olap01/ProductDim.category',
        revenue: '@sum(olap01/SalesFact.revenue)',
      },
      '@where': { 'olap01/DateDim.year?': 2024 },
      '@groupBy': ['olap01/ProductDim.category'],
    };
    const qs3 = objectToQueryPattern(qobj3);
    const qr3 = await parseAndEvaluateStatement(qs3);
    chkry(qr3);
  });
});
