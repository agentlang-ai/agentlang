import { parseModule } from "../../src/language/parser.js"
import { assert, describe, test } from "vitest"
import { Module } from "../../src/language/generated/ast.js"
import { assignUserToRole, createUser } from "../../src/runtime/modules/auth.js"
import { internAndRunModule } from "../../src/cli/main.js"
import { Environment, parseAndEvaluateStatement } from "../../src/runtime/interpreter.js"
import { Instance, isInstanceOfType } from "../../src/runtime/module.js"
import { logger } from "../../src/runtime/logger.js"

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
relationship ManagerReportee between(Employee as manager, Employee as reportee)

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
`
describe('Basic RBAC checks', () => {
    test('Basic RBAC tests', async () => {
        let module: Module | undefined
        await parseModule(mod1).then((r: Module) => {
            assert(r.name == "Acme", 'failed to parse test module')
            module = r
        })
        if (module) {
            await internAndRunModule(module)
            const id1 = crypto.randomUUID()
            const id2 = crypto.randomUUID()
            const env: Environment = new Environment()
            async function f1() {
                await createUser(id1, 'dave@acme.com', 'Dave', 'J', env)
                await createUser(id2, 'sam@acme.com', 'Sam', 'R', env)
                await assignUserToRole(id1, 'manager', env).then((r: boolean) => {
                    assert(r == true, 'Failed to assign manager role')
                })
            }
            await env.callInTransaction(f1)
            await parseAndEvaluateStatement(`{Acme/Department {no 101}}`, id1).then((r: any) => {
                assert(isInstanceOfType(r, 'Acme/Department'), 'Failed to create Department')
            })
            let failed = false
            await parseAndEvaluateStatement(`{Acme/Department {no 102}}`, id2)
                .catch((r: any) => {
                    logger.info(`Expected ${r}`)
                    failed = true
                })
            assert(failed, 'Auth check on create-department failed')
            async function createEmployee(userId: string, deptNo: number, id: number, name: string, expectFailure: boolean = false): Promise<void> {
                let err: boolean = false
                await parseAndEvaluateStatement(`{Acme/CreateEmployee {deptNo ${deptNo}, id ${id}, name "${name}"}}`, userId).then((r: any) => {
                    const dept: Instance = r[0] as Instance
                    const emps: Instance[] | undefined = dept.getRelatedInstances('DepartmentEmployee')
                    const emp: Instance | undefined = emps ? emps[0] as Instance : undefined
                    assert(isInstanceOfType(emp, 'Acme/Employee'), 'Failed to create Employee')
                }).catch((reason: any) => {
                    if (expectFailure) {
                        err = true
                        logger.info(`Expected ${reason}`)
                    } else {
                        throw new Error(reason)
                    }
                })
                if (expectFailure) {
                    assert(err, 'CreateEmployee was suppoed to fail')
                }
            }
            await createEmployee(id2, 101, 1, 'Joe', true)
            await createEmployee(id1, 101, 1, 'Joe')
            await createEmployee(id1, 101, 2, 'Cole')
            await parseAndEvaluateStatement(`{Acme/AssignManager {manager 1, reportee 2}}`)
            .then((r: any) => {
                console.log(r)
            })
        }
    })
})