import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';

// ─── CREATION TESTS ────────────────────────────────────────────────────────────

describe('Expression attributes on creation', () => {
  test('basic arithmetic expression is computed on create', async () => {
    await doInternModule(
      'ExprCreate01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprCreate01/E {id 1, x 5}}`);
    assert(isInstanceOfType(inst, 'ExprCreate01/E'));
    assert(inst.lookup('x') === 5);
    assert(inst.lookup('y') === 50);
  });

  test('chained expressions: later expr depends on earlier expr', async () => {
    await doInternModule(
      'ExprCreate02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10),
        z Int @expr(y + 1)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprCreate02/E {id 1, x 3}}`);
    assert(inst.lookup('y') === 30);
    assert(inst.lookup('z') === 31);
  });

  test('expression with addition and subtraction', async () => {
    await doInternModule(
      'ExprCreate03',
      `entity E {
        id Int @id,
        a Int,
        b Int,
        c Int @expr(a + b - 5)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprCreate03/E {id 1, a 20, b 10}}`);
    assert(inst.lookup('c') === 25);
  });

  test('expression with division', async () => {
    await doInternModule(
      'ExprCreate04',
      `entity E {
        id Int @id,
        total Int,
        count Int,
        avg Int @expr(total / count)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(
      `{ExprCreate04/E {id 1, total 100, count 4}}`
    );
    assert(inst.lookup('avg') === 25);
  });

  test('expression with negation', async () => {
    await doInternModule(
      'ExprCreate05',
      `entity E {
        id Int @id,
        x Int,
        neg Int @expr(-x)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprCreate05/E {id 1, x 42}}`);
    assert(inst.lookup('neg') === -42);
  });

  test('expression with parenthesized grouping', async () => {
    await doInternModule(
      'ExprCreate06',
      `entity E {
        id Int @id,
        a Int,
        b Int,
        c Int,
        result Int @expr((a + b) * c)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(
      `{ExprCreate06/E {id 1, a 2, b 3, c 4}}`
    );
    assert(inst.lookup('result') === 20);
  });

  test('multiple independent expressions', async () => {
    await doInternModule(
      'ExprCreate07',
      `entity E {
        id Int @id,
        x Int,
        doubled Int @expr(x * 2),
        squared Int @expr(x * x),
        plusTen Int @expr(x + 10)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprCreate07/E {id 1, x 7}}`);
    assert(inst.lookup('doubled') === 14);
    assert(inst.lookup('squared') === 49);
    assert(inst.lookup('plusTen') === 17);
  });

  test('expression attributes are optional - not required on create', async () => {
    await doInternModule(
      'ExprCreate08',
      `entity E {
        id Int @id,
        x Int,
        computed Int @expr(x + 100)
      }`
    );
    // We don't pass 'computed', it should be automatically calculated
    const inst: Instance = await parseAndEvaluateStatement(`{ExprCreate08/E {id 1, x 5}}`);
    assert(inst.lookup('computed') === 105);
  });

  test('creating multiple instances computes expressions independently', async () => {
    await doInternModule(
      'ExprCreate09',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * x)
      }`
    );
    const e1: Instance = await parseAndEvaluateStatement(`{ExprCreate09/E {id 1, x 3}}`);
    const e2: Instance = await parseAndEvaluateStatement(`{ExprCreate09/E {id 2, x 7}}`);
    const e3: Instance = await parseAndEvaluateStatement(`{ExprCreate09/E {id 3, x 0}}`);
    assert(e1.lookup('y') === 9);
    assert(e2.lookup('y') === 49);
    assert(e3.lookup('y') === 0);
  });

  test('deep chain of 4 dependent expressions', async () => {
    await doInternModule(
      'ExprCreate10',
      `entity E {
        id Int @id,
        x Int,
        a Int @expr(x + 1),
        b Int @expr(a * 2),
        c Int @expr(b + a),
        d Int @expr(c * x)
      }`
    );
    // x=5 -> a=6, b=12, c=18, d=90
    const inst: Instance = await parseAndEvaluateStatement(`{ExprCreate10/E {id 1, x 5}}`);
    assert(inst.lookup('a') === 6);
    assert(inst.lookup('b') === 12);
    assert(inst.lookup('c') === 18);
    assert(inst.lookup('d') === 90);
  });
});

// ─── UPDATE TESTS ──────────────────────────────────────────────────────────────

describe('Expression attributes on update', () => {
  test('expr is recomputed when a source attribute is updated', async () => {
    await doInternModule(
      'ExprUpdate01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    // Create
    const created: Instance = await parseAndEvaluateStatement(`{ExprUpdate01/E {id 1, x 5}}`);
    assert(created.lookup('y') === 50);

    // Update x from 5 to 8
    const updated: Instance[] = await parseAndEvaluateStatement(`{ExprUpdate01/E {id? 1, x 8}}`);
    assert(updated.length === 1);
    assert(updated[0].lookup('x') === 8);
    assert(updated[0].lookup('y') === 80);
  });

  test('chained expressions recompute correctly on update', async () => {
    await doInternModule(
      'ExprUpdate02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10),
        z Int @expr(y + 1)
      }`
    );
    const created: Instance = await parseAndEvaluateStatement(`{ExprUpdate02/E {id 1, x 3}}`);
    assert(created.lookup('y') === 30);
    assert(created.lookup('z') === 31);

    // Update x from 3 to 7
    const updated: Instance[] = await parseAndEvaluateStatement(`{ExprUpdate02/E {id? 1, x 7}}`);
    assert(updated.length === 1);
    assert(updated[0].lookup('x') === 7);
    assert(updated[0].lookup('y') === 70);
    assert(updated[0].lookup('z') === 71);
  });

  test('multiple updates recompute expr each time', async () => {
    await doInternModule(
      'ExprUpdate03',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 2)
      }`
    );
    await parseAndEvaluateStatement(`{ExprUpdate03/E {id 1, x 10}}`);

    // First update
    let updated: Instance[] = await parseAndEvaluateStatement(`{ExprUpdate03/E {id? 1, x 20}}`);
    assert(updated[0].lookup('y') === 40);

    // Second update
    updated = await parseAndEvaluateStatement(`{ExprUpdate03/E {id? 1, x 50}}`);
    assert(updated[0].lookup('y') === 100);

    // Third update
    updated = await parseAndEvaluateStatement(`{ExprUpdate03/E {id? 1, x 0}}`);
    assert(updated[0].lookup('y') === 0);
  });

  test('expr recomputes with multi-attribute expression on update', async () => {
    await doInternModule(
      'ExprUpdate04',
      `entity E {
        id Int @id,
        a Int,
        b Int,
        sum Int @expr(a + b)
      }`
    );
    const created: Instance = await parseAndEvaluateStatement(
      `{ExprUpdate04/E {id 1, a 10, b 20}}`
    );
    assert(created.lookup('sum') === 30);

    // Update only a
    const upd1: Instance[] = await parseAndEvaluateStatement(`{ExprUpdate04/E {id? 1, a 50}}`);
    assert(upd1[0].lookup('sum') === 70); // 50 + 20

    // Update only b
    const upd2: Instance[] = await parseAndEvaluateStatement(`{ExprUpdate04/E {id? 1, b 100}}`);
    assert(upd2[0].lookup('sum') === 150); // 50 + 100
  });

  test('update both source attributes at once recomputes expr', async () => {
    await doInternModule(
      'ExprUpdate05',
      `entity E {
        id Int @id,
        a Int,
        b Int,
        product Int @expr(a * b)
      }`
    );
    await parseAndEvaluateStatement(`{ExprUpdate05/E {id 1, a 3, b 4}}`);

    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprUpdate05/E {id? 1, a 10, b 20}}`
    );
    assert(updated[0].lookup('product') === 200);
  });

  test('update non-expr-source attribute does not break expr value', async () => {
    await doInternModule(
      'ExprUpdate06',
      `entity E {
        id Int @id,
        x Int,
        label String,
        computed Int @expr(x * 5)
      }`
    );
    const created: Instance = await parseAndEvaluateStatement(
      `{ExprUpdate06/E {id 1, x 4, label "initial"}}`
    );
    assert(created.lookup('computed') === 20);

    // Update label only - computed should still be recalculated from x
    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprUpdate06/E {id? 1, label "changed"}}`
    );
    assert(updated[0].lookup('label') === 'changed');
    assert(updated[0].lookup('computed') === 20); // Should still be x*5 = 4*5 = 20
  });

  test('query after update returns recomputed expr values', async () => {
    await doInternModule(
      'ExprUpdate07',
      `entity E {
        id Int @id,
        x Int,
        doubled Int @expr(x * 2)
      }`
    );
    await parseAndEvaluateStatement(`{ExprUpdate07/E {id 1, x 5}}`);
    await parseAndEvaluateStatement(`{ExprUpdate07/E {id? 1, x 15}}`);

    // Query to verify the persisted values
    const results: Instance[] = await parseAndEvaluateStatement(`{ExprUpdate07/E {id? 1}}`);
    assert(results.length === 1);
    assert(results[0].lookup('x') === 15);
    assert(results[0].lookup('doubled') === 30);
  });

  test('update one of multiple instances only recomputes that instance', async () => {
    await doInternModule(
      'ExprUpdate08',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x + 100)
      }`
    );
    await parseAndEvaluateStatement(`{ExprUpdate08/E {id 1, x 1}}`);
    await parseAndEvaluateStatement(`{ExprUpdate08/E {id 2, x 2}}`);
    await parseAndEvaluateStatement(`{ExprUpdate08/E {id 3, x 3}}`);

    // Update only id=2
    await parseAndEvaluateStatement(`{ExprUpdate08/E {id? 2, x 20}}`);

    // Query all to verify
    const all: Instance[] = await parseAndEvaluateStatement(`{ExprUpdate08/E? {}}`);
    assert(all.length === 3);

    const byId = new Map<number, Instance>();
    all.forEach((inst: Instance) => byId.set(inst.lookup('id'), inst));

    assert(byId.get(1)!.lookup('y') === 101); // unchanged
    assert(byId.get(2)!.lookup('y') === 120); // recomputed: 20 + 100
    assert(byId.get(3)!.lookup('y') === 103); // unchanged
  });
});

// ─── UPSERT TESTS ──────────────────────────────────────────────────────────────

describe('Expression attributes with upsert', () => {
  test('upsert creates with expr computed', async () => {
    await doInternModule(
      'ExprUpsert01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 3)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(
      `{ExprUpsert01/E {id 1, x 10}, @upsert}`
    );
    assert(isInstanceOfType(inst, 'ExprUpsert01/E'));
    assert(inst.lookup('y') === 30);
  });

  test('upsert updates with expr recomputed', async () => {
    await doInternModule(
      'ExprUpsert02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 3)
      }`
    );
    // First upsert (creates)
    await parseAndEvaluateStatement(`{ExprUpsert02/E {id 1, x 10}, @upsert}`);

    // Second upsert (updates)
    await parseAndEvaluateStatement(`{ExprUpsert02/E {id 1, x 20}, @upsert}`);

    const results: Instance[] = await parseAndEvaluateStatement(`{ExprUpsert02/E {id? 1}}`);
    assert(results.length === 1);
    assert(results[0].lookup('x') === 20);
    assert(results[0].lookup('y') === 60);
  });
});

// ─── WORKFLOW-BASED UPDATE TESTS ────────────────────────────────────────────────

describe('Expression attributes with workflow-based updates', () => {
  test('workflow update recomputes expr', async () => {
    await doInternModule(
      'ExprWf01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }
      workflow UpdateX {
        {E {id? UpdateX.id, x UpdateX.newX}} @as [e];
        e
      }`
    );
    const created: Instance = await parseAndEvaluateStatement(`{ExprWf01/E {id 1, x 5}}`);
    assert(created.lookup('y') === 50);

    const updated: Instance = await parseAndEvaluateStatement(`{ExprWf01/UpdateX {id 1, newX 12}}`);
    assert(isInstanceOfType(updated, 'ExprWf01/E'));
    assert(updated.lookup('x') === 12);
    assert(updated.lookup('y') === 120);
  });

  test('workflow update with chained expressions', async () => {
    await doInternModule(
      'ExprWf02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x + 1),
        z Int @expr(y * 2)
      }
      workflow UpdateX {
        {E {id? UpdateX.id, x UpdateX.newX}} @as [e];
        e
      }`
    );
    // Create: x=10, y=11, z=22
    await parseAndEvaluateStatement(`{ExprWf02/E {id 1, x 10}}`);

    // Update via workflow: x=20, y=21, z=42
    const updated: Instance = await parseAndEvaluateStatement(`{ExprWf02/UpdateX {id 1, newX 20}}`);
    assert(updated.lookup('x') === 20);
    assert(updated.lookup('y') === 21);
    assert(updated.lookup('z') === 42);
  });
});

// ─── EDGE CASES ─────────────────────────────────────────────────────────────────

describe('Expression attributes edge cases', () => {
  test('expression with zero values', async () => {
    await doInternModule(
      'ExprEdge01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 100)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprEdge01/E {id 1, x 0}}`);
    assert(inst.lookup('y') === 0);
  });

  test('expression with negative values', async () => {
    await doInternModule(
      'ExprEdge02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprEdge02/E {id 1, x -3}}`);
    assert(inst.lookup('y') === -30);
  });

  test('expression with large numbers', async () => {
    await doInternModule(
      'ExprEdge03',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * x)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprEdge03/E {id 1, x 1000}}`);
    assert(inst.lookup('y') === 1000000);
  });

  test('expression referencing attribute defined after it', async () => {
    // The attribute 'k' is defined after the @expr that uses it
    await doInternModule(
      'ExprEdge04',
      `entity E {
        id Int @id,
        result Int @expr(k * 2),
        k Int
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(`{ExprEdge04/E {id 1, k 15}}`);
    assert(inst.lookup('result') === 30);
  });

  test('expr with complex nested arithmetic', async () => {
    await doInternModule(
      'ExprEdge05',
      `entity E {
        id Int @id,
        a Int,
        b Int,
        c Int,
        result Int @expr((a + b) * (c - a) + b)
      }`
    );
    // (2 + 3) * (10 - 2) + 3 = 5 * 8 + 3 = 43
    const inst: Instance = await parseAndEvaluateStatement(`{ExprEdge05/E {id 1, a 2, b 3, c 10}}`);
    assert(inst.lookup('result') === 43);
  });

  test('string concatenation with + operator in expr', async () => {
    await doInternModule(
      'ExprEdge06',
      `entity E {
        id Int @id,
        first String,
        last String,
        full String @expr(first + " " + last)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(
      `{ExprEdge06/E {id 1, first "John", last "Doe"}}`
    );
    assert(inst.lookup('full') === 'John Doe');
  });

  test('string expr recomputes on update', async () => {
    await doInternModule(
      'ExprEdge07',
      `entity E {
        id Int @id,
        first String,
        last String,
        full String @expr(first + " " + last)
      }`
    );
    await parseAndEvaluateStatement(`{ExprEdge07/E {id 1, first "John", last "Doe"}}`);

    // Update first name
    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprEdge07/E {id? 1, first "Jane"}}`
    );
    assert(updated[0].lookup('full') === 'Jane Doe');
  });
});

// ─── QUERY BEHAVIOR TESTS ──────────────────────────────────────────────────────

describe('Expression attributes and queries', () => {
  test('query returns correctly computed expr values', async () => {
    await doInternModule(
      'ExprQuery01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    await parseAndEvaluateStatement(`{ExprQuery01/E {id 1, x 5}}`);
    await parseAndEvaluateStatement(`{ExprQuery01/E {id 2, x 8}}`);

    const results: Instance[] = await parseAndEvaluateStatement(`{ExprQuery01/E? {}}`);
    assert(results.length === 2);

    const byId = new Map<number, Instance>();
    results.forEach((inst: Instance) => byId.set(inst.lookup('id'), inst));

    assert(byId.get(1)!.lookup('y') === 50);
    assert(byId.get(2)!.lookup('y') === 80);
  });

  test('query by id returns correct expr values after update', async () => {
    await doInternModule(
      'ExprQuery02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x + 1000)
      }`
    );
    await parseAndEvaluateStatement(`{ExprQuery02/E {id 1, x 1}}`);
    await parseAndEvaluateStatement(`{ExprQuery02/E {id? 1, x 99}}`);

    const results: Instance[] = await parseAndEvaluateStatement(`{ExprQuery02/E {id? 1}}`);
    assert(results.length === 1);
    assert(results[0].lookup('x') === 99);
    assert(results[0].lookup('y') === 1099);
  });
});

// ─── COMPARISON EXPRESSIONS IN ATTRIBUTES ───────────────────────────────────────

describe('Expression attributes with comparison operators', () => {
  test('boolean expr with greater-than', async () => {
    await doInternModule(
      'ExprCmp01',
      `entity E {
        id Int @id,
        score Int,
        passing Boolean @expr(score > 50)
      }`
    );
    const pass: Instance = await parseAndEvaluateStatement(`{ExprCmp01/E {id 1, score 75}}`);
    assert(pass.lookup('passing') === true);

    const fail: Instance = await parseAndEvaluateStatement(`{ExprCmp01/E {id 2, score 30}}`);
    assert(fail.lookup('passing') === false);
  });

  test('boolean expr recomputes on update', async () => {
    await doInternModule(
      'ExprCmp02',
      `entity E {
        id Int @id,
        score Int,
        passing Boolean @expr(score >= 60)
      }`
    );
    await parseAndEvaluateStatement(`{ExprCmp02/E {id 1, score 50}}`);

    // Initially failing
    let results: Instance[] = await parseAndEvaluateStatement(`{ExprCmp02/E {id? 1}}`);
    assert(results[0].lookup('passing') === false);

    // Update to passing
    await parseAndEvaluateStatement(`{ExprCmp02/E {id? 1, score 80}}`);
    results = await parseAndEvaluateStatement(`{ExprCmp02/E {id? 1}}`);
    assert(results[0].lookup('passing') === true);
  });

  test('equality comparison in expr', async () => {
    await doInternModule(
      'ExprCmp03',
      `entity E {
        id Int @id,
        x Int,
        isZero Boolean @expr(x == 0)
      }`
    );
    const zero: Instance = await parseAndEvaluateStatement(`{ExprCmp03/E {id 1, x 0}}`);
    assert(zero.lookup('isZero') === true);

    const nonZero: Instance = await parseAndEvaluateStatement(`{ExprCmp03/E {id 2, x 5}}`);
    assert(nonZero.lookup('isZero') === false);
  });
});

// ─── USER-PROVIDED VALUE VS EXPRESSION ──────────────────────────────────────────

describe('User-provided value for @expr attribute on creation', () => {
  test('user-provided value overrides expr on create', async () => {
    await doInternModule(
      'ExprOverride01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    // User provides y=999 - user value should win over expr (x*10=50)
    const inst: Instance = await parseAndEvaluateStatement(`{ExprOverride01/E {id 1, x 5, y 999}}`);
    assert(inst.lookup('x') === 5);
    assert(inst.lookup('y') === 999, `Expected y=999 (user provided), got y=${inst.lookup('y')}`);
  });

  test('user-provided values override chained expressions on create', async () => {
    await doInternModule(
      'ExprOverride02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10),
        z Int @expr(y + 1)
      }`
    );
    // User provides y=500, z=600 - both user values should win
    const inst: Instance = await parseAndEvaluateStatement(
      `{ExprOverride02/E {id 1, x 3, y 500, z 600}}`
    );
    assert(inst.lookup('y') === 500, `Expected y=500 (user provided), got y=${inst.lookup('y')}`);
    assert(inst.lookup('z') === 600, `Expected z=600 (user provided), got z=${inst.lookup('z')}`);
  });

  test('user-provided value overrides string expr on create', async () => {
    await doInternModule(
      'ExprOverride03',
      `entity E {
        id Int @id,
        first String,
        last String,
        full String @expr(first + " " + last)
      }`
    );
    const inst: Instance = await parseAndEvaluateStatement(
      `{ExprOverride03/E {id 1, first "John", last "Doe", full "Custom Name"}}`
    );
    assert(
      inst.lookup('full') === 'Custom Name',
      `Expected full="Custom Name" (user provided), got full="${inst.lookup('full')}"`
    );
  });

  test('user-provided override on create persists to storage', async () => {
    await doInternModule(
      'ExprOverride04',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x + 100)
      }`
    );
    // User provides y=0 - user value should win over expr (x+100=105)
    await parseAndEvaluateStatement(`{ExprOverride04/E {id 1, x 5, y 0}}`);

    const results: Instance[] = await parseAndEvaluateStatement(`{ExprOverride04/E {id? 1}}`);
    assert(results.length === 1);
    assert(
      results[0].lookup('y') === 0,
      `Expected persisted y=0 (user provided), got y=${results[0].lookup('y')}`
    );
  });

  test('expr computes normally when user does not provide value on create', async () => {
    await doInternModule(
      'ExprOverride05',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    // User does NOT provide y - expr should compute it
    const inst: Instance = await parseAndEvaluateStatement(`{ExprOverride05/E {id 1, x 5}}`);
    assert(inst.lookup('y') === 50, `Expected y=50 (from expr), got y=${inst.lookup('y')}`);
  });
});

describe('User-provided value for @expr attribute on update', () => {
  test('user-provided value overrides expr on update', async () => {
    await doInternModule(
      'ExprOverrideUp01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    // Create: x=5, y=50 (from expr)
    await parseAndEvaluateStatement(`{ExprOverrideUp01/E {id 1, x 5}}`);

    // Update: change x to 8, but also explicitly provide y=999
    // On update, user-provided values for @expr attributes win over the expression.
    // The origAttrs re-evaluation in computeExprAttributes() runs after expr evaluation,
    // so the user's literal value overwrites the expr-computed value.
    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprOverrideUp01/E {id? 1, x 8, y 999}}`
    );
    assert(updated.length === 1);
    assert(updated[0].lookup('x') === 8);
    assert(
      updated[0].lookup('y') === 999,
      `Expected user value 999 to win on update, got ${updated[0].lookup('y')}`
    );
  });

  test('user-provided expr attr override persists to storage', async () => {
    await doInternModule(
      'ExprOverrideUp02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    await parseAndEvaluateStatement(`{ExprOverrideUp02/E {id 1, x 5}}`);

    // Update with explicit y=999
    await parseAndEvaluateStatement(`{ExprOverrideUp02/E {id? 1, x 8, y 999}}`);

    // Query to verify the user override was persisted
    const results: Instance[] = await parseAndEvaluateStatement(`{ExprOverrideUp02/E {id? 1}}`);
    assert(results.length === 1);
    assert(results[0].lookup('x') === 8);
    assert(
      results[0].lookup('y') === 999,
      `Expected persisted y=999, got ${results[0].lookup('y')}`
    );
  });

  test('user-provided value for only the expr attr (no source change) on update', async () => {
    await doInternModule(
      'ExprOverrideUp03',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    // Create: x=5, y=50
    await parseAndEvaluateStatement(`{ExprOverrideUp03/E {id 1, x 5}}`);

    // Update: only provide y=999, don't change x
    // User value should still win on update
    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprOverrideUp03/E {id? 1, y 999}}`
    );
    assert(updated.length === 1);
    assert(
      updated[0].lookup('y') === 999,
      `Expected user value 999 on update, got ${updated[0].lookup('y')}`
    );
  });

  test('subsequent update without user override reverts to expr-computed value', async () => {
    await doInternModule(
      'ExprOverrideUp04',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    // Create: x=5, y=50
    await parseAndEvaluateStatement(`{ExprOverrideUp04/E {id 1, x 5}}`);

    // Update with explicit y override
    await parseAndEvaluateStatement(`{ExprOverrideUp04/E {id? 1, x 8, y 999}}`);

    // Now update again, only changing x, NOT providing y
    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprOverrideUp04/E {id? 1, x 12}}`
    );
    assert(updated.length === 1);
    // Since user didn't provide y this time, the expr should compute y = 12 * 10 = 120
    assert(
      updated[0].lookup('y') === 120,
      `Expected y=120 from expr after normal update, got y=${updated[0].lookup('y')}`
    );
  });

  test('user override on update with chained expressions', async () => {
    await doInternModule(
      'ExprOverrideUp05',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x + 1),
        z Int @expr(y * 2)
      }`
    );
    // Create: x=10, y=11, z=22
    await parseAndEvaluateStatement(`{ExprOverrideUp05/E {id 1, x 10}}`);

    // Update: provide explicit y=100, don't change x
    // The user override for y happens AFTER all @expr attributes are evaluated.
    // So z's expression (y * 2) uses the expr-computed y (x+1=11), not the user's y=100.
    // Then the user override sets y=100 in the final result.
    // Net effect: y=100 (user override), z=22 (from expr using expr-computed y=11)
    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprOverrideUp05/E {id? 1, y 100}}`
    );
    assert(updated.length === 1);
    const yVal = updated[0].lookup('y');
    const zVal = updated[0].lookup('z');
    assert(yVal === 100, `Expected y=100 (user override), got y=${yVal}`);
    assert(
      zVal === 22,
      `Expected z=22 (expr used expr-computed y=11, not user's y=100), got z=${zVal}`
    );
  });

  test('upsert create: user-provided value overrides expr', async () => {
    await doInternModule(
      'ExprOverrideUps01',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    // First upsert (creates) with explicit y - user value should win
    const created: Instance = await parseAndEvaluateStatement(
      `{ExprOverrideUps01/E {id 1, x 5, y 999}, @upsert}`
    );
    assert(
      created.lookup('y') === 999,
      `Expected y=999 on upsert-create (user wins), got y=${created.lookup('y')}`
    );
  });

  test('upsert update: user-provided value overrides expr', async () => {
    await doInternModule(
      'ExprOverrideUps02',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x * 10)
      }`
    );
    // Create via upsert
    await parseAndEvaluateStatement(`{ExprOverrideUps02/E {id 1, x 5}, @upsert}`);

    // Second upsert (updates) with explicit y - user value should win
    const upserted: Instance = await parseAndEvaluateStatement(
      `{ExprOverrideUps02/E {id 1, x 8, y 777}, @upsert}`
    );
    assert(
      upserted.lookup('y') === 777,
      `Expected y=777 on upsert-update (user wins), got y=${upserted.lookup('y')}`
    );
  });
});
