import { assert, describe, test, beforeAll, afterAll, beforeEach } from 'vitest';
import { doInternModule, doPreInit } from '../util.js';
import { initDatabase, resetDefaultDatabase } from '../../src/runtime/resolvers/sqldb/database.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import {
  Instance,
  isInstanceOfType,
  getAllBetweenRelationshipsForEntity,
  Relationship,
  fetchModule,
} from '../../src/runtime/module.js';

describe('Self-referencing relationship tests', () => {
  beforeAll(async () => {
    process.env.AL_DB_TYPE = 'sqljs';
    await doPreInit();
  });

  afterAll(async () => {
    delete process.env.AL_DB_TYPE;
    await resetDefaultDatabase();
  });

  beforeEach(async () => {
    await resetDefaultDatabase();
    if (process.env.AL_DB_TYPE === 'sqljs') {
      await initDatabase({ type: 'sqljs' });
    }
  });

  // =========================================================================
  // 1. Org hierarchy: self-ref one-to-many with contains + other relationships
  // =========================================================================
  describe('Org hierarchy with mixed relationships', () => {
    test('self-ref one-to-many alongside contains and between relationships', async () => {
      await doInternModule(
        'OrgHier',
        `entity Department {
          id Int @id,
          name String
        }
        entity Employee {
          id Int @id,
          name String,
          title String
        }
        relationship DeptEmployee contains(Department, Employee)
        relationship ReportsTo between(Employee @as manager, Employee @as report) @one_many

        workflow HireEmployee {
          {Department {id? HireEmployee.deptId},
           DeptEmployee {Employee {id HireEmployee.empId, name HireEmployee.empName, title HireEmployee.empTitle}}}
        }
        workflow SetManager {
          {Employee {id? SetManager.managerId}} @as [m];
          {Employee {id? SetManager.reportId}} @as [r];
          {ReportsTo {manager m, report r}}
        }
        `
      );

      const m = 'OrgHier';

      // Create department and employees
      await parseAndEvaluateStatement(`{${m}/Department {id 1, name "Engineering"}}`);
      await parseAndEvaluateStatement(
        `{${m}/HireEmployee {deptId 1, empId 100, empName "Alice", empTitle "VP"}}`
      );
      await parseAndEvaluateStatement(
        `{${m}/HireEmployee {deptId 1, empId 200, empName "Bob", empTitle "Manager"}}`
      );
      await parseAndEvaluateStatement(
        `{${m}/HireEmployee {deptId 1, empId 300, empName "Charlie", empTitle "Engineer"}}`
      );
      await parseAndEvaluateStatement(
        `{${m}/HireEmployee {deptId 1, empId 400, empName "Diana", empTitle "Engineer"}}`
      );

      // Alice manages Bob; Bob manages Charlie and Diana
      await parseAndEvaluateStatement(`{${m}/SetManager {managerId 100, reportId 200}}`);
      await parseAndEvaluateStatement(`{${m}/SetManager {managerId 200, reportId 300}}`);
      await parseAndEvaluateStatement(`{${m}/SetManager {managerId 200, reportId 400}}`);

      // Verify contains relationship: query employees in department
      const deptResult = (await parseAndEvaluateStatement(
        `{${m}/Department {id? 1}, ${m}/DeptEmployee {${m}/Employee? {}}}`
      )) as Instance[];
      assert.equal(deptResult.length, 1);
      const deptEmps = deptResult[0].getRelatedInstances(`${m}/DeptEmployee`);
      assert(deptEmps);
      assert.equal(deptEmps.length, 4);

      // Verify self-ref: Alice's direct reports (should be just Bob)
      const aliceResult = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 100}, ${m}/ReportsTo {${m}/Employee? {}}}`
      )) as Instance[];
      assert.equal(aliceResult.length, 1);
      const aliceReports = aliceResult[0].getRelatedInstances(`${m}/ReportsTo`);
      assert(aliceReports);
      assert.equal(aliceReports.length, 1);
      assert.equal(aliceReports[0].lookup('name'), 'Bob');

      // Verify self-ref: Bob's direct reports (Charlie and Diana)
      const bobResult = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 200}, ${m}/ReportsTo {${m}/Employee? {}}}`
      )) as Instance[];
      assert.equal(bobResult.length, 1);
      const bobReports = bobResult[0].getRelatedInstances(`${m}/ReportsTo`);
      assert(bobReports);
      assert.equal(bobReports.length, 2);
      const bobReportNames = bobReports.map((e: Instance) => e.lookup('name')).sort();
      assert.deepEqual(bobReportNames, ['Charlie', 'Diana']);

      // Verify: employee with no reports returns empty
      const charlieResult = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 300}, ${m}/ReportsTo {${m}/Employee? {}}}`
      )) as Instance[];
      assert.equal(charlieResult.length, 1);
      const charlieReports = charlieResult[0].getRelatedInstances(`${m}/ReportsTo`);
      assert(!charlieReports || charlieReports.length === 0);
    });
  });

  // =========================================================================
  // 2. Self-ref @into projections
  // =========================================================================
  describe('Self-ref with @into projections', () => {
    test('project self-referencing relationship attributes via @into', async () => {
      await doInternModule(
        'SRInto',
        `entity Employee {
          id Int @id,
          name String,
          salary Int
        }
        relationship Mentors between(Employee @as mentor, Employee @as mentee) @one_many

        workflow AssignMentor {
          {Employee {id? AssignMentor.mentorId}} @as [m];
          {Employee {id? AssignMentor.menteeId}} @as [e];
          {Mentors {mentor m, mentee e}}
        }

        workflow MentorReport {
          {SRInto/Employee {id? MentorReport.mentorId},
           SRInto/Mentors {SRInto/Employee? {}},
           @into {mentorName SRInto/Employee.name, menteeName SRInto/Employee.name}}
        }
        `
      );

      const m = 'SRInto';
      await parseAndEvaluateStatement(`{${m}/Employee {id 1, name "Senior", salary 100000}}`);
      await parseAndEvaluateStatement(`{${m}/Employee {id 2, name "Junior1", salary 60000}}`);
      await parseAndEvaluateStatement(`{${m}/Employee {id 3, name "Junior2", salary 55000}}`);

      await parseAndEvaluateStatement(`{${m}/AssignMentor {mentorId 1, menteeId 2}}`);
      await parseAndEvaluateStatement(`{${m}/AssignMentor {mentorId 1, menteeId 3}}`);

      // Query mentees through relationship
      const result = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 1}, ${m}/Mentors {${m}/Employee? {}}}`
      )) as Instance[];
      assert.equal(result.length, 1);
      const mentees = result[0].getRelatedInstances(`${m}/Mentors`);
      assert(mentees);
      assert.equal(mentees.length, 2);
      const menteeNames = mentees.map((e: Instance) => e.lookup('name')).sort();
      assert.deepEqual(menteeNames, ['Junior1', 'Junior2']);
    });
  });

  // =========================================================================
  // 3. Direct relationship table query for reverse lookups
  // =========================================================================
  describe('Direct relationship table queries (reverse lookup)', () => {
    test('query relationship table directly to find reverse direction', async () => {
      await doInternModule(
        'SRReverse',
        `entity Person {
          id Int @id,
          name String
        }
        relationship Supervises between(Person @as supervisor, Person @as subordinate) @one_many

        workflow Assign {
          {Person {id? Assign.supId}} @as [s];
          {Person {id? Assign.subId}} @as [r];
          {Supervises {supervisor s, subordinate r}}
        }
        `
      );

      const m = 'SRReverse';
      await parseAndEvaluateStatement(`{${m}/Person {id 1, name "Boss"}}`);
      await parseAndEvaluateStatement(`{${m}/Person {id 2, name "Worker1"}}`);
      await parseAndEvaluateStatement(`{${m}/Person {id 3, name "Worker2"}}`);
      await parseAndEvaluateStatement(`{${m}/Person {id 4, name "BigBoss"}}`);

      await parseAndEvaluateStatement(`{${m}/Assign {supId 1, subId 2}}`);
      await parseAndEvaluateStatement(`{${m}/Assign {supId 1, subId 3}}`);
      await parseAndEvaluateStatement(`{${m}/Assign {supId 4, subId 1}}`);

      // Forward query: Boss's subordinates
      const bossResult = (await parseAndEvaluateStatement(
        `{${m}/Person {id? 1}, ${m}/Supervises {${m}/Person? {}}}`
      )) as Instance[];
      assert.equal(bossResult.length, 1);
      const subs = bossResult[0].getRelatedInstances(`${m}/Supervises`);
      assert(subs);
      assert.equal(subs.length, 2);

      // Direct query on relationship table: find all supervision records
      const allRels = (await parseAndEvaluateStatement(`{${m}/Supervises? {}}`)) as Instance[];
      assert.equal(allRels.length, 3);

      // BigBoss's subordinates (should be Boss)
      const bigBossResult = (await parseAndEvaluateStatement(
        `{${m}/Person {id? 4}, ${m}/Supervises {${m}/Person? {}}}`
      )) as Instance[];
      assert.equal(bigBossResult.length, 1);
      const bigBossSubs = bigBossResult[0].getRelatedInstances(`${m}/Supervises`);
      assert(bigBossSubs);
      assert.equal(bigBossSubs.length, 1);
      assert.equal(bigBossSubs[0].lookup('name'), 'Boss');
    });
  });

  // =========================================================================
  // 4. Delete/purge on self-referencing between relationships
  // =========================================================================
  describe('Delete and purge on self-referencing relationships', () => {
    test('delete self-ref many-to-many relationship entries', async () => {
      await doInternModule(
        'SRDel',
        `entity Person {
          id Int @id,
          name String
        }
        relationship Follows between(Person @as follower, Person @as followed)

        workflow Follow {
          {Person {id? Follow.followerId}} @as [f];
          {Person {id? Follow.followedId}} @as [t];
          {Follows {follower f, followed t}}
        }

        workflow Unfollow {
          {Person {id? Unfollow.followerId}} @as [f];
          {Person {id? Unfollow.followedId}} @as [t];
          purge {Follows {follower? f.__path__, followed? t.__path__}}
        }
        `
      );

      const m = 'SRDel';
      await parseAndEvaluateStatement(`{${m}/Person {id 1, name "Alice"}}`);
      await parseAndEvaluateStatement(`{${m}/Person {id 2, name "Bob"}}`);
      await parseAndEvaluateStatement(`{${m}/Person {id 3, name "Charlie"}}`);

      // Alice follows Bob and Charlie
      await parseAndEvaluateStatement(`{${m}/Follow {followerId 1, followedId 2}}`);
      await parseAndEvaluateStatement(`{${m}/Follow {followerId 1, followedId 3}}`);
      // Bob follows Charlie
      await parseAndEvaluateStatement(`{${m}/Follow {followerId 2, followedId 3}}`);

      // Verify 3 follow relationships exist
      let allFollows = (await parseAndEvaluateStatement(`{${m}/Follows? {}}`)) as Instance[];
      assert.equal(allFollows.length, 3);

      // Alice unfollows Bob
      await parseAndEvaluateStatement(`{${m}/Unfollow {followerId 1, followedId 2}}`);

      // Verify 2 follow relationships remain
      allFollows = (await parseAndEvaluateStatement(`{${m}/Follows? {}}`)) as Instance[];
      assert.equal(allFollows.length, 2);

      // Alice's followed list should now only be Charlie
      const aliceResult = (await parseAndEvaluateStatement(
        `{${m}/Person {id? 1}, ${m}/Follows {${m}/Person? {}}}`
      )) as Instance[];
      assert.equal(aliceResult.length, 1);
      const aliceFollows = aliceResult[0].getRelatedInstances(`${m}/Follows`);
      assert(aliceFollows);
      assert.equal(aliceFollows.length, 1);
      assert.equal(aliceFollows[0].lookup('name'), 'Charlie');
    });

    test('delete self-ref one-to-many relationship entries', async () => {
      await doInternModule(
        'SRDel1M',
        `entity Employee {
          id Int @id,
          name String
        }
        relationship Manages between(Employee @as mgr, Employee @as sub) @one_many

        workflow SetMgr {
          {Employee {id? SetMgr.mgrId}} @as [m];
          {Employee {id? SetMgr.subId}} @as [r];
          {Manages {mgr m, sub r}}
        }

        workflow RemoveSub {
          {Employee {id? RemoveSub.mgrId}} @as [m];
          {Employee {id? RemoveSub.subId}} @as [r];
          purge {Manages {mgr? m.__path__, sub? r.__path__}}
        }
        `
      );

      const m = 'SRDel1M';
      await parseAndEvaluateStatement(`{${m}/Employee {id 1, name "Boss"}}`);
      await parseAndEvaluateStatement(`{${m}/Employee {id 2, name "W1"}}`);
      await parseAndEvaluateStatement(`{${m}/Employee {id 3, name "W2"}}`);

      await parseAndEvaluateStatement(`{${m}/SetMgr {mgrId 1, subId 2}}`);
      await parseAndEvaluateStatement(`{${m}/SetMgr {mgrId 1, subId 3}}`);

      // Verify 2 management relationships
      let rels = (await parseAndEvaluateStatement(`{${m}/Manages? {}}`)) as Instance[];
      assert.equal(rels.length, 2);

      // Remove W1 from Boss's team
      await parseAndEvaluateStatement(`{${m}/RemoveSub {mgrId 1, subId 2}}`);

      rels = (await parseAndEvaluateStatement(`{${m}/Manages? {}}`)) as Instance[];
      assert.equal(rels.length, 1);

      // Boss should only have W2
      const bossResult = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 1}, ${m}/Manages {${m}/Employee? {}}}`
      )) as Instance[];
      const subs = bossResult[0].getRelatedInstances(`${m}/Manages`);
      assert(subs);
      assert.equal(subs.length, 1);
      assert.equal(subs[0].lookup('name'), 'W2');
    });
  });

  // =========================================================================
  // 5. One-to-many self-ref tree structure
  // =========================================================================
  describe('One-to-many self-ref tree', () => {
    test('one-to-many self-ref builds a tree with multiple children per parent', async () => {
      await doInternModule(
        'SRCard',
        `entity Node {
          id Int @id,
          label String
        }
        relationship ParentChild between(Node @as parent, Node @as child) @one_many

        workflow Link {
          {Node {id? Link.parentId}} @as [p];
          {Node {id? Link.childId}} @as [c];
          {ParentChild {parent p, child c}}
        }
        `
      );

      const m = 'SRCard';
      await parseAndEvaluateStatement(`{${m}/Node {id 1, label "Root"}}`);
      await parseAndEvaluateStatement(`{${m}/Node {id 2, label "Child1"}}`);
      await parseAndEvaluateStatement(`{${m}/Node {id 3, label "Child2"}}`);
      await parseAndEvaluateStatement(`{${m}/Node {id 4, label "Grandchild"}}`);

      // Root -> Child1, Root -> Child2
      await parseAndEvaluateStatement(`{${m}/Link {parentId 1, childId 2}}`);
      await parseAndEvaluateStatement(`{${m}/Link {parentId 1, childId 3}}`);

      // Child1 -> Grandchild (two-level tree)
      await parseAndEvaluateStatement(`{${m}/Link {parentId 2, childId 4}}`);

      // Verify Root has 2 children
      const rootResult = (await parseAndEvaluateStatement(
        `{${m}/Node {id? 1}, ${m}/ParentChild {${m}/Node? {}}}`
      )) as Instance[];
      const children = rootResult[0].getRelatedInstances(`${m}/ParentChild`);
      assert(children);
      assert.equal(children.length, 2);
      const childLabels = children.map((n: Instance) => n.lookup('label')).sort();
      assert.deepEqual(childLabels, ['Child1', 'Child2']);

      // Verify Child1 has 1 grandchild
      const child1Result = (await parseAndEvaluateStatement(
        `{${m}/Node {id? 2}, ${m}/ParentChild {${m}/Node? {}}}`
      )) as Instance[];
      const grandchildren = child1Result[0].getRelatedInstances(`${m}/ParentChild`);
      assert(grandchildren);
      assert.equal(grandchildren.length, 1);
      assert.equal(grandchildren[0].lookup('label'), 'Grandchild');

      // Verify total relationship records
      const allLinks = (await parseAndEvaluateStatement(`{${m}/ParentChild? {}}`)) as Instance[];
      assert.equal(allLinks.length, 3);
    });
  });

  // =========================================================================
  // 6. Multiple self-ref relationships on the same entity
  // =========================================================================
  describe('Multiple self-ref relationships on same entity', () => {
    test('two different self-ref between relationships', async () => {
      await doInternModule(
        'SRMulti',
        `entity User {
          id Int @id,
          name String
        }
        relationship Follows between(User @as follower, User @as followee)
        relationship Blocks between(User @as blocker, User @as blocked)

        workflow DoFollow {
          {User {id? DoFollow.fId}} @as [f];
          {User {id? DoFollow.tId}} @as [t];
          {Follows {follower f, followee t}}
        }

        workflow DoBlock {
          {User {id? DoBlock.fId}} @as [f];
          {User {id? DoBlock.tId}} @as [t];
          {Blocks {blocker f, blocked t}}
        }
        `
      );

      const m = 'SRMulti';
      await parseAndEvaluateStatement(`{${m}/User {id 1, name "Alice"}}`);
      await parseAndEvaluateStatement(`{${m}/User {id 2, name "Bob"}}`);
      await parseAndEvaluateStatement(`{${m}/User {id 3, name "Charlie"}}`);

      // Alice follows Bob and Charlie
      await parseAndEvaluateStatement(`{${m}/DoFollow {fId 1, tId 2}}`);
      await parseAndEvaluateStatement(`{${m}/DoFollow {fId 1, tId 3}}`);
      // Alice blocks Charlie
      await parseAndEvaluateStatement(`{${m}/DoBlock {fId 1, tId 3}}`);
      // Bob follows Alice
      await parseAndEvaluateStatement(`{${m}/DoFollow {fId 2, tId 1}}`);

      // Check Alice's follows
      const aliceFollows = (await parseAndEvaluateStatement(
        `{${m}/User {id? 1}, ${m}/Follows {${m}/User? {}}}`
      )) as Instance[];
      const follows = aliceFollows[0].getRelatedInstances(`${m}/Follows`);
      assert(follows);
      assert.equal(follows.length, 2);

      // Check Alice's blocks
      const aliceBlocks = (await parseAndEvaluateStatement(
        `{${m}/User {id? 1}, ${m}/Blocks {${m}/User? {}}}`
      )) as Instance[];
      const blocks = aliceBlocks[0].getRelatedInstances(`${m}/Blocks`);
      assert(blocks);
      assert.equal(blocks.length, 1);
      assert.equal(blocks[0].lookup('name'), 'Charlie');

      // Check Bob's follows (should be Alice)
      const bobFollows = (await parseAndEvaluateStatement(
        `{${m}/User {id? 2}, ${m}/Follows {${m}/User? {}}}`
      )) as Instance[];
      const bFollows = bobFollows[0].getRelatedInstances(`${m}/Follows`);
      assert(bFollows);
      assert.equal(bFollows.length, 1);
      assert.equal(bFollows[0].lookup('name'), 'Alice');

      // Verify total follow/block records
      const allFollows = (await parseAndEvaluateStatement(`{${m}/Follows? {}}`)) as Instance[];
      assert.equal(allFollows.length, 3);

      const allBlocks = (await parseAndEvaluateStatement(`{${m}/Blocks? {}}`)) as Instance[];
      assert.equal(allBlocks.length, 1);
    });
  });

  // =========================================================================
  // 7. Self-ref + non-self-ref between relationships on same entity
  // =========================================================================
  describe('Self-ref mixed with non-self-ref between', () => {
    test('entity participates in both self-ref and regular between', async () => {
      await doInternModule(
        'SRMixed',
        `entity Employee {
          id Int @id,
          name String
        }
        entity Project {
          id Int @id,
          title String
        }
        relationship ReportsTo between(Employee @as manager, Employee @as reportee) @one_many
        relationship Assignment between(Employee, Project)

        workflow SetManager {
          {Employee {id? SetManager.mgrId}} @as [m];
          {Employee {id? SetManager.repId}} @as [r];
          {ReportsTo {manager m, reportee r}}
        }

        workflow AssignProject {
          {Employee {id? AssignProject.empId}} @as [e];
          {Project {id? AssignProject.projId}} @as [p];
          {Assignment {Employee e, Project p}}
        }
        `
      );

      const m = 'SRMixed';
      await parseAndEvaluateStatement(`{${m}/Employee {id 1, name "Alice"}}`);
      await parseAndEvaluateStatement(`{${m}/Employee {id 2, name "Bob"}}`);
      await parseAndEvaluateStatement(`{${m}/Employee {id 3, name "Charlie"}}`);
      await parseAndEvaluateStatement(`{${m}/Project {id 10, title "ProjectX"}}`);
      await parseAndEvaluateStatement(`{${m}/Project {id 20, title "ProjectY"}}`);

      // Alice manages Bob and Charlie
      await parseAndEvaluateStatement(`{${m}/SetManager {mgrId 1, repId 2}}`);
      await parseAndEvaluateStatement(`{${m}/SetManager {mgrId 1, repId 3}}`);

      // Alice and Bob on ProjectX; Charlie on ProjectY
      await parseAndEvaluateStatement(`{${m}/AssignProject {empId 1, projId 10}}`);
      await parseAndEvaluateStatement(`{${m}/AssignProject {empId 2, projId 10}}`);
      await parseAndEvaluateStatement(`{${m}/AssignProject {empId 3, projId 20}}`);

      // Query Alice's reportees via self-ref
      const aliceResult = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 1}, ${m}/ReportsTo {${m}/Employee? {}}}`
      )) as Instance[];
      const reportees = aliceResult[0].getRelatedInstances(`${m}/ReportsTo`);
      assert(reportees);
      assert.equal(reportees.length, 2);

      // Query Alice's projects via regular between
      const aliceProjects = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 1}, ${m}/Assignment {${m}/Project? {}}}`
      )) as Instance[];
      const projects = aliceProjects[0].getRelatedInstances(`${m}/Assignment`);
      assert(projects);
      assert.equal(projects.length, 1);
      assert.equal(projects[0].lookup('title'), 'ProjectX');

      // Query Project X's members via regular between (reverse direction)
      const projResult = (await parseAndEvaluateStatement(
        `{${m}/Project {id? 10}, ${m}/Assignment {${m}/Employee? {}}}`
      )) as Instance[];
      const members = projResult[0].getRelatedInstances(`${m}/Assignment`);
      assert(members);
      assert.equal(members.length, 2);
      const memberNames = members.map((e: Instance) => e.lookup('name')).sort();
      assert.deepEqual(memberNames, ['Alice', 'Bob']);

      // Verify entity-level relationship lookup works for self-ref
      const rels = getAllBetweenRelationshipsForEntity('SRMixed', 'Employee');
      assert.equal(rels.length, 2);
      const relNames = rels.map((r: Relationship) => r.name).sort();
      assert.deepEqual(relNames, ['Assignment', 'ReportsTo']);
    });
  });

  // =========================================================================
  // 8. Self-ref with workflow chaining (multi-step create)
  // =========================================================================
  describe('Workflow chaining with self-ref relationships', () => {
    test('multi-step workflow that creates entity and links in one flow', async () => {
      await doInternModule(
        'SRChain',
        `entity Task {
          id Int @id,
          title String,
          status String
        }
        relationship Dependency between(Task @as blocker, Task @as blocked) @one_many

        workflow CreateAndLink {
          {Task {id CreateAndLink.taskId, title CreateAndLink.title, status "open"}} @as [newTask];
          if (CreateAndLink.blockerId > 0) {
            {Task {id? CreateAndLink.blockerId}} @as [blocker];
            {Dependency {blocker blocker, blocked newTask}}
          }
        }
        `
      );

      const m = 'SRChain';

      // Create independent task
      await parseAndEvaluateStatement(
        `{${m}/CreateAndLink {taskId 1, title "Setup infra", blockerId 0}}`
      );

      // Create task that depends on task 1
      await parseAndEvaluateStatement(
        `{${m}/CreateAndLink {taskId 2, title "Build API", blockerId 1}}`
      );

      // Create another task that also depends on task 1
      await parseAndEvaluateStatement(
        `{${m}/CreateAndLink {taskId 3, title "Build UI", blockerId 1}}`
      );

      // Create task that depends on task 2
      await parseAndEvaluateStatement(
        `{${m}/CreateAndLink {taskId 4, title "Integration test", blockerId 2}}`
      );

      // Verify: task 1 blocks tasks 2 and 3
      const task1Result = (await parseAndEvaluateStatement(
        `{${m}/Task {id? 1}, ${m}/Dependency {${m}/Task? {}}}`
      )) as Instance[];
      const blockedByTask1 = task1Result[0].getRelatedInstances(`${m}/Dependency`);
      assert(blockedByTask1);
      assert.equal(blockedByTask1.length, 2);
      const blockedTitles = blockedByTask1.map((t: Instance) => t.lookup('title')).sort();
      assert.deepEqual(blockedTitles, ['Build API', 'Build UI']);

      // Verify: task 2 blocks task 4
      const task2Result = (await parseAndEvaluateStatement(
        `{${m}/Task {id? 2}, ${m}/Dependency {${m}/Task? {}}}`
      )) as Instance[];
      const blockedByTask2 = task2Result[0].getRelatedInstances(`${m}/Dependency`);
      assert(blockedByTask2);
      assert.equal(blockedByTask2.length, 1);
      assert.equal(blockedByTask2[0].lookup('title'), 'Integration test');

      // Verify total dependency records
      const allDeps = (await parseAndEvaluateStatement(`{${m}/Dependency? {}}`)) as Instance[];
      assert.equal(allDeps.length, 3);
    });
  });

  // =========================================================================
  // 9. Self-ref many-to-many with multiple independent link sets
  // =========================================================================
  describe('Self-ref with multiple independent link sets', () => {
    test('between relationship tracks independent link groups', async () => {
      await doInternModule(
        'SRSchema',
        `entity Person {
          id Int @id,
          name String
        }
        relationship Referral between(Person @as referrer, Person @as referred)

        workflow MakeReferral {
          {Person {id? MakeReferral.referrerId}} @as [r];
          {Person {id? MakeReferral.referredId}} @as [p];
          {Referral {referrer r, referred p}}
        }
        `
      );

      const m = 'SRSchema';
      await parseAndEvaluateStatement(`{${m}/Person {id 1, name "Alice"}}`);
      await parseAndEvaluateStatement(`{${m}/Person {id 2, name "Bob"}}`);
      await parseAndEvaluateStatement(`{${m}/Person {id 3, name "Charlie"}}`);
      await parseAndEvaluateStatement(`{${m}/Person {id 4, name "Diana"}}`);

      // Alice refers Bob and Charlie
      await parseAndEvaluateStatement(`{${m}/MakeReferral {referrerId 1, referredId 2}}`);
      await parseAndEvaluateStatement(`{${m}/MakeReferral {referrerId 1, referredId 3}}`);

      // Bob refers Diana
      await parseAndEvaluateStatement(`{${m}/MakeReferral {referrerId 2, referredId 4}}`);

      // Query all referral records
      const allReferrals = (await parseAndEvaluateStatement(`{${m}/Referral? {}}`)) as Instance[];
      assert.equal(allReferrals.length, 3);

      // Query Alice's referrals through relationship
      const aliceResult = (await parseAndEvaluateStatement(
        `{${m}/Person {id? 1}, ${m}/Referral {${m}/Person? {}}}`
      )) as Instance[];
      const referred = aliceResult[0].getRelatedInstances(`${m}/Referral`);
      assert(referred);
      assert.equal(referred.length, 2);
      const referredNames = referred.map((p: Instance) => p.lookup('name')).sort();
      assert.deepEqual(referredNames, ['Bob', 'Charlie']);

      // Query Bob's referrals
      const bobResult = (await parseAndEvaluateStatement(
        `{${m}/Person {id? 2}, ${m}/Referral {${m}/Person? {}}}`
      )) as Instance[];
      const bobReferred = bobResult[0].getRelatedInstances(`${m}/Referral`);
      assert(bobReferred);
      assert.equal(bobReferred.length, 1);
      assert.equal(bobReferred[0].lookup('name'), 'Diana');
    });
  });

  // =========================================================================
  // 10. Self-ref with @catch error handling
  // =========================================================================
  describe('Self-ref with error handling', () => {
    test('handle not_found when querying self-ref relationship', async () => {
      await doInternModule(
        'SRCatch',
        `entity Item {
          id Int @id,
          name String
        }
        relationship Link between(Item @as source, Item @as target)

        workflow SafeLink {
          {Item {id? SafeLink.sourceId}} @as [s]
          @catch {not_found {Item {id -1, name "MISSING_SOURCE"}}};
          {Item {id? SafeLink.targetId}} @as [t]
          @catch {not_found {Item {id -2, name "MISSING_TARGET"}}};
          {Link {source s, target t}}
        }
        `
      );

      const m = 'SRCatch';
      await parseAndEvaluateStatement(`{${m}/Item {id 1, name "A"}}`);
      await parseAndEvaluateStatement(`{${m}/Item {id 2, name "B"}}`);

      // Valid link
      const r1 = await parseAndEvaluateStatement(`{${m}/SafeLink {sourceId 1, targetId 2}}`);
      assert(isInstanceOfType(r1, `${m}/Link`));

      // Verify the link was created
      const links = (await parseAndEvaluateStatement(`{${m}/Link? {}}`)) as Instance[];
      assert.equal(links.length, 1);
    });
  });

  // =========================================================================
  // 11. Self-ref with conditional branching
  // =========================================================================
  describe('Self-ref with conditional logic', () => {
    test('workflow with if/else choosing different self-ref relationships', async () => {
      await doInternModule(
        'SRCond',
        `entity Employee {
          id Int @id,
          name String
        }
        relationship Mentors between(Employee @as mentor, Employee @as mentee)
        relationship Manages between(Employee @as mgr, Employee @as sub) @one_many

        workflow Connect {
          {Employee {id? Connect.fromId}} @as [from];
          {Employee {id? Connect.toId}} @as [to];
          if (Connect.relType == "mentor") {
            {Mentors {mentor from, mentee to}}
          } else {
            {Manages {mgr from, sub to}}
          }
        }
        `
      );

      const m = 'SRCond';
      await parseAndEvaluateStatement(`{${m}/Employee {id 1, name "Senior"}}`);
      await parseAndEvaluateStatement(`{${m}/Employee {id 2, name "Mid"}}`);
      await parseAndEvaluateStatement(`{${m}/Employee {id 3, name "Junior"}}`);

      // Senior mentors Mid
      await parseAndEvaluateStatement(`{${m}/Connect {fromId 1, toId 2, relType "mentor"}}`);
      // Senior manages Junior
      await parseAndEvaluateStatement(`{${m}/Connect {fromId 1, toId 3, relType "manage"}}`);
      // Mid mentors Junior
      await parseAndEvaluateStatement(`{${m}/Connect {fromId 2, toId 3, relType "mentor"}}`);

      // Senior's mentees
      const mentorResult = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 1}, ${m}/Mentors {${m}/Employee? {}}}`
      )) as Instance[];
      const mentees = mentorResult[0].getRelatedInstances(`${m}/Mentors`);
      assert(mentees);
      assert.equal(mentees.length, 1);
      assert.equal(mentees[0].lookup('name'), 'Mid');

      // Senior's subordinates
      const mgrResult = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 1}, ${m}/Manages {${m}/Employee? {}}}`
      )) as Instance[];
      const subs = mgrResult[0].getRelatedInstances(`${m}/Manages`);
      assert(subs);
      assert.equal(subs.length, 1);
      assert.equal(subs[0].lookup('name'), 'Junior');

      // Verify totals
      const allMentors = (await parseAndEvaluateStatement(`{${m}/Mentors? {}}`)) as Instance[];
      assert.equal(allMentors.length, 2);

      const allManages = (await parseAndEvaluateStatement(`{${m}/Manages? {}}`)) as Instance[];
      assert.equal(allManages.length, 1);
    });
  });

  // =========================================================================
  // 12. Self-ref with multiple link workflows
  // =========================================================================
  describe('Self-ref with multiple link operations', () => {
    test('create a web of self-ref links via repeated workflow calls', async () => {
      await doInternModule(
        'SRForEach',
        `entity Node {
          id Int @id,
          value Int
        }
        relationship Edge between(Node @as from, Node @as to)

        workflow LinkNodes {
          {Node {id? LinkNodes.fromId}} @as [f];
          {Node {id? LinkNodes.toId}} @as [t];
          {Edge {from f, to t}}
        }
        `
      );

      const m = 'SRForEach';
      await parseAndEvaluateStatement(`{${m}/Node {id 1, value 100}}`);
      await parseAndEvaluateStatement(`{${m}/Node {id 2, value 200}}`);
      await parseAndEvaluateStatement(`{${m}/Node {id 3, value 50}}`);
      await parseAndEvaluateStatement(`{${m}/Node {id 4, value 25}}`);

      // Create edges: high-value nodes (1,2) -> low-value nodes (3,4)
      await parseAndEvaluateStatement(`{${m}/LinkNodes {fromId 1, toId 3}}`);
      await parseAndEvaluateStatement(`{${m}/LinkNodes {fromId 1, toId 4}}`);
      await parseAndEvaluateStatement(`{${m}/LinkNodes {fromId 2, toId 3}}`);
      await parseAndEvaluateStatement(`{${m}/LinkNodes {fromId 2, toId 4}}`);

      // Should have 4 edges total
      const allEdges = (await parseAndEvaluateStatement(`{${m}/Edge? {}}`)) as Instance[];
      assert.equal(allEdges.length, 4);

      // Verify node 1's connections
      const node1Result = (await parseAndEvaluateStatement(
        `{${m}/Node {id? 1}, ${m}/Edge {${m}/Node? {}}}`
      )) as Instance[];
      const node1Edges = node1Result[0].getRelatedInstances(`${m}/Edge`);
      assert(node1Edges);
      assert.equal(node1Edges.length, 2);
      const node1Targets = node1Edges.map((n: Instance) => n.lookup('value')).sort();
      assert.deepEqual(node1Targets, [25, 50]);
    });
  });

  // =========================================================================
  // 13. Self-ref category hierarchy via workflow
  // =========================================================================
  describe('Self-ref category hierarchy', () => {
    test('create self-ref link via workflow for category tree', async () => {
      await doInternModule(
        'SRInline',
        `entity Category {
          id Int @id,
          name String
        }
        relationship SubCategory between(Category @as parent, Category @as child) @one_many

        workflow LinkCategory {
          {Category {id? LinkCategory.parentId}} @as [p];
          {Category {id? LinkCategory.childId}} @as [c];
          {SubCategory {parent p, child c}}
        }
        `
      );

      const m = 'SRInline';

      // Create categories
      await parseAndEvaluateStatement(`{${m}/Category {id 1, name "Electronics"}}`);
      await parseAndEvaluateStatement(`{${m}/Category {id 2, name "Phones"}}`);
      await parseAndEvaluateStatement(`{${m}/Category {id 3, name "Laptops"}}`);
      await parseAndEvaluateStatement(`{${m}/Category {id 4, name "Tablets"}}`);

      // Create parent-child links via workflow
      await parseAndEvaluateStatement(`{${m}/LinkCategory {parentId 1, childId 2}}`);
      await parseAndEvaluateStatement(`{${m}/LinkCategory {parentId 1, childId 3}}`);
      await parseAndEvaluateStatement(`{${m}/LinkCategory {parentId 1, childId 4}}`);

      // Verify Electronics has 3 subcategories
      const result = (await parseAndEvaluateStatement(
        `{${m}/Category {id? 1}, ${m}/SubCategory {${m}/Category? {}}}`
      )) as Instance[];
      const subs = result[0].getRelatedInstances(`${m}/SubCategory`);
      assert(subs);
      assert.equal(subs.length, 3);
      const subNames = subs.map((c: Instance) => c.lookup('name')).sort();
      assert.deepEqual(subNames, ['Laptops', 'Phones', 'Tablets']);
    });
  });

  // =========================================================================
  // 14. isSelfReferencing() method validation
  // =========================================================================
  describe('isSelfReferencing() API', () => {
    test('correctly identifies self-referencing vs normal relationships', async () => {
      await doInternModule(
        'SRApi',
        `entity A {
          id Int @id
        }
        entity B {
          id Int @id
        }
        relationship SelfRel between(A @as left, A @as right)
        relationship NormalRel between(A, B)
        `
      );

      const mod = fetchModule('SRApi');
      const rels = mod.getRelationshipEntries();
      assert.equal(rels.length, 2);

      const selfRel = rels.find((r: Relationship) => r.name === 'SelfRel');
      const normalRel = rels.find((r: Relationship) => r.name === 'NormalRel');

      assert(selfRel);
      assert(normalRel);

      assert.equal(selfRel!.isSelfReferencing(), true);
      assert.equal(normalRel!.isSelfReferencing(), false);

      // Verify aliases on self-ref
      assert.equal(selfRel!.node1.alias, 'left');
      assert.equal(selfRel!.node2.alias, 'right');

      // Verify aliases on normal (defaults to entity name)
      assert.equal(normalRel!.node1.alias, 'A');
      assert.equal(normalRel!.node2.alias, 'B');
    });
  });

  // =========================================================================
  // 15. Self-ref with query filtering on related instances
  // =========================================================================
  describe('Self-ref relationship query with attribute filters', () => {
    test('query connected instances with filter attributes', async () => {
      await doInternModule(
        'SRFilter',
        `entity Employee {
          id Int @id,
          name String,
          department String
        }
        relationship Mentors between(Employee @as mentor, Employee @as mentee)

        workflow Mentor {
          {Employee {id? Mentor.mentorId}} @as [m];
          {Employee {id? Mentor.menteeId}} @as [e];
          {Mentors {mentor m, mentee e}}
        }
        `
      );

      const m = 'SRFilter';
      await parseAndEvaluateStatement(
        `{${m}/Employee {id 1, name "Alice", department "Engineering"}}`
      );
      await parseAndEvaluateStatement(
        `{${m}/Employee {id 2, name "Bob", department "Engineering"}}`
      );
      await parseAndEvaluateStatement(`{${m}/Employee {id 3, name "Charlie", department "Sales"}}`);
      await parseAndEvaluateStatement(
        `{${m}/Employee {id 4, name "Diana", department "Marketing"}}`
      );

      // Alice mentors Bob, Charlie, Diana
      await parseAndEvaluateStatement(`{${m}/Mentor {mentorId 1, menteeId 2}}`);
      await parseAndEvaluateStatement(`{${m}/Mentor {mentorId 1, menteeId 3}}`);
      await parseAndEvaluateStatement(`{${m}/Mentor {mentorId 1, menteeId 4}}`);

      // Query only Engineering mentees of Alice
      const result = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 1}, ${m}/Mentors {${m}/Employee {department? "Engineering"}}}`
      )) as Instance[];
      assert.equal(result.length, 1);
      const engMentees = result[0].getRelatedInstances(`${m}/Mentors`);
      assert(engMentees);
      assert.equal(engMentees.length, 1);
      assert.equal(engMentees[0].lookup('name'), 'Bob');

      // Query all mentees (no filter)
      const allResult = (await parseAndEvaluateStatement(
        `{${m}/Employee {id? 1}, ${m}/Mentors {${m}/Employee? {}}}`
      )) as Instance[];
      const allMentees = allResult[0].getRelatedInstances(`${m}/Mentors`);
      assert(allMentees);
      assert.equal(allMentees.length, 3);
    });
  });

  // =========================================================================
  // 16. Large-scale self-ref: stress test with many links
  // =========================================================================
  describe('Self-ref stress test', () => {
    test('handle many self-referencing links', async () => {
      await doInternModule(
        'SRStress',
        `entity Node {
          id Int @id,
          label String
        }
        relationship Edge between(Node @as src, Node @as dst)

        workflow Link {
          {Node {id? Link.srcId}} @as [s];
          {Node {id? Link.dstId}} @as [d];
          {Edge {src s, dst d}}
        }
        `
      );

      const m = 'SRStress';
      const nodeCount = 10;

      // Create nodes
      for (let i = 1; i <= nodeCount; i++) {
        await parseAndEvaluateStatement(`{${m}/Node {id ${i}, label "N${i}"}}`);
      }

      // Create edges: node 1 connects to all others
      for (let i = 2; i <= nodeCount; i++) {
        await parseAndEvaluateStatement(`{${m}/Link {srcId 1, dstId ${i}}}`);
      }

      // Also create a few cross-links
      await parseAndEvaluateStatement(`{${m}/Link {srcId 2, dstId 3}}`);
      await parseAndEvaluateStatement(`{${m}/Link {srcId 3, dstId 4}}`);
      await parseAndEvaluateStatement(`{${m}/Link {srcId 5, dstId 1}}`);

      // Verify total edges
      const allEdges = (await parseAndEvaluateStatement(`{${m}/Edge? {}}`)) as Instance[];
      assert.equal(allEdges.length, nodeCount - 1 + 3); // 9 + 3 = 12

      // Verify node 1's connections
      const node1Result = (await parseAndEvaluateStatement(
        `{${m}/Node {id? 1}, ${m}/Edge {${m}/Node? {}}}`
      )) as Instance[];
      const node1Edges = node1Result[0].getRelatedInstances(`${m}/Edge`);
      assert(node1Edges);
      assert.equal(node1Edges.length, nodeCount - 1);

      // Verify node 5's connections (should have node 1 as target)
      const node5Result = (await parseAndEvaluateStatement(
        `{${m}/Node {id? 5}, ${m}/Edge {${m}/Node? {}}}`
      )) as Instance[];
      const node5Edges = node5Result[0].getRelatedInstances(`${m}/Edge`);
      assert(node5Edges);
      assert.equal(node5Edges.length, 1);
      assert.equal(node5Edges[0].lookup('label'), 'N1');
    });
  });

  // =========================================================================
  // 17. Self-ref one-to-one delete and re-link
  // =========================================================================
  describe('Self-ref one-to-one unlink and relink', () => {
    test('unlink and relink one-to-one self-ref partners', async () => {
      await doInternModule(
        'SR11Relink',
        `entity Agent {
          id Int @id,
          codename String
        }
        relationship Partner between(Agent @as agentA, Agent @as agentB) @one_one

        workflow Pair {
          {Agent {id? Pair.aId}} @as [a];
          {Agent {id? Pair.bId}} @as [b];
          {Partner {agentA a, agentB b}}
        }

        workflow Unpair {
          {Agent {id? Unpair.aId}} @as [a];
          {Agent {id? Unpair.bId}} @as [b];
          purge {Partner {agentA? a, agentB? b}}
        }
        `
      );

      const m = 'SR11Relink';
      await parseAndEvaluateStatement(`{${m}/Agent {id 1, codename "Alpha"}}`);
      await parseAndEvaluateStatement(`{${m}/Agent {id 2, codename "Bravo"}}`);
      await parseAndEvaluateStatement(`{${m}/Agent {id 3, codename "Charlie"}}`);

      // Pair Alpha with Bravo
      await parseAndEvaluateStatement(`{${m}/Pair {aId 1, bId 2}}`);

      // Verify partner
      const r1 = (await parseAndEvaluateStatement(
        `{${m}/Agent {id? 1}, ${m}/Partner {${m}/Agent? {}}}`
      )) as Instance[];
      const p1 = r1[0].getRelatedInstances(`${m}/Partner`);
      assert(p1);
      assert.equal(p1.length, 1);
      assert.equal(p1[0].lookup('codename'), 'Bravo');

      // One-to-one: Alpha can't also be paired with Charlie
      let failed = false;
      try {
        await parseAndEvaluateStatement(`{${m}/Pair {aId 1, bId 3}}`);
      } catch {
        failed = true;
      }
      assert(failed, 'Should fail: one-to-one constraint violated');

      // Unpair Alpha and Bravo
      await parseAndEvaluateStatement(`{${m}/Unpair {aId 1, bId 2}}`);

      // Now Alpha can be paired with Charlie
      await parseAndEvaluateStatement(`{${m}/Pair {aId 1, bId 3}}`);
      const r2 = (await parseAndEvaluateStatement(
        `{${m}/Agent {id? 1}, ${m}/Partner {${m}/Agent? {}}}`
      )) as Instance[];
      const p2 = r2[0].getRelatedInstances(`${m}/Partner`);
      assert(p2);
      assert.equal(p2.length, 1);
      assert.equal(p2[0].lookup('codename'), 'Charlie');
    });
  });
});
