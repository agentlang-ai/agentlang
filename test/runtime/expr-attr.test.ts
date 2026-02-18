import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { PathAttributeName } from '../../src/runtime/defs.js';
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

  test('user override of intermediate expr propagates to dependent expr on create', async () => {
    await doInternModule(
      'ExprOverride06',
      `entity E {
        id Int @id,
        x Int,
        y Int @expr(x + 1),
        z Int @expr(y * 2)
      }`
    );
    // User overrides y=100 but does NOT provide z
    // z's expr (y*2) should use the user's y=100, giving z=200
    const inst: Instance = await parseAndEvaluateStatement(
      `{ExprOverride06/E {id 1, x 10, y 100}}`
    );
    assert(inst.lookup('y') === 100, `Expected y=100 (user provided), got y=${inst.lookup('y')}`);
    assert(
      inst.lookup('z') === 200,
      `Expected z=200 (expr y*2 using user's y=100), got z=${inst.lookup('z')}`
    );
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

  test('user override on update with chained expressions propagates to dependents', async () => {
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
    // User override for y is applied inline during expr evaluation,
    // so z's expression (y * 2) uses the user's y=100.
    // Net effect: y=100 (user override), z=200 (expr uses user's y=100)
    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprOverrideUp05/E {id? 1, y 100}}`
    );
    assert(updated.length === 1);
    const yVal = updated[0].lookup('y');
    const zVal = updated[0].lookup('z');
    assert(yVal === 100, `Expected y=100 (user override), got y=${yVal}`);
    assert(zVal === 200, `Expected z=200 (expr y*2 using user's y=100), got z=${zVal}`);
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

// ─── HELPER FUNCTION WITH SIBLING PARAMS ─────────────────────────────────────

describe('Expression attributes with helper functions - sibling params', () => {
  test('sibling attributes as function params', async () => {
    await doInternModule(
      'ExprFnSib',
      `entity Resource {
        id Int @id,
        FirstName String,
        PreferredFirstName String @optional,
        LastName String,
        FullName String @expr(agentlang.calculateFullName(FirstName, LastName, PreferredFirstName))
      }`
    );
    agentlang.calculateFullName = (first: string, last: string, preferred: string | null) => {
      const displayFirst = preferred || first;
      return `${displayFirst} ${last}`;
    };
    const fqn = 'ExprFnSib/Resource';
    const isRes = (r: any) => isInstanceOfType(r, fqn);
    // With preferred first name
    const r1: any = await parseAndEvaluateStatement(
      `{${fqn} {id 1, FirstName "Robert", PreferredFirstName "Bob", LastName "Smith"}}`
    );
    assert(isRes(r1));
    assert(r1.lookup('FullName') === 'Bob Smith');
    // Without preferred first name (optional, falls back to FirstName)
    const r2: any = await parseAndEvaluateStatement(
      `{${fqn} {id 2, FirstName "Alice", LastName "Jones"}}`
    );
    assert(isRes(r2));
    assert(r2.lookup('FullName') === 'Alice Jones');
    // Query and verify persisted values
    const results: Instance[] = await parseAndEvaluateStatement(`{${fqn}? {}}`);
    assert(results.length === 2);
    assert(results.every(isRes));
    const bob = results.find((r: Instance) => r.lookup('id') === 1);
    const alice = results.find((r: Instance) => r.lookup('id') === 2);
    assert(bob?.lookup('FullName') === 'Bob Smith');
    assert(alice?.lookup('FullName') === 'Alice Jones');
  });
});

// ─── HELPER FUNCTION WITH RELATED ENTITY PARAM ──────────────────────────────

describe('Expression attributes with helper functions - related entity param', () => {
  test('related entity attribute as function param', async () => {
    await doInternModule(
      'ExprFnRel',
      `entity Department {
        id Int @id,
        Name String,
        BudgetMultiplier Int
      }
      entity Employee {
        id Int @id,
        dept Path,
        Name String,
        BaseSalary Int,
        AdjustedSalary Int @expr(agentlang.adjustSalary(BaseSalary, dept.BudgetMultiplier))
      }`
    );
    agentlang.adjustSalary = (baseSalary: number, multiplier: number) => {
      return baseSalary * multiplier;
    };
    // Create departments
    const dept1: any = await parseAndEvaluateStatement(
      `{ExprFnRel/Department {id 1, Name "Engineering", BudgetMultiplier 3}}`
    );
    assert(isInstanceOfType(dept1, 'ExprFnRel/Department'));
    const dept1Path = dept1.lookup(PathAttributeName);
    const dept2: any = await parseAndEvaluateStatement(
      `{ExprFnRel/Department {id 2, Name "Sales", BudgetMultiplier 2}}`
    );
    assert(isInstanceOfType(dept2, 'ExprFnRel/Department'));
    const dept2Path = dept2.lookup(PathAttributeName);
    // Create employees referencing departments
    const emp1: any = await parseAndEvaluateStatement(
      `{ExprFnRel/Employee {id 1, dept "${dept1Path}", Name "Alice", BaseSalary 1000}}`
    );
    assert(isInstanceOfType(emp1, 'ExprFnRel/Employee'));
    assert(emp1.lookup('AdjustedSalary') === 3000);
    const emp2: any = await parseAndEvaluateStatement(
      `{ExprFnRel/Employee {id 2, dept "${dept2Path}", Name "Bob", BaseSalary 2000}}`
    );
    assert(isInstanceOfType(emp2, 'ExprFnRel/Employee'));
    assert(emp2.lookup('AdjustedSalary') === 4000);
    // Query and verify
    const results: Instance[] = await parseAndEvaluateStatement(`{ExprFnRel/Employee? {}}`);
    assert(results.length === 2);
    const alice = results.find((r: Instance) => r.lookup('id') === 1);
    const bob = results.find((r: Instance) => r.lookup('id') === 2);
    assert(alice?.lookup('AdjustedSalary') === 3000);
    assert(bob?.lookup('AdjustedSalary') === 4000);
  });
});

// ─── HELPER FUNCTION WITH RELATIONSHIP-CONNECTED ENTITY PARAM ────────────────

describe('Expression attributes with helper functions - relationship param', () => {
  test('related entity attribute accessed through relationship as function param', async () => {
    await doInternModule(
      'ExprFnBtwn',
      `entity Department {
        id Int @id,
        Name String,
        BudgetMultiplier Int
      }
      entity Employee {
        id Int @id,
        Name String,
        BaseSalary Int,
        AdjustedSalary Int @expr(agentlang.adjustSalaryRel(BaseSalary, DeptEmployee.Department.BudgetMultiplier))
      }
      relationship DeptEmployee between(Department, Employee) @one_many`
    );
    agentlang.adjustSalaryRel = (baseSalary: number, multiplier: number) => {
      return baseSalary * multiplier;
    };
    // Create a department
    const dept: any = await parseAndEvaluateStatement(
      `{ExprFnBtwn/Department {id 1, Name "Engineering", BudgetMultiplier 3}}`
    );
    assert(isInstanceOfType(dept, 'ExprFnBtwn/Department'));
    // Create an employee linked to the department through the relationship
    const pat = `{ExprFnBtwn/Department {id? 1},
                  DeptEmployee [{ExprFnBtwn/Employee {id 1, Name "Alice", BaseSalary 1000}}]}`;
    const results: Instance[] = await parseAndEvaluateStatement(pat);
    assert(results.length === 1);
    const deptInst = results[0];
    assert(isInstanceOfType(deptInst, 'ExprFnBtwn/Department'));
    const employees = deptInst.getRelatedInstances('DeptEmployee');
    assert(employees !== undefined);
    assert(employees!.length === 1);
    const alice = employees![0];
    assert(isInstanceOfType(alice, 'ExprFnBtwn/Employee'));
    assert(alice.lookup('BaseSalary') === 1000);
    // The @expr should resolve DeptEmployee.Department.BudgetMultiplier from the related Department
    assert(
      alice.lookup('AdjustedSalary') === 3000,
      `Expected AdjustedSalary=3000 (1000*3), got ${alice.lookup('AdjustedSalary')}`
    );
  });

  test('one-to-one: @expr accessing related entity attribute', async () => {
    await doInternModule(
      'ExprRel11',
      `entity Profile {
        id Int @id,
        Bio String
      }
      entity User {
        id Int @id,
        Name String,
        DisplayInfo String @expr(agentlang.makeDisplay11(Name, UserProfile.Profile.Bio))
      }
      relationship UserProfile between(Profile, User) @one_one`
    );
    agentlang.makeDisplay11 = (name: string, bio: string) => (bio ? `${name}: ${bio}` : name);
    // Create a profile first
    const profile: any = await parseAndEvaluateStatement(
      `{ExprRel11/Profile {id 1, Bio "Hello world"}}`
    );
    assert(isInstanceOfType(profile, 'ExprRel11/Profile'));
    // Create a user linked to the profile via the relationship pattern (fast path).
    // Query the profile (node1), then create the user (node2) through the relationship.
    const pat = `{ExprRel11/Profile {id? 1},
                  UserProfile [{ExprRel11/User {id 1, Name "Alice"}}]}`;
    const results: Instance[] = await parseAndEvaluateStatement(pat);
    assert(results.length === 1);
    const profileInst = results[0];
    assert(isInstanceOfType(profileInst, 'ExprRel11/Profile'));
    const users = profileInst.getRelatedInstances('UserProfile');
    assert(users !== undefined);
    assert(users!.length === 1);
    const alice = users![0];
    assert(isInstanceOfType(alice, 'ExprRel11/User'));
    assert(
      alice.lookup('DisplayInfo') === 'Alice: Hello world',
      `Expected "Alice: Hello world", got "${alice.lookup('DisplayInfo')}"`
    );
  });

  test('update recomputes @expr that references through relationship', async () => {
    await doInternModule(
      'ExprRelUpd',
      `entity Department {
        id Int @id,
        Name String,
        BudgetMultiplier Int
      }
      entity Employee {
        id Int @id,
        Name String,
        BaseSalary Int,
        AdjustedSalary Int @expr(agentlang.adjustSalaryUpd(BaseSalary, DeptEmployee.Department.BudgetMultiplier))
      }
      relationship DeptEmployee between(Department, Employee) @one_many`
    );
    agentlang.adjustSalaryUpd = (baseSalary: number, multiplier: number) => {
      return baseSalary * multiplier;
    };
    // Create department
    await parseAndEvaluateStatement(
      `{ExprRelUpd/Department {id 1, Name "Engineering", BudgetMultiplier 3}}`
    );
    // Create employee via relationship
    const pat = `{ExprRelUpd/Department {id? 1},
                  DeptEmployee [{ExprRelUpd/Employee {id 1, Name "Alice", BaseSalary 1000}}]}`;
    await parseAndEvaluateStatement(pat);
    // Update the employee's BaseSalary
    const updated: Instance[] = await parseAndEvaluateStatement(
      `{ExprRelUpd/Employee {id? 1, BaseSalary 2000}}`
    );
    assert(updated.length === 1);
    assert(
      updated[0].lookup('AdjustedSalary') === 6000,
      `Expected AdjustedSalary=6000 (2000*3), got ${updated[0].lookup('AdjustedSalary')}`
    );
  });
});

// ─── VALIDATION ERROR TESTS FOR @EXPR THROUGH RELATIONSHIPS ──────────────────

describe('Expression attributes - relationship validation errors', () => {
  test('one-to-many from "one" side should fail validation', async () => {
    let errorMsg = '';
    try {
      await doInternModule(
        'ExprRelErr1',
        `entity Department {
          id Int @id,
          Name String,
          EmpCount Int @expr(agentlang.count1(DeptEmployee.Employee.Name))
        }
        entity Employee {
          id Int @id,
          Name String
        }
        relationship DeptEmployee between(Department, Employee) @one_many`
      );
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(
      errorMsg.includes('one-to-many') || errorMsg.includes('multiple entities'),
      `Expected error about one-to-many from "one" side, got: "${errorMsg}"`
    );
  });

  test('many-to-many relationship should fail validation', async () => {
    let errorMsg = '';
    try {
      await doInternModule(
        'ExprRelErr2',
        `entity Student {
          id Int @id,
          Name String,
          CourseName String @expr(agentlang.getName2(Enrollment.Course.Name))
        }
        entity Course {
          id Int @id,
          Name String
        }
        relationship Enrollment between(Student, Course)`
      );
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(
      errorMsg.includes('many-to-many'),
      `Expected error about many-to-many relationship, got: "${errorMsg}"`
    );
  });

  test('invalid entity alias in relationship reference should fail validation', async () => {
    let errorMsg = '';
    try {
      await doInternModule(
        'ExprRelErr3',
        `entity Department {
          id Int @id,
          Name String,
          BudgetMultiplier Int
        }
        entity Employee {
          id Int @id,
          Name String,
          BaseSalary Int,
          AdjustedSalary Int @expr(agentlang.adj3(BaseSalary, DeptEmployee.WrongEntity.BudgetMultiplier))
        }
        relationship DeptEmployee between(Department, Employee) @one_many`
      );
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(
      errorMsg.includes('WrongEntity') && errorMsg.includes('does not match'),
      `Expected error about invalid entity alias "WrongEntity", got: "${errorMsg}"`
    );
  });
});
