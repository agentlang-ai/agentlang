import { parseModule } from "../../src/language/parser.js"
import { assert, describe, test } from "vitest"
import { ModuleDefinition } from "../../src/language/generated/ast.js"
import { assignUserToRole, createUser } from "../../src/runtime/modules/auth.js"
import { internAndRunModule } from "../../src/cli/main.js"
import { Environment, parseAndEvaluateStatement } from "../../src/runtime/interpreter.js"
import { Instance, isInstanceOfType } from "../../src/runtime/module.js"
import { expectError } from "../util.js"
import { callWithRbac } from "../../src/runtime/auth/defs.js"

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
relationship ManagerReportee between(Employee as manager, Employee as reportee) @one_many

workflow CreateEmployee {
    {Department {no? CreateEmployee.deptNo},
     DepartmentEmployee {Employee {id CreateEmployee.id,
                                   name CreateEmployee.name}}}
}

workflow AssignManager {
    {Employee {id? AssignManager.manager}} as [m];
    {Employee {id? AssignManager.reportee}} as [r];
    {ManagerReportee {manager m, reportee r}}
}

workflow LookupEmployee {
    {Department {no? LookupEmployee.deptNo},
     DepartmentEmployee {Employee {id? LookupEmployee.id}}}
}
`

describe('Basic RBAC checks', () => {
    test('Basic RBAC tests', async () => {
        callWithRbac(async () => {
            const module: ModuleDefinition = await parseModule(mod1)
            assert(module.name == "Acme", 'failed to parse test module')
            await internAndRunModule(module)
            const id1 = crypto.randomUUID()
            const id2 = crypto.randomUUID()
            const env: Environment = new Environment()
            async function f1() {
                await createUser(id1, 'dave@acme.com', 'Dave', 'J', env)
                await createUser(id2, 'sam@acme.com', 'Sam', 'R', env)
                assert(await assignUserToRole(id1, 'manager', env) == true, 'Failed to assign manager role')
            }
            await env.callInTransaction(f1)
            let r: any = await parseAndEvaluateStatement(`{Acme/Department {no 101}}`, id1)
            assert(isInstanceOfType(r, 'Acme/Department'), 'Failed to create Department')
            let ee = expectError()
            await parseAndEvaluateStatement(`{Acme/Department {no 102}}`, id2).catch(ee.f())
            assert(ee.isFailed, 'Auth check on create-department failed')
            async function createEmployee(userId: string, deptNo: number, id: number, name: string, expectFailure: boolean = false): Promise<void> {
                ee = expectError()
                await parseAndEvaluateStatement(`{Acme/CreateEmployee {deptNo ${deptNo}, id ${id}, name "${name}"}}`, userId).then((r: any) => {
                    const dept: Instance = r[0] as Instance
                    const emps: Instance[] | undefined = dept.getRelatedInstances('DepartmentEmployee')
                    const emp: Instance | undefined = emps ? emps[0] as Instance : undefined
                    assert(isInstanceOfType(emp, 'Acme/Employee'), 'Failed to create Employee')
                }).catch((reason: any) => {
                    if (expectFailure) {
                        ee.f()(reason)
                    } else {
                        throw new Error(reason)
                    }
                })
                if (expectFailure) {
                    assert(ee.isFailed, 'CreateEmployee was supposed to fail')
                }
            }
            await createEmployee(id2, 101, 1, 'Joe', true)
            await createEmployee(id1, 101, 1, 'Joe')
            await createEmployee(id1, 101, 2, 'Cole')
            ee = expectError()
            await parseAndEvaluateStatement(`{Acme/AssignManager {manager 1, reportee 2}}`, id2).catch(ee.f())
            assert(ee.isFailed, 'User should not be allowed to assign a manager')
            r = await parseAndEvaluateStatement(`{Acme/AssignManager {manager 1, reportee 2}}`, id1)
            assert(isInstanceOfType(r, 'Acme/ManagerReportee'), 'Failed to assign reportee to manager')
            r = await parseAndEvaluateStatement(`{Acme/LookupEmployee {deptNo 101, id 1}}`, id2)
            assert(r.length == 0, 'User not allowed to lookup employees in department 101')
            r = await parseAndEvaluateStatement(`{Acme/LookupEmployee {deptNo 101, id 1}}`, id1)
            const dept = r[0] as Instance
            assert(isInstanceOfType(dept, 'Acme/Department'), 'failed to lookup parent department')
            if (dept.relatedInstances) {
                const emps: Instance[] | undefined = dept.relatedInstances.get('DepartmentEmployee')
                assert(emps && emps.length == 1, 'Failed to lookup department-employees')
                assert(emps[0].get('name') == 'Joe', 'Failed to lookup Joe in department 101')
            }
        })
    })
})