import { parseModule } from '../../src/language/parser.js';
import { assert, describe, test } from 'vitest';
import { ModuleDefinition } from '../../src/language/generated/ast.js';
import {
  assignUserToRole,
  createPermission,
  createUser,
  ensureUserRoles,
} from '../../src/runtime/modules/auth.js';
import { internAndRunModule } from '../../src/cli/main.js';
import { Environment, parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';
import { Instance, isInstanceOfType } from '../../src/runtime/module.js';
import { doInitRuntime, doInternModule, expectError } from '../util.js';
import { callWithRbac } from '../../src/runtime/auth/defs.js';

const mod1 = `module Acme
entity Department {
    no Int @id,
    @rbac [(roles: [manager], allow: [create])]
}

entity Employee {
    id Int @id,
    name String
}

relationship DepartmentEmployee contains(Department, Employee)
relationship ManagerReportee between(Employee @as manager, Employee @as reportee) @one_many

workflow CreateEmployee {
    {Department {no? CreateEmployee.deptNo},
     DepartmentEmployee {Employee {id CreateEmployee.id,
                                   name CreateEmployee.name}}}
}

workflow AssignManager {
    {Employee {id? AssignManager.manager}} @as [m];
    {Employee {id? AssignManager.reportee}} @as [r];
    {ManagerReportee {manager m, reportee r}}
}

workflow LookupEmployee {
    {Department {no? LookupEmployee.deptNo},
     DepartmentEmployee {Employee {id? LookupEmployee.id}}}
}
`;

describe('Basic RBAC checks', () => {
  test('test01', async () => {
    await callWithRbac(async () => {
      const module: ModuleDefinition = await parseModule(mod1);
      assert(module.name == 'Acme', 'failed to parse test module');
      await internAndRunModule(module);
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      const env: Environment = new Environment();
      async function f1() {
        await createUser(id1, 'dave@acme.com', 'Dave', 'J', env);
        await createUser(id2, 'sam@acme.com', 'Sam', 'R', env);
        assert(
          (await assignUserToRole(id1, 'manager', env)) == true,
          'Failed to assign manager role'
        );
      }
      await env.callInTransaction(f1);
      let r: any = await parseAndEvaluateStatement(`{Acme/Department {no 101}}`, id1);
      assert(isInstanceOfType(r, 'Acme/Department'), 'Failed to create Department');
      let ee = expectError();
      await parseAndEvaluateStatement(`{Acme/Department {no 102}}`, id2).catch(ee.f());
      assert(ee.isFailed, 'Auth check on create-department failed');
      async function createEmployee(
        userId: string,
        deptNo: number,
        id: number,
        name: string,
        expectFailure: boolean = false
      ): Promise<void> {
        ee = expectError();
        await parseAndEvaluateStatement(
          `{Acme/CreateEmployee {deptNo ${deptNo}, id ${id}, name "${name}"}}`,
          userId
        )
          .then((r: any) => {
            const dept: Instance = r[0] as Instance;
            const emps: Instance[] | undefined = dept.getRelatedInstances('DepartmentEmployee');
            const emp: Instance | undefined = emps ? (emps[0] as Instance) : undefined;
            assert(isInstanceOfType(emp, 'Acme/Employee'), 'Failed to create Employee');
          })
          .catch((reason: any) => {
            if (expectFailure) {
              ee.f()(reason);
            } else {
              throw new Error(reason);
            }
          });
        if (expectFailure) {
          assert(ee.isFailed, 'CreateEmployee was supposed to fail');
        }
      }
      await createEmployee(id2, 101, 1, 'Joe', true);
      await createEmployee(id1, 101, 1, 'Joe');
      await createEmployee(id1, 101, 2, 'Cole');
      ee = expectError();
      await parseAndEvaluateStatement(`{Acme/AssignManager {manager 1, reportee 2}}`, id2).catch(
        ee.f()
      );
      assert(ee.isFailed, 'User should not be allowed to assign a manager');
      r = await parseAndEvaluateStatement(`{Acme/AssignManager {manager 1, reportee 2}}`, id1);
      assert(isInstanceOfType(r, 'Acme/ManagerReportee'), 'Failed to assign reportee to manager');
      r = await parseAndEvaluateStatement(`{Acme/LookupEmployee {deptNo 101, id 1}}`, id2);
      assert(r.length == 0, 'User not allowed to lookup employees in department 101');
      r = await parseAndEvaluateStatement(`{Acme/LookupEmployee {deptNo 101, id 1}}`, id1);
      const dept = r[0] as Instance;
      assert(isInstanceOfType(dept, 'Acme/Department'), 'failed to lookup parent department');
      if (dept.relatedInstances) {
        const emps: Instance[] | undefined = dept.relatedInstances.get('DepartmentEmployee');
        assert(emps && emps.length == 1, 'Failed to lookup department-employees');
        assert(emps[0].get('name') == 'Joe', 'Failed to lookup Joe in department 101');
      }
    });
  });
});

describe('RBAC where-clause test', () => {
  test('test01', async () => {
    await callWithRbac(async () => {
      await doInternModule(
        `RbacWhere`,
        `entity User {
                    id UUID @id,
                    name String,
                    @rbac [(roles: [*], allow: [create]),
                           (allow: [read], where: auth.user = this.id)]
                }`
      );
      const id1 = crypto.randomUUID();
      const id2 = crypto.randomUUID();
      const env: Environment = new Environment();
      async function f1() {
        await createUser(id1, 'u1@w.com', 'User', '01', env);
        await createUser(id2, 'u2@w.com', 'User', '02', env);
      }
      await env.callInTransaction(f1);
      //let ee = expectError()
      async function createLocalUser(userId: string, id: string, name: string): Promise<void> {
        await parseAndEvaluateStatement(
          `{RbacWhere/User {id "${id}", name "${name}"}}`,
          userId
        ).then((r: any) => {
          assert(isInstanceOfType(r, 'RbacWhere/User'), 'Failed to create User');
        });
      }
      await createLocalUser(id1, id1, 'A');
      await createLocalUser(id1, id2, 'B');
      function chkresult(result: Instance[] | undefined, count: number, ids: string[]) {
        assert(result);
        if (result) {
          assert(count == result.length);
        }
        result.forEach((inst: Instance) => {
          assert(
            ids.find((id: string) => {
              return id == inst.lookup('id');
            })
          );
        });
      }
      let r = await parseAndEvaluateStatement(`{RbacWhere/User {id? "${id1}"}}`, id1);
      chkresult(r, 1, [id1]);
      r = await parseAndEvaluateStatement(`{RbacWhere/User {id? "${id2}"}}`, id1);
      chkresult(r, 1, [id2]);
      r = await parseAndEvaluateStatement(`{RbacWhere/User {id? "${id1}"}}`, id2);
      chkresult(r, 0, []);
      r = await parseAndEvaluateStatement(`{RbacWhere/User {id? "${id2}"}}`, id2);
      chkresult(r, 1, [id2]);
      r = await parseAndEvaluateStatement(`{RbacWhere/User? {}}`, id1);
      chkresult(r, 2, [id1, id2]);
      r = await parseAndEvaluateStatement(`{RbacWhere/User? {}}`, id2);
      chkresult(r, 1, [id2]);
    });
  });
});

describe('Issue-350', () => {
  test('Permissions on between', async () => {
    await doInitRuntime();
    const managerRole = 'i2350manager';
    const userId = 'user@i350.com';
    const tempuser = 'temp@i350.com';
    let env = new Environment();
    await createUser(userId, userId, 'User', '01', env);
    await createUser(tempuser, tempuser, 'User', 'temp', env);
    await ensureUserRoles(userId, [managerRole], env);
    await createPermission(
      'i350p1',
      managerRole,
      'agentlang.auth/Role',
      true,
      true,
      true,
      true,
      env
    );
    await createPermission(
      'i350p2',
      managerRole,
      'agentlang.auth/UserRole',
      true,
      true,
      true,
      true,
      env
    );
    await createPermission(
      'i350p3',
      managerRole,
      'agentlang.auth/User',
      true,
      true,
      true,
      true,
      env
    );
    await createPermission(
      'i350p4',
      managerRole,
      'agentlang.auth/RolePermission',
      true,
      true,
      true,
      true,
      env
    );
    await env.commitAllTransactions();
    await callWithRbac(async () => {
      env = new Environment();
      let r: Instance[] = await parseAndEvaluateStatement(`{agentlang.auth/User? {}}`, userId, env);
      assert(r.length == 2);
      const ids = new Set().add(userId).add(tempuser);
      r.forEach((inst: Instance) => {
        assert(isInstanceOfType(inst, 'agentlang.auth/User'));
        const id = inst.lookup('id');
        assert(ids.has(id));
        ids.delete(id);
      });
      r = await parseAndEvaluateStatement(`{agentlang.auth/User? {}}`, tempuser, env);
      assert(r.length == 1);
      assert(r[0].lookup('id') == tempuser);
      r = await parseAndEvaluateStatement(`{agentlang.auth/RolePermission? {}}`, userId, env);
      const chk = () => {
        assert(r.length > 1);
        assert(
          r.every((inst: Instance) => {
            return isInstanceOfType(inst, 'agentlang.auth/RolePermission');
          })
        );
      };
      chk();
      r = await parseAndEvaluateStatement(`{agentlang.auth/RolePermission? {}}`, tempuser, env);
      assert(r.length == 0);
      r = await parseAndEvaluateStatement(`{agentlang.auth/ListRolePermissions {}}`, userId, env);
      chk();
    });
  });
});

describe('foreign-keys', () => {
  test('refs as foreign keys', async () => {
    await doInternModule(
      'fkeys',
      `entity Resource {
        id Int @id,
        resEmail Email @unique
      }

      entity User {
        id Int @id,
        email @ref(fkeys/Resource.resEmail) @optional,
        name String
      }

      entity R {
        id Int @id,
        email @ref(agentlang.auth/User.email) @optional
      }

      workflow Q1 {
        {User? {},
        @join Resource {resEmail? User.email},
        @into {email Resource.resEmail, name User.name}}
      }

      workflow Q2 {
        {User? {},
        @left_join Resource {resEmail? User.email},
        @into {email Resource.resEmail, name User.name}}
      }

      workflow UsersNotLinked {
        {User {email? null}}
      }

      workflow UsersLinked {
        {User {email? <> null}}
      }
      `
    );
    const crr = async (id: number, email: string) => {
      const r1 = await parseAndEvaluateStatement(
        `{fkeys/Resource {id ${id}, resEmail "${email}"}}`
      );
      assert(isInstanceOfType(r1, 'fkeys/Resource'));
    };
    await crr(1, 'a@acme.com');
    await crr(2, 'b@acme.com');
    const cru = async (id: number, name: string, email?: string) => {
      const u1 = await parseAndEvaluateStatement(
        email
          ? `{fkeys/User {id ${id}, name "${name}", email "${email}"}}`
          : `{fkeys/User {id ${id}, name "${name}"}}`
      );
      assert(isInstanceOfType(u1, 'fkeys/User'));
    };
    await cru(101, 'user1', 'a@acme.com');
    await cru(102, 'user2');
    await cru(103, 'user3', 'c@acme.com').catch((reason: any) => {
      assert(reason); // "FOREIGN KEY constraint failed"
    });
    await cru(104, 'user4', 'a@acme.com');
    await cru(105, 'user5', 'b@acme.com');
    const rs1 = await parseAndEvaluateStatement(`{fkeys/Q1 {}}`);
    assert(rs1.length === 3);
    rs1.forEach((entry: any) => {
      const n = entry.name;
      const e = entry.email;
      if (e === 'a@acme.com') {
        assert(n === 'user1' || n === 'user4');
      } else if (e === 'b@acme.com') {
        assert(n === 'user5');
      } else {
        assert(false);
      }
    });
    const rs2 = await parseAndEvaluateStatement(`{fkeys/Q2 {}}`);
    assert(rs2.length == 4);
    const notLinked = await parseAndEvaluateStatement(`{fkeys/UsersNotLinked {}}`);
    assert(notLinked.length == 1);
    assert(
      notLinked.every((inst: Instance) => {
        return isInstanceOfType(inst, 'fkeys/User');
      })
    );
    const linked = await parseAndEvaluateStatement(`{fkeys/UsersLinked {}}`);
    assert(linked.length == 3);
    assert(
      linked.every((inst: Instance) => {
        return isInstanceOfType(inst, 'fkeys/User');
      })
    );
    const au1 = await parseAndEvaluateStatement(
      `{agentlang.auth/User {email "kk@acme.com", firstName "Kay", lastName "K"}}`
    );
    assert(isInstanceOfType(au1, 'agentlang.auth/User'));
    const r1 = await parseAndEvaluateStatement(`{fkeys/R {id 1001, email "kk@acme.com"}}`);
    assert(isInstanceOfType(r1, 'fkeys/R'));
    const r2 = await parseAndEvaluateStatement(`{fkeys/R {id 1002, email "rk@acme.com"}}`).catch(
      (reason: any) => {
        assert(reason);
      }
    );
    assert(r2 === undefined);
  });
});

describe('VectorDB RBAC', () => {
  test('Read permissions on vector-store', async () => {
    if (process.env['AL_DB_TYPE'] === 'postgres') {
      await callWithRbac(async () => {
        const mname = 'vectrbac';
        await doInternModule(
          mname,
          `entity E {
            id Int @id,
            x String,
            @rbac [(roles: [manager], allow: [create]),
                   (roles: [guest], allow: [read])],
            @meta {"fullTextSearch": "*"}
            }`
        );
        const id1 = crypto.randomUUID();
        const id2 = crypto.randomUUID();
        const id3 = crypto.randomUUID();
        const env: Environment = new Environment();
        async function f1() {
          await createUser(id1, 'u1@acme.com', 'U', '1', env);
          await createUser(id2, 'u2@acme.com', 'U', '2', env);
          await createUser(id3, 'u3@acme.com', 'U', '3', env);
          assert(
            (await assignUserToRole(id1, 'manager', env)) == true,
            'Failed to assign manager role'
          );
          assert(
            (await assignUserToRole(id2, 'guest', env)) == true,
            'Failed to assign guest role'
          );
        }
        await env.callInTransaction(f1);
        async function cre(id: number, x: string, userId: string, expectError: boolean = false) {
          const r = await parseAndEvaluateStatement(
            `{${mname}/E {id ${id}, x "${x}"}}`,
            userId
          ).catch((reason: any) => {
            if (!expectError) {
              assert(false, `Unexpected error ${reason}`);
            }
          });
          if (!expectError) {
            assert(
              isInstanceOfType(r, `${mname}/E`),
              `Failed to create E with id ${id}, with user ${userId}`
            );
          }
        }
        await cre(1, 'hello world', id1);
        await cre(2, 'bye', id2, true);
        await cre(3, 'ok', id3, true);
        await cre(4, 'bye bye world', id1);
        async function srche(text: string, userId: string): Promise<any> {
          return await parseAndEvaluateStatement(`{${mname}/E? "${text}"}`, userId);
        }
        const s = 'world'
        const r1 = await srche(s, id1);
        assert(r1.length == 2);
        const r2 = await srche(s, id2);
        assert(r2.length == 2);
        const r3 = await srche(s, id3);
        assert(r3.length == 0);
      });
    }
  });
});
