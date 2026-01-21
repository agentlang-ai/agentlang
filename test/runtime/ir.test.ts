// Tests for JSON-intermediate-representation
import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { parseJsonIR } from '../../src/runtime/agents/parse-ir.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';

const pr = (obj: any) => {
  if (obj.workflow || obj.patterns) return parseJsonIR(obj);
  return parseJsonIR({ patterns: [obj] });
};

describe('basic-crud-patterns', () => {
  test('translate and evaluate JSON-based CRUD', async () => {
    const moduleName = 'JsonCrud';
    await doInternModule(
      moduleName,
      `entity A {
           id Int @id, x String
        }
        entity B {
           id Int @id, y Int
        }
        relationship AB contains(A, B)   
        `
    );
    const aname = `${moduleName}/A`;
    const bname = `${moduleName}/B`;
    const rname = `${moduleName}/AB`;
    const obj1 = { create: aname, with: { id: { val: 1 }, x: { val: 'A01' } } };
    const pat1 = pr(obj1);
    const r1 = await parseAndEvaluateStatement(pat1[0]);
    assert(isInstanceOfType(r1, aname));

    const obj2 = {
      query: aname,
      where: { id: { '=': { val: 1 } } },
      links: [
        {
          relationship: rname,
          create: bname,
          with: { id: { val: 101 }, y: { val: 67 } },
        },
      ],
    };
    const pat2 = pr(obj2);
    const r2: Instance[] = await parseAndEvaluateStatement(pat2[0]);
    assert(isInstanceOfType(r2[0], aname));
    const rr2: Instance[] | undefined = r2[0].getRelatedInstances(rname);
    assert(rr2 !== undefined);
    assert(isInstanceOfType(rr2[0], bname));
  });
});

describe('control-patterns', () => {
  test('translate if and for-each', async () => {
    const obj1 = {
      workflow: {
        event: 'erp/notifyEmployees',
        patterns: [
          {
            query: 'erp/Employee',
            where: {
              salary: {
                '>': {
                  val: 1000,
                },
              },
            },
            as: 'employees',
          },
          {
            for: {
              each: {
                ref: 'employees',
              },
              as: 'emp',
              do: [
                {
                  create: 'erp/sendMail',
                  with: {
                    email: {
                      ref: 'emp.email',
                    },
                    body: {
                      val: 'You are selected for an increment!',
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    };
    const pat1 = pr(obj1);
    pat1;
  });
});
