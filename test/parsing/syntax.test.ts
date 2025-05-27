import { assert, describe, test } from "vitest";
import { CrudPattern, ExpressionPattern, ForEachPattern, IfPattern, LiteralPattern, ReferencePattern } from "../../src/language/syntax.js";

describe('Pattern generation using the syntax API', () => {
    test('check pattern generation', async () => {
        const crud1: CrudPattern = new CrudPattern('Acme/Employee')
        crud1.addAttribute("firstName", new ReferencePattern("CreateEmployee", "firstName"))
            .addAttribute("lastName", new ReferencePattern("CreateEmployee", "lastName"))
            .addAttribute("email", new ReferencePattern("CreateEmployee", "email"))
            .addAttribute("salary", new ExpressionPattern("CreateEmployee.salary * 0.5"))
            .setAlias("emp")
        const stmt1 = `{Acme/Employee {firstName CreateEmployee.firstName,lastName CreateEmployee.lastName,email CreateEmployee.email,salary CreateEmployee.salary * 0.5}} as emp`
        assert(crud1.toString() == stmt1, "Failed to generate employee-create pattern")
        const crud2: CrudPattern = new CrudPattern('Acme/Employee')
            .addAttribute("salary?>=", new LiteralPattern(1500))
            .setAlias("employees")
        const stmt2 = "{Acme/Employee {salary?>= 1500}} as employees"
        assert(crud2.toString() == stmt2, "Failed to generate employee query pattern")
        const crud3: CrudPattern = new CrudPattern('Blog/User')
            .addAttribute("name", new ReferencePattern("CreateUser", "name"))
            .addRelationship("UserProfile", new CrudPattern('Profile')
                .addAttribute("email", new ReferencePattern("CreateUser", "email")))
        const stmt3 = "{Blog/User {name CreateUser.name},UserProfile {Profile {email CreateUser.email}}}"
        assert(crud3.toString() == stmt3, "Failed to generate relationship pattern")
        const fe: ForEachPattern = new ForEachPattern("emp", crud2.unsetAlias())
        fe.addPattern(new CrudPattern("Acme/Manager")
            .addAttribute("employeeEmail", new ReferencePattern("emp", "email")))
            .setAlias("managers")
        const stmt4 = "for emp in {Acme/Employee {salary?>= 1500}}{{Acme/Manager {employeeEmail emp.email}}} as managers"
        assert(fe.toString() == stmt4, "Failed to generate for-each")
        const ifp: IfPattern = new IfPattern(new ExpressionPattern("emp.salary > 1000"))
            .addPattern(new LiteralPattern("+1000"))
            .setElseIf(new IfPattern(new ExpressionPattern("emp.salary < 500")).addPattern(new LiteralPattern("-500")))
            .setElseBody([new LiteralPattern("ok")])
        const stmt5 = `if(emp.salary > 1000) {"+1000"} else if(emp.salary < 500) {"-500"} else {"ok"}`
        assert(ifp.toString() == stmt5, "Failed to generate if-pattern")
    });
});