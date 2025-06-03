import { parseModule } from "../../src/language/parser.js"
import { assert, describe, test } from "vitest"
import { Module } from "../../src/language/generated/ast.js"
import { assignUserToRole } from "../../src/runtime/modules/auth.js"
import { internAndRunModule } from "../../src/cli/main.js"
import { Environment } from "../../src/runtime/interpreter.js"

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
            const env: Environment = new Environment()
            await assignUserToRole('M0001', 'manager', env).then((r: boolean) => {
                assert(r == true, 'Failed to assign manager role')
            })
        }
    })
})