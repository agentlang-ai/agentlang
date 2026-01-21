// Tests for JSON-intermediate-representation
import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { parseJsonIR } from '../../src/runtime/agents/parse-ir.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { parseWorkflow } from '../../src/language/parser.js';
import { isWorkflowDefinition } from '../../src/language/generated/ast.js';

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
              in: 'emp',
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
    assert(pat1[0] === `workflow erp/notifyEmployees {
        {erp/Employee {
        salary?> 1000}} @as employees;
for emp in employees {
      {erp/sendMail {
    email emp.email,
body "You are selected for an increment!"}}
  }
     }`)
    const r1 = await parseWorkflow(pat1[0]);
    assert(isWorkflowDefinition(r1));
    assert(r1.statements.length === 2);
    assert(r1.statements[0].pattern.crudMap);
    assert(r1.statements[1].pattern.forEach);
    assert(r1.statements[1].pattern.forEach?.statements.length === 1);
    assert(r1.statements[1].pattern.forEach?.statements[0].pattern.crudMap);

    const obj2 = {
      workflow: {
        event: 'mvd/validateLicense',
        patterns: [
          {
            create: 'mvd/checkLicenseNumber',
            with: {
              number: {
                ref: 'mvd/validateLicense.number',
              },
            },
            as: 'response',
          },
          {
            if: {
              condition: {
                '=': [
                  {
                    ref: 'response',
                  },
                  {
                    val: 'ok',
                  },
                ],
              },
              then: [
                {
                  val: 'active',
                },
              ],
              else: [
                {
                  val: 'canceled',
                },
              ],
              as: 'newStatus',
            },
          },
          {
            update: 'mvd/license',
            set: {
              status: {
                ref: 'newStatus',
              },
            },
            where: {
              number: {
                '=': {
                  ref: 'mvd/validateLicense.number',
                },
              },
            },
          },
        ],
      },
    };
    const pat2 = pr(obj2);
    assert(
      pat2[0] ===
        `workflow mvd/validateLicense {
        {mvd/checkLicenseNumber {
    number mvd/validateLicense.number}} @as response;
if (r) {
      "active"
  } else {

        "canceled"
    } @as newStatus;
{mvd/license {
    number? mvd/validateLicense.number,
    status newStatus}}
     }`
    );
    const r2 = await parseWorkflow(pat2[0]);
    assert(isWorkflowDefinition(r2));
    assert(r2.statements.length === 3);
    assert(r2.statements[0].pattern.crudMap);
    assert(r2.statements[1].pattern.if);
    assert(r2.statements[2].pattern.crudMap);
  });
});
