import { assert, describe, test } from 'vitest';
import { assignUserToRole, createPermission, createUser } from '../../src/runtime/modules/auth.js';
import { Environment, parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { isInstanceOfType } from '../../src/runtime/module.js';
import { doInternModule, expectError } from '../util.js';
import { callWithRbac } from '../../src/runtime/auth/defs.js';

describe('Agent RBAC role enforcement', () => {
  test('assumedRole replaces user roles for RBAC checks', async () => {
    await callWithRbac(async () => {
      await doInternModule(
        'AgentRbac',
        `entity Ticket {
          id Int @id,
          title String,
          @rbac [(roles: [reader], allow: [read]),
                 (roles: [writer], allow: [create, read, update])]
        }`
      );

      const userId = crypto.randomUUID();
      const env = new Environment();
      async function setup() {
        await createUser(userId, 'agent-user@test.com', 'Agent', 'User', env);
        await assignUserToRole(userId, 'writer', env);
      }
      await env.callInTransaction(setup);

      // User with 'writer' role can create
      const t1 = await parseAndEvaluateStatement(
        `{AgentRbac/Ticket {id 1, title "Bug report"}}`,
        userId
      );
      assert(isInstanceOfType(t1, 'AgentRbac/Ticket'), 'Writer should create tickets');

      // User with 'writer' role can read
      const t1r: any = await parseAndEvaluateStatement(`{AgentRbac/Ticket {id? 1}}`, userId);
      assert(t1r.length === 1, 'Writer should read tickets');

      // Now set assumedRole to 'reader' — this should REPLACE the user's 'writer' role
      const envWithRole = new Environment('agent-env');
      envWithRole.setActiveUser(userId);
      envWithRole.setAssumedRole('reader');

      // With assumedRole='reader', create should fail (reader only has read permission)
      const ee = expectError();
      await parseAndEvaluateStatement(
        `{AgentRbac/Ticket {id 2, title "Feature request"}}`,
        userId,
        envWithRole
      ).catch(ee.f());
      assert(ee.isFailed, 'Agent with reader role should not be able to create tickets');

      // With assumedRole='reader', read should succeed
      const t1read: any = await parseAndEvaluateStatement(
        `{AgentRbac/Ticket {id? 1}}`,
        userId,
        envWithRole
      );
      assert(t1read.length === 1, 'Agent with reader role should read tickets');
    });
  });

  test('assumedRole grants permissions the user does not have', async () => {
    await callWithRbac(async () => {
      await doInternModule(
        'AgentRbac2',
        `entity Order {
          id Int @id,
          item String,
          @rbac [(roles: [clerk], allow: [create, read])]
        }`
      );

      const userId = crypto.randomUUID();
      const env = new Environment();
      async function setup() {
        await createUser(userId, 'no-role@test.com', 'No', 'Role', env);
        // User has NO roles — cannot do anything
      }
      await env.callInTransaction(setup);

      // Without assumedRole, user cannot create
      const ee1 = expectError();
      await parseAndEvaluateStatement(`{AgentRbac2/Order {id 1, item "Widget"}}`, userId).catch(
        ee1.f()
      );
      assert(ee1.isFailed, 'User with no roles should not create orders');

      // With assumedRole='clerk', create should succeed
      const envWithRole = new Environment('agent-env');
      envWithRole.setActiveUser(userId);
      envWithRole.setAssumedRole('clerk');

      const o1 = await parseAndEvaluateStatement(
        `{AgentRbac2/Order {id 1, item "Widget"}}`,
        userId,
        envWithRole
      );
      assert(
        isInstanceOfType(o1, 'AgentRbac2/Order'),
        'Agent with clerk role should create orders'
      );
    });
  });

  test('withRole on workflow uses replace semantics', async () => {
    await callWithRbac(async () => {
      await doInternModule(
        'WithRoleReplace',
        `entity Resource {
          id Int @id,
          name String,
          @rbac [(roles: [editor], allow: [create, read, update]),
                 (roles: [viewer], allow: [read])]
        }

        workflow CreateAsEditor @withRole(editor) {
          {WithRoleReplace/Resource {id CreateAsEditor.id, name CreateAsEditor.name}}
        }`
      );

      const userId = crypto.randomUUID();
      const env = new Environment();
      async function setup() {
        await createUser(userId, 'viewer@test.com', 'View', 'Er', env);
        await assignUserToRole(userId, 'viewer', env);
      }
      await env.callInTransaction(setup);

      // User with 'viewer' role cannot create directly
      const ee = expectError();
      await parseAndEvaluateStatement(
        `{WithRoleReplace/Resource {id 1, name "Doc"}}`,
        userId
      ).catch(ee.f());
      assert(ee.isFailed, 'Viewer should not create resources directly');

      // But @withRole(editor) replaces viewer with editor, allowing create
      const r1 = await parseAndEvaluateStatement(
        `{WithRoleReplace/CreateAsEditor {id 2, name "Report"}}`,
        userId
      );
      assert(
        isInstanceOfType(r1, 'WithRoleReplace/Resource'),
        'withRole(editor) should allow create'
      );
    });
  });
});
