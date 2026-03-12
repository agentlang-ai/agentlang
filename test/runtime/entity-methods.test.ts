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
