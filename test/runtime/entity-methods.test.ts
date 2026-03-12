import { assert, describe, test } from 'vitest';
import { doInternModule } from '../util.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';

describe('entity-method-crud', () => {
  test('create, find, find_all, update, delete', async () => {
    const m = 'emCrud';
    await doInternModule(
      m,
      `entity Employee {
          id Int @id,
          name String,
          salary Decimal
       }`
    );
    const fqn = `${m}/Employee`;

    // create
    const e1: Instance = await parseAndEvaluateStatement(
      `Employee.create({"id": 1, "name": "Alice", "salary": 50000})`
    );
    assert(isInstanceOfType(e1, fqn), 'create should return Employee instance');
    assert(e1.lookup('name') === 'Alice');
    assert(e1.lookup('salary') == 50000);

    await parseAndEvaluateStatement(
      `Employee.create({"id": 2, "name": "Bob", "salary": 70000})`
    );
    await parseAndEvaluateStatement(
      `Employee.create({"id": 3, "name": "Charlie", "salary": 60000})`
    );

    // find — returns single entity
    const found: Instance = await parseAndEvaluateStatement(
      `Employee.find({"id": 2})`
    );
    assert(isInstanceOfType(found, fqn));
    assert(found.lookup('name') === 'Bob');

    // find_all — no filter
    let all: Instance[] = await parseAndEvaluateStatement(
      `Employee.find_all()`
    );
    assert(all.length === 3, `Expected 3, got ${all.length}`);

    // find_all — with comparison filter
    const filtered: Instance[] = await parseAndEvaluateStatement(
      `Employee.find_all({"salary>=": 60000})`
    );
    assert(filtered.length === 2, `Expected 2, got ${filtered.length}`);

    // find_all with options is tested inside workflows (see below)

    // update
    await parseAndEvaluateStatement(
      `Employee.update({"id": 1}, {"salary": 55000})`
    );
    const updated: Instance = await parseAndEvaluateStatement(
      `Employee.find({"id": 1})`
    );
    assert(updated.lookup('salary') == 55000, `Expected 55000, got ${updated.lookup('salary')}`);

    // delete
    await parseAndEvaluateStatement(
      `Employee.delete({"id": 3})`
    );
    all = await parseAndEvaluateStatement(`Employee.find_all()`);
    assert(all.length === 2, `Expected 2 after delete, got ${all.length}`);
  });
});

describe('entity-method-aggregates', () => {
  test('with_max, with_min, top, bottom', async () => {
    const m = 'emAgg';
    await doInternModule(
      m,
      `entity Product {
          id Int @id,
          name String,
          price Decimal
       }`
    );
    const fqn = `${m}/Product`;

    for (let i = 1; i <= 5; i++) {
      await parseAndEvaluateStatement(
        `Product.create({"id": ${i}, "name": "p${i}", "price": ${i * 100}})`
      );
    }

    // with_max — returns single entity with highest value
    const expensive: Instance = await parseAndEvaluateStatement(
      `Product.with_max("price")`
    );
    assert(isInstanceOfType(expensive, fqn));
    assert(expensive.lookup('id') == 5);

    // with_min — returns single entity with lowest value
    const cheap: Instance = await parseAndEvaluateStatement(
      `Product.with_min("price")`
    );
    assert(isInstanceOfType(cheap, fqn));
    assert(cheap.lookup('id') == 1);

    // with_max with filter
    const expFiltered: Instance = await parseAndEvaluateStatement(
      `Product.with_max("price", {"price<=": 300})`
    );
    assert(expFiltered.lookup('id') == 3);

    // top N
    const top3: Instance[] = await parseAndEvaluateStatement(
      `Product.top(3, "price")`
    );
    assert(top3.length === 3);
    assert(top3[0].lookup('id') == 5);
    assert(top3[1].lookup('id') == 4);
    assert(top3[2].lookup('id') == 3);

    // bottom N
    const bottom2: Instance[] = await parseAndEvaluateStatement(
      `Product.bottom(2, "price")`
    );
    assert(bottom2.length === 2);
    assert(bottom2[0].lookup('id') == 1);
    assert(bottom2[1].lookup('id') == 2);

    // top with filter
    const topFiltered: Instance[] = await parseAndEvaluateStatement(
      `Product.top(2, "price", {"price<=": 400})`
    );
    assert(topFiltered.length === 2);
    assert(topFiltered[0].lookup('id') == 4);
    assert(topFiltered[1].lookup('id') == 3);
  });
});

describe('entity-method-upsert', () => {
  test('upsert creates or updates', async () => {
    const m = 'emUps';
    await doInternModule(
      m,
      `entity Config {
          key String @id,
          value String
       }`
    );
    const fqn = `${m}/Config`;

    // Create via upsert
    const c1: Instance = await parseAndEvaluateStatement(
      `Config.upsert({"key": "theme", "value": "dark"})`
    );
    assert(isInstanceOfType(c1, fqn));
    assert(c1.lookup('value') === 'dark');

    // Update via upsert
    await parseAndEvaluateStatement(
      `Config.upsert({"key": "theme", "value": "light"})`
    );
    const c2: Instance = await parseAndEvaluateStatement(
      `Config.find({"key": "theme"})`
    );
    assert(c2.lookup('value') === 'light');
  });
});

describe('entity-method-in-workflow', () => {
  test('entity methods work inside workflows with @as', async () => {
    const m = 'emWf';
    await doInternModule(
      m,
      `entity Item {
          id Int @id,
          name String,
          price Decimal
       }

       workflow FindExpensive {
          Item.with_max("price") @as item;
          item
       }

       workflow TopItems {
          Item.top(TopItems.n, "price") @as items;
          items
       }
       `
    );
    const fqn = `${m}/Item`;

    for (let i = 1; i <= 4; i++) {
      await parseAndEvaluateStatement(
        `{${fqn} {id ${i}, name "item${i}", price ${i * 25}}}`
      );
    }

    // Workflow using with_max
    const result: Instance = await parseAndEvaluateStatement(
      `{${m}/FindExpensive {}}`
    );
    assert(isInstanceOfType(result, fqn));
    assert(result.lookup('id') == 4);

    // Workflow using top with dynamic parameter
    const topItems: Instance[] = await parseAndEvaluateStatement(
      `{${m}/TopItems {n 2}}`
    );
    assert(topItems.length === 2);
    assert(topItems[0].lookup('id') == 4);
    assert(topItems[1].lookup('id') == 3);
  });

  test('CRUD methods work inside workflows', async () => {
    const m = 'emWf2';
    await doInternModule(
      m,
      `entity Task {
          id Int @id,
          title String,
          done Boolean @default(false)
       }

       workflow CreateAndFind {
          Task.create({"id": 1, "title": "first"});
          Task.create({"id": 2, "title": "second"});
          Task.find({"id": 1})
       }

       workflow UpdateTask {
          Task.update({"id": UpdateTask.taskId}, {"title": UpdateTask.newTitle})
       }

       workflow DeleteTask {
          Task.delete({"id": DeleteTask.taskId})
       }

       workflow ListTasks {
          Task.find_all()
       }

       workflow TopTasks {
          Task.find_all({"orderBy": "id", "desc": true, "limit": TopTasks.n})
       }
       `
    );
    const fqn = `${m}/Task`;

    // CreateAndFind workflow
    const found: Instance = await parseAndEvaluateStatement(
      `{${m}/CreateAndFind {}}`
    );
    assert(isInstanceOfType(found, fqn));
    assert(found.lookup('title') === 'first');

    // Verify both were created
    let all: Instance[] = await parseAndEvaluateStatement(`{${m}/ListTasks {}}`);
    assert(all.length === 2, `Expected 2, got ${all.length}`);

    // Update
    await parseAndEvaluateStatement(
      `{${m}/UpdateTask {taskId 1, newTitle "updated"}}`
    );
    const updatedArr: Instance[] = await parseAndEvaluateStatement(
      `{${fqn} {id? 1}}`
    );
    assert(updatedArr[0].lookup('title') === 'updated');

    // Delete
    await parseAndEvaluateStatement(
      `{${m}/DeleteTask {taskId 2}}`
    );
    all = await parseAndEvaluateStatement(`{${m}/ListTasks {}}`);
    assert(all.length === 1, `Expected 1 after delete, got ${all.length}`);

    // Re-create task for TopTasks test
    await parseAndEvaluateStatement(
      `Task.create({"id": 3, "title": "third"})`
    );
    // TopTasks workflow: find_all with orderBy desc, limit
    const topTasks: Instance[] = await parseAndEvaluateStatement(
      `{${m}/TopTasks {n 1}}`
    );
    assert(topTasks.length === 1, `Expected 1, got ${topTasks.length}`);
    assert(topTasks[0].lookup('id') == 3, `Expected id 3, got ${topTasks[0].lookup('id')}`);
  });
});

describe('entity-method-with-ref', () => {
  test('create and find entities with @ref foreign keys', async () => {
    const m = 'emRef';
    await doInternModule(
      m,
      `entity Dept {
          id Int @id,
          name String
       }

       entity Staff {
          id Int @id,
          name String,
          deptId Int @ref(${m}/Dept.id)
       }`
    );
    const deptFqn = `${m}/Dept`;
    const staffFqn = `${m}/Staff`;

    // Create departments using FQN syntax
    const d1: Instance = await parseAndEvaluateStatement(
      `${m}/Dept.create({"id": 1, "name": "Engineering"})`
    );
    assert(isInstanceOfType(d1, deptFqn));

    await parseAndEvaluateStatement(
      `${m}/Dept.create({"id": 2, "name": "Sales"})`
    );

    // Create staff with valid @ref
    const e1: Instance = await parseAndEvaluateStatement(
      `${m}/Staff.create({"id": 100, "name": "Alice", "deptId": 1})`
    );
    assert(isInstanceOfType(e1, staffFqn));
    assert(e1.lookup('name') === 'Alice');
    assert(e1.lookup('deptId') == 1);

    await parseAndEvaluateStatement(
      `${m}/Staff.create({"id": 101, "name": "Bob", "deptId": 1})`
    );
    await parseAndEvaluateStatement(
      `${m}/Staff.create({"id": 102, "name": "Charlie", "deptId": 2})`
    );

    // find staff by department
    const engStaff: Instance[] = await parseAndEvaluateStatement(
      `${m}/Staff.find_all({"deptId": 1})`
    );
    assert(engStaff.length === 2, `Expected 2 engineering staff, got ${engStaff.length}`);

    // find_all departments
    const depts: Instance[] = await parseAndEvaluateStatement(
      `${m}/Dept.find_all()`
    );
    assert(depts.length === 2, `Expected 2 departments, got ${depts.length}`);

    // update staff's department ref
    await parseAndEvaluateStatement(
      `${m}/Staff.update({"id": 100}, {"deptId": 2})`
    );
    const updated: Instance = await parseAndEvaluateStatement(
      `${m}/Staff.find({"id": 100})`
    );
    assert(updated.lookup('deptId') == 2, `Expected deptId 2, got ${updated.lookup('deptId')}`);

    // delete a staff member
    await parseAndEvaluateStatement(
      `${m}/Staff.delete({"id": 102})`
    );
    const afterDel: Instance[] = await parseAndEvaluateStatement(
      `${m}/Staff.find_all()`
    );
    assert(afterDel.length === 2, `Expected 2 staff after delete, got ${afterDel.length}`);
  });
});

describe('entity-method-with-between-relationship', () => {
  test('CRUD with between relationship using workflows', async () => {
    const m = 'emBetw';
    await doInternModule(
      m,
      `entity Pupil {
          id Int @id,
          name String
       }

       entity Course {
          id Int @id,
          title String
       }

       relationship Enrollment between(Pupil @as pupil, Course @as course)

       workflow Enroll {
          ${m}/Pupil.find({"id": Enroll.pupilId}) @as p;
          ${m}/Course.find({"id": Enroll.courseId}) @as c;
          {Enrollment {pupil p, course c}}
       }

       workflow PupilCourses {
          {Pupil {id? PupilCourses.pupilId},
           Enrollment {Course? {}}}
       }`
    );

    // Create pupils and courses using entity methods with FQN
    await parseAndEvaluateStatement(
      `${m}/Pupil.create({"id": 1, "name": "Alice"})`
    );
    await parseAndEvaluateStatement(
      `${m}/Pupil.create({"id": 2, "name": "Bob"})`
    );
    await parseAndEvaluateStatement(
      `${m}/Course.create({"id": 10, "title": "Math"})`
    );
    await parseAndEvaluateStatement(
      `${m}/Course.create({"id": 20, "title": "Physics"})`
    );

    // Enroll pupils via workflow that uses entity method find + relationship create
    await parseAndEvaluateStatement(
      `{${m}/Enroll {pupilId 1, courseId 10}}`
    );
    await parseAndEvaluateStatement(
      `{${m}/Enroll {pupilId 1, courseId 20}}`
    );
    await parseAndEvaluateStatement(
      `{${m}/Enroll {pupilId 2, courseId 10}}`
    );

    // Query pupil's courses via relationship
    const aliceCourses: Instance[] = await parseAndEvaluateStatement(
      `{${m}/PupilCourses {pupilId 1}}`
    );
    assert(aliceCourses.length === 1, `Expected 1 pupil result, got ${aliceCourses.length}`);
    const courses = aliceCourses[0].getRelatedInstances('Enrollment');
    assert(courses.length === 2, `Expected 2 courses for Alice, got ${courses.length}`);

    // Verify entity methods still work for querying the entities directly
    const allPupils: Instance[] = await parseAndEvaluateStatement(
      `${m}/Pupil.find_all()`
    );
    assert(allPupils.length === 2, `Expected 2 pupils, got ${allPupils.length}`);

    const math: Instance = await parseAndEvaluateStatement(
      `${m}/Course.find({"id": 10})`
    );
    assert(math.lookup('title') === 'Math');
  });
});

describe('entity-method-with-contains-relationship', () => {
  test('CRUD with contains relationship', async () => {
    const m = 'emCont';
    await doInternModule(
      m,
      `entity SalesOrder {
          id Int @id,
          customer String
       }

       entity LineItem {
          id Int @id,
          product String,
          qty Int
       }

       relationship OrderItems contains(SalesOrder, LineItem)`
    );
    const orderFqn = `${m}/SalesOrder`;

    // Create order with line items using old CrudMap syntax (contains create)
    await parseAndEvaluateStatement(
      `{${m}/SalesOrder {id 1, customer "Alice"},
        OrderItems [{${m}/LineItem {id 10, product "Widget", qty 2}},
                    {${m}/LineItem {id 11, product "Gadget", qty 1}}]}`
    );

    // Use entity methods to query the parent entity (FQN)
    const order: Instance = await parseAndEvaluateStatement(
      `${m}/SalesOrder.find({"id": 1})`
    );
    assert(isInstanceOfType(order, orderFqn));
    assert(order.lookup('customer') === 'Alice');

    // Use entity methods to query the child entities
    const items: Instance[] = await parseAndEvaluateStatement(
      `${m}/LineItem.find_all()`
    );
    assert(items.length === 2, `Expected 2 line items, got ${items.length}`);

    // Query order with its line items via old relationship syntax
    const orderWithItems: Instance[] = await parseAndEvaluateStatement(
      `{${m}/SalesOrder {id? 1}, OrderItems {${m}/LineItem? {}}}`
    );
    assert(orderWithItems.length === 1);
    const lineItems = orderWithItems[0].getRelatedInstances('OrderItems');
    assert(lineItems.length === 2, `Expected 2 related items, got ${lineItems.length}`);

    // Use entity method aggregates on child entities
    const topItem: Instance = await parseAndEvaluateStatement(
      `${m}/LineItem.with_max("qty")`
    );
    assert(topItem.lookup('product') === 'Widget');
    assert(topItem.lookup('qty') == 2);

    // Update a line item via entity method
    await parseAndEvaluateStatement(
      `${m}/LineItem.update({"id": 10}, {"qty": 5})`
    );
    const updated: Instance = await parseAndEvaluateStatement(
      `${m}/LineItem.find({"id": 10})`
    );
    assert(updated.lookup('qty') == 5, `Expected qty 5, got ${updated.lookup('qty')}`);

    // Delete a line item via entity method
    await parseAndEvaluateStatement(
      `${m}/LineItem.delete({"id": 11})`
    );
    const remaining: Instance[] = await parseAndEvaluateStatement(
      `${m}/LineItem.find_all()`
    );
    assert(remaining.length === 1, `Expected 1 item after delete, got ${remaining.length}`);
  });
});

describe('tier2-cross-entity-aggregates', () => {
  test('with_max_count, with_min_count, top_by_count, bottom_by_count', async () => {
    const m = 'emT2cnt';
    await doInternModule(
      m,
      `entity SalesRep {
          email Email @id,
          name String
       }

       entity Deal {
          id Int @id,
          assignedTo @ref(${m}/SalesRep.email),
          stage String,
          value Decimal
       }`
    );

    // Create sales reps
    await parseAndEvaluateStatement(
      `${m}/SalesRep.create({"email": "alice@acme.com", "name": "Alice"})`
    );
    await parseAndEvaluateStatement(
      `${m}/SalesRep.create({"email": "bob@acme.com", "name": "Bob"})`
    );
    await parseAndEvaluateStatement(
      `${m}/SalesRep.create({"email": "carol@acme.com", "name": "Carol"})`
    );

    // Create deals: Alice=3 deals, Bob=1 deal, Carol=2 deals
    await parseAndEvaluateStatement(
      `${m}/Deal.create({"id": 1, "assignedTo": "alice@acme.com", "stage": "closed-won", "value": 100})`
    );
    await parseAndEvaluateStatement(
      `${m}/Deal.create({"id": 2, "assignedTo": "alice@acme.com", "stage": "closed-won", "value": 200})`
    );
    await parseAndEvaluateStatement(
      `${m}/Deal.create({"id": 3, "assignedTo": "alice@acme.com", "stage": "prospecting", "value": 50})`
    );
    await parseAndEvaluateStatement(
      `${m}/Deal.create({"id": 4, "assignedTo": "bob@acme.com", "stage": "closed-won", "value": 500})`
    );
    await parseAndEvaluateStatement(
      `${m}/Deal.create({"id": 5, "assignedTo": "carol@acme.com", "stage": "closed-won", "value": 300})`
    );
    await parseAndEvaluateStatement(
      `${m}/Deal.create({"id": 6, "assignedTo": "carol@acme.com", "stage": "prospecting", "value": 150})`
    );

    // with_max_count: rep with the most deals overall
    const busiest: Instance = await parseAndEvaluateStatement(
      `${m}/SalesRep.with_max_count("Deal", "assignedTo")`
    );
    assert(busiest.lookup('name') === 'Alice', `Expected Alice, got ${busiest.lookup('name')}`);

    // with_min_count: rep with the fewest deals
    const leastBusy: Instance = await parseAndEvaluateStatement(
      `${m}/SalesRep.with_min_count("Deal", "assignedTo")`
    );
    assert(leastBusy.lookup('name') === 'Bob', `Expected Bob, got ${leastBusy.lookup('name')}`);

    // with_max_count with filter: rep with most closed-won deals
    // Alice=2, Bob=1, Carol=1
    const topCloser: Instance = await parseAndEvaluateStatement(
      `${m}/SalesRep.with_max_count("Deal", "assignedTo", {"stage": "closed-won"})`
    );
    assert(topCloser.lookup('name') === 'Alice', `Expected Alice, got ${topCloser.lookup('name')}`);

    // top_by_count: top 2 reps by deal count
    const top2: Instance[] = await parseAndEvaluateStatement(
      `${m}/SalesRep.top_by_count(2, "Deal", "assignedTo")`
    );
    assert(top2.length === 2, `Expected 2, got ${top2.length}`);
    assert(top2[0].lookup('name') === 'Alice');
    assert(top2[1].lookup('name') === 'Carol');

    // bottom_by_count: bottom 1 by deal count
    const bottom1: Instance[] = await parseAndEvaluateStatement(
      `${m}/SalesRep.bottom_by_count(1, "Deal", "assignedTo")`
    );
    assert(bottom1.length === 1);
    assert(bottom1[0].lookup('name') === 'Bob');
  });

  test('with_max_sum, with_min_sum, top_by_sum, with_max_avg', async () => {
    const m = 'emT2sum';
    await doInternModule(
      m,
      `entity Rep {
          id Int @id,
          name String
       }

       entity Sale {
          id Int @id,
          repId Int @ref(${m}/Rep.id),
          amount Decimal
       }`
    );

    // Create reps
    await parseAndEvaluateStatement(`${m}/Rep.create({"id": 1, "name": "Alice"})`);
    await parseAndEvaluateStatement(`${m}/Rep.create({"id": 2, "name": "Bob"})`);
    await parseAndEvaluateStatement(`${m}/Rep.create({"id": 3, "name": "Carol"})`);

    // Alice: sales 100, 200 (sum=300, avg=150)
    // Bob: sales 500 (sum=500, avg=500)
    // Carol: sales 50, 100, 150 (sum=300, avg=100)
    await parseAndEvaluateStatement(`${m}/Sale.create({"id": 1, "repId": 1, "amount": 100})`);
    await parseAndEvaluateStatement(`${m}/Sale.create({"id": 2, "repId": 1, "amount": 200})`);
    await parseAndEvaluateStatement(`${m}/Sale.create({"id": 3, "repId": 2, "amount": 500})`);
    await parseAndEvaluateStatement(`${m}/Sale.create({"id": 4, "repId": 3, "amount": 50})`);
    await parseAndEvaluateStatement(`${m}/Sale.create({"id": 5, "repId": 3, "amount": 100})`);
    await parseAndEvaluateStatement(`${m}/Sale.create({"id": 6, "repId": 3, "amount": 150})`);

    // with_max_sum: rep with highest total revenue
    const topRev: Instance = await parseAndEvaluateStatement(
      `${m}/Rep.with_max_sum("Sale.amount", "repId")`
    );
    assert(topRev.lookup('name') === 'Bob', `Expected Bob, got ${topRev.lookup('name')}`);

    // with_min_sum: rep with lowest total revenue
    const lowRev: Instance = await parseAndEvaluateStatement(
      `${m}/Rep.with_min_sum("Sale.amount", "repId")`
    );
    // Alice and Carol both have sum=300; either is valid
    assert(
      lowRev.lookup('name') === 'Alice' || lowRev.lookup('name') === 'Carol',
      `Expected Alice or Carol, got ${lowRev.lookup('name')}`
    );

    // top_by_sum: top 2 reps by revenue
    const top2Rev: Instance[] = await parseAndEvaluateStatement(
      `${m}/Rep.top_by_sum(2, "Sale.amount", "repId")`
    );
    assert(top2Rev.length === 2, `Expected 2, got ${top2Rev.length}`);
    assert(top2Rev[0].lookup('name') === 'Bob');

    // with_max_avg: rep with highest average sale
    const topAvg: Instance = await parseAndEvaluateStatement(
      `${m}/Rep.with_max_avg("Sale.amount", "repId")`
    );
    assert(topAvg.lookup('name') === 'Bob', `Expected Bob (avg 500), got ${topAvg.lookup('name')}`);
  });
});

describe('relationship-link-unlink', () => {
  test('link and unlink between relationship', async () => {
    const m = 'emLink';
    await doInternModule(
      m,
      `entity Author {
          id Int @id,
          name String
       }

       entity Book {
          id Int @id,
          title String
       }

       relationship AuthorBook between(Author @as author, Book @as book)

       workflow AuthorBooks {
          {Author {id? AuthorBooks.authorId},
           AuthorBook {Book? {}}}
       }`
    );

    // Create entities
    const a1: Instance = await parseAndEvaluateStatement(
      `${m}/Author.create({"id": 1, "name": "Alice"})`
    );
    const a2: Instance = await parseAndEvaluateStatement(
      `${m}/Author.create({"id": 2, "name": "Bob"})`
    );
    const b1: Instance = await parseAndEvaluateStatement(
      `${m}/Book.create({"id": 10, "title": "Intro to CS"})`
    );
    const b2: Instance = await parseAndEvaluateStatement(
      `${m}/Book.create({"id": 20, "title": "Advanced Math"})`
    );

    // Link author to books using relationship method
    await parseAndEvaluateStatement(
      `${m}/AuthorBook.link(1, 10)`
    );
    await parseAndEvaluateStatement(
      `${m}/AuthorBook.link(1, 20)`
    );
    await parseAndEvaluateStatement(
      `${m}/AuthorBook.link(2, 10)`
    );

    // Query Alice's books
    const aliceBooks: Instance[] = await parseAndEvaluateStatement(
      `{${m}/AuthorBooks {authorId 1}}`
    );
    assert(aliceBooks.length === 1);
    const books = aliceBooks[0].getRelatedInstances('AuthorBook');
    assert(books.length === 2, `Expected 2 books for Alice, got ${books.length}`);

    // Unlink Alice from Advanced Math
    await parseAndEvaluateStatement(
      `${m}/AuthorBook.unlink(1, 20)`
    );

    // Verify only 1 book remains for Alice
    const aliceBooksAfter: Instance[] = await parseAndEvaluateStatement(
      `{${m}/AuthorBooks {authorId 1}}`
    );
    const booksAfter = aliceBooksAfter[0].getRelatedInstances('AuthorBook');
    assert(booksAfter.length === 1, `Expected 1 book after unlink, got ${booksAfter.length}`);
    assert(booksAfter[0].lookup('title') === 'Intro to CS');

    // Bob still has his book
    const bobBooks: Instance[] = await parseAndEvaluateStatement(
      `{${m}/AuthorBooks {authorId 2}}`
    );
    const bobBkList = bobBooks[0].getRelatedInstances('AuthorBook');
    assert(bobBkList.length === 1);
    assert(bobBkList[0].lookup('title') === 'Intro to CS');
  });
});
