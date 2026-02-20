import { assert, describe, test } from 'vitest';
import { testModule, is, runTests, runPatternTests } from '../../src/test-harness.js';
import { doInternModule } from '../util.js';

const bankingModuleBody = `entity BankAccount {
  accountNo Int @id,
  balance Decimal,
  interestRate Decimal
}
@public event makeDeposit {
  accountNo Int,
  amount Decimal
}
workflow makeDeposit {
  {
    BankAccount {accountNo? makeDeposit.accountNo,
                 balance balance + (balance * interestRate) + makeDeposit.amount}
  }
}`;
const bankingModule = (name: string) => `module ${name}\n${bankingModuleBody}`;

describe('Test harness - Banking module', () => {
  test('deposit increases balance with interest', async () => {
    const m = await testModule('banking.core1', bankingModuleBody, doInternModule);

    const account = await m.create_BankAccount({
      accountNo: 101992,
      balance: 100,
      interestRate: 0.5,
    });
    is(account.accountNo == 101992);
    is(account.balance == 100);
    is(account.interestRate == 0.5);

    await m.makeDeposit({ accountNo: 101992, amount: 50 });

    const accounts = await m.get_BankAccount({ accountNo: 101992 });
    is(accounts[0].accountNo == 101992);
    is(accounts[0].balance == 200);
  });
});

describe('Test harness - Relationships', () => {
  test('create and query with between relationship', async () => {
    const m = await testModule(
      'Blogger2',
      `entity User {
        email Email @id,
        name String
      }
      entity Post {
        id Int @id,
        title String
      }
      relationship UserPost between(User, Post) @one_many`,
      doInternModule
    );

    await m.create_User({ email: 'j@b.com', name: 'Joe' });
    await m.create_User({ email: 't@b.com', name: 'Tom' });

    // Create posts related to user via relationship
    let results = await m.get_User(
      { email: 'j@b.com' },
      {
        UserPost: [
          { entity: 'Post', attrs: { id: 1, title: 'Post One' } },
          { entity: 'Post', attrs: { id: 2, title: 'Post Two' } },
        ],
      }
    );
    is(results.length == 1);
    is(results[0].email == 'j@b.com');
    const posts = results[0].UserPost;
    is(posts.length == 2);

    // Query user with all related posts
    results = await m.get_User(
      { email: 'j@b.com' },
      {
        UserPost: { entity: 'Post', query: true, attrs: {} },
      }
    );
    is(results.length == 1);
    is(results[0].UserPost.length == 2);
  });

  test('nested contains relationships', async () => {
    const m = await testModule(
      'NestedRel2',
      `entity A {
        id Int @id,
        x Int
      }
      entity B {
        id Int @id,
        y Int
      }
      entity C {
        id Int @id,
        z Int
      }
      relationship AB contains(A, B)
      relationship BC contains(B, C)`,
      doInternModule
    );

    await m.create_A({ id: 1, x: 10 });

    // Create B related to A
    await m.get_A(
      { id: 1 },
      {
        'NestedRel2/AB': { entity: 'B', attrs: { id: 10, y: 100 } },
      }
    );

    // Create C nested under A -> B
    await m.get_A(
      { id: 1 },
      {
        'NestedRel2/AB': {
          entity: 'B',
          query: true,
          attrs: { id: 10 },
          rels: {
            'NestedRel2/BC': { entity: 'C', attrs: { id: 100, z: 1000 } },
          },
        },
      }
    );

    // Query full tree
    const results = await m.get_A(
      { id: 1 },
      {
        'NestedRel2/AB': {
          entity: 'B',
          query: true,
          attrs: {},
          rels: {
            'NestedRel2/BC': { entity: 'C', query: true, attrs: {} },
          },
        },
      }
    );
    is(results.length == 1);
    is(results[0].x == 10);
    const bs = results[0]['NestedRel2/AB'];
    is(bs.length == 1);
    is(bs[0].y == 100);
    const cs = bs[0]['NestedRel2/BC'];
    is(cs.length == 1);
    is(cs[0].z == 1000);
  });
});

describe('runTests - string-based test runner', () => {
  test('passing tests', async () => {
    const result = await runTests(
      bankingModule('banking.core2'),
      `
      let account = await create_BankAccount({accountNo: 101992, balance: 100, interestRate: 0.5});
      is(account.accountNo == 101992);
      is(account.balance == 100);
      is(account.interestRate == 0.5);

      await makeDeposit({accountNo: 101992, amount: 50});

      let accounts = await get_BankAccount({accountNo: 101992});
      is(accounts[0].accountNo == 101992);
      is(accounts[0].balance == 200);
      `,
      doInternModule
    );

    assert(result.passed, 'Test should pass');
    assert(result.total == 5, `Expected 5 assertions, got ${result.total}`);
    assert(result.failures == 0);
    assert(result.error === undefined);
    assert(result.duration > 0);
  });

  test('failing assertion', async () => {
    const result = await runTests(
      `module failtest
      entity E {
        id Int @id,
        x Int
      }`,
      `
      await create_E({id: 1, x: 10});
      let es = await get_E({id: 1});
      is(es[0].x == 10);
      is(es[0].x == 999, "x should be 999");
      is(es[0].x == 10);
      `,
      doInternModule
    );

    assert(!result.passed, 'Test should fail');
    assert(result.total == 2, `Expected 2 assertions (1 pass + 1 fail), got ${result.total}`);
    assert(result.failures == 1);
    assert(result.results[0].passed);
    assert(!result.results[1].passed);
    assert(result.results[1].message == 'x should be 999');
    assert(result.error === undefined);
  });

  test('pattern evaluation error', async () => {
    const result = await runTests(
      `module errtest
      entity E {
        id Int @id,
        x Int
      }`,
      `
      await create_E({id: 1, x: 10});
      is(true);
      await create_E({id: 1, x: 20});
      `,
      doInternModule
    );

    assert(!result.passed, 'Test should fail on duplicate id');
    assert(result.total == 1, 'Only 1 assertion before the error');
    assert(result.results[0].passed);
    assert(result.error !== undefined);
    assert(result.error!.pattern !== undefined);
  });

  test('missing module declaration', async () => {
    const result = await runTests(`entity E { id Int @id }`, `is(true);`, doInternModule);

    assert(!result.passed);
    assert(result.error?.message.includes('missing "module <name>"'));
  });
});

describe('runPatternTests - agentlang pattern array', () => {
  test('banking CRUD with patterns', async () => {
    const mn = 'banking.core3';
    const result = await runPatternTests(
      bankingModule(mn),
      [
        `{${mn}/BankAccount {accountNo 101992, balance 100, interestRate 0.5}}`,
        'is(result.accountNo == 101992)',
        'is(result.balance == 100)',
        'is(result.interestRate == 0.5)',
        `{${mn}/makeDeposit {accountNo 101992, amount 50}}`,
        `{${mn}/BankAccount {accountNo? 101992}}`,
        'is(result.accountNo == 101992)',
        'is(result.balance == 200)',
      ],
      doInternModule
    );

    assert(result.passed, `Test should pass: ${result.error?.message}`);
    assert(result.total == 5, `Expected 5 assertions, got ${result.total}`);
    assert(result.failures == 0);
  });

  test('delete pattern', async () => {
    const result = await runPatternTests(
      `module deltest
      entity Item {
        id Int @id,
        name String
      }`,
      [
        '{deltest/Item {id 1, name "apple"}}',
        '{deltest/Item {id 2, name "banana"}}',
        'is(result.name == "banana")',
        'delete {deltest/Item {id? 1}}',
        '{deltest/Item {id? 2}}',
        'is(result.name == "banana")',
      ],
      doInternModule
    );

    assert(result.passed, `Test should pass: ${result.error?.message}`);
  });

  test('assertion failure reports correctly', async () => {
    const mn = 'banking.core4';
    const result = await runPatternTests(
      bankingModule(mn),
      [
        `{${mn}/BankAccount {accountNo 1, balance 100, interestRate 0.5}}`,
        'is(result.balance == 100)',
        'is(result.balance == 999, "balance should not be 999")',
      ],
      doInternModule
    );

    assert(!result.passed);
    assert(result.total == 2);
    assert(result.results[0].passed);
    assert(!result.results[1].passed);
    assert(result.results[1].message == 'balance should not be 999');
  });
});
