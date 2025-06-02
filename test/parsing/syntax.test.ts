import { assert, describe, test } from "vitest";
import { BasePattern, CrudPattern, DeletePattern, ExpressionPattern, ForEachPattern, IfPattern, LiteralPattern, LiteralPatternType, ReferencePattern } from "../../src/language/syntax.js";
import { introspect } from "../../src/language/parser.js";

describe('Pattern generation using the syntax API', () => {
    test('check pattern generation', async () => {
        const crud1: CrudPattern = new CrudPattern('Acme/Employee')
        crud1.addAttribute("firstName", new ReferencePattern("CreateEmployee", "firstName"))
            .addAttribute("lastName", new ReferencePattern("CreateEmployee", "lastName"))
            .addAttribute("email", new ReferencePattern("CreateEmployee", "email"))
            .addAttribute("salary", new ExpressionPattern("CreateEmployee.salary * 0.5"))
            .setAlias("emp")
        const stmt1 = `{Acme/Employee {firstName CreateEmployee.firstName, lastName CreateEmployee.lastName, email CreateEmployee.email, salary CreateEmployee.salary * 0.5}} as emp`
        assert(crud1.toString() == stmt1, "Failed to generate employee-create pattern")
        const crud2: CrudPattern = new CrudPattern('Acme/Employee')
            .addAttribute("salary?>=", new LiteralPattern(LiteralPatternType.NUMBER, 1500))
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
            .addPattern(new LiteralPattern(LiteralPatternType.STRING, "+1000"))
            .setElseIf(new IfPattern(new ExpressionPattern("emp.salary < 500")).addPattern(new LiteralPattern(LiteralPatternType.STRING, "-500")))
            .setElseBody([new LiteralPattern(LiteralPatternType.STRING, "ok")])
        const stmt5 = `if(emp.salary > 1000) {"+1000"} else if(emp.salary < 500) {"-500"} else {"ok"}`
        assert(ifp.toString() == stmt5, "Failed to generate if-pattern")
    });
});

describe('Pattern introspection', () => {
    test('check pattern introspection', async () => {
        let pats: BasePattern[] = []
        await introspect("{Blog/User {name CreateUser.name, email CreateUser.email}}")
            .then((r: BasePattern[]) => { pats = r })
        assert(pats.length == 1, "Exactly one pattern expected")
        const bp: BasePattern = pats[0]
        assert(bp instanceof CrudPattern, "Expected a Crud pattern")
        let cp: CrudPattern = bp as CrudPattern
        assert(cp.recordName == 'Blog/User', 'Invalid record name')
        assert(cp.isCreate, "Failed to detect create pattern")
        assert(cp.toString() == '{Blog/User {name CreateUser.name, email CreateUser.email}}', "Failed to regenerate create pattern")

        await introspect('{Blog/User {email? "joe@acme.com"}} as users')
            .then((r: BasePattern[]) => { pats = r })
        cp = pats[0] as CrudPattern
        assert(cp.isQuery, "Failed to detect query pattern")
        assert(cp.alias == 'users', 'Failed to detect query alias')
        assert(cp.toString() == '{Blog/User {email? "joe@acme.com"}} as users', "Failed to regenerate query pattern")
        
        await introspect('{Blog/User {email? "joe@acme.com", name "Sam"}} as [user]')
            .then((r: BasePattern[]) => { pats = r })
        cp = pats[0] as CrudPattern
        assert(cp.isQueryUpdate, "Failed to detect query-update pattern")
        assert(cp.aliases && cp.aliases.length == 1 && cp.aliases[0] == 'user', 'Failed to parse aliases')
        assert(cp.toString() == '{Blog/User {email? "joe@acme.com", name "Sam"}} as [user]', "Failed to regenerate query-update pattern")

        await introspect('{User {name CreateUser.name}, UserProfile {Profile {email CreateUser.email}}, UserPost {Post {title "hello, world"}}}')
            .then((r: BasePattern[]) => { pats = r })
        cp = pats[0] as CrudPattern
        assert(cp.isCreate, "Failed to detect create pattern with relationships")
        assert(cp.relationships && cp.relationships.size == 2, "Failed to parse relationships")
        assert(cp.toString() == '{User {name CreateUser.name},UserProfile {Profile {email CreateUser.email}},UserPost {Post {title "hello, world"}}}',
            "Failed to regenerate create pattern with relationships")

        await introspect('delete {Blog/User {email? "joe@acme.com"}} as users')
            .then((r: BasePattern[]) => { pats = r })
        const dp: DeletePattern = pats[0] as DeletePattern
        assert(dp.alias == 'users', "Failed to detect alias for delete")
        cp = dp.pattern as CrudPattern
        assert(cp.isQuery, "Failed to detect query pattern in delete")
        assert(dp.toString() == 'delete {Blog/User {email? "joe@acme.com"}} as users', "Failed to re-generate delete pattern")

        await introspect('for user in {Blog/User {email? "joe@acme.com"}} { {Blog/Person {name user.name}} } as result')
            .then((r: BasePattern[]) => { pats = r })
        const fep: ForEachPattern = pats[0] as ForEachPattern
        assert(fep.variable == 'user', 'Failed to detect variable of for-each')
        cp = fep.source as CrudPattern
        assert(cp.isQuery, 'Failed to detect for-each source query')
        assert(fep.body.length == 1, 'Failed to parse for-each body')
        assert(fep.alias == 'result', 'Failed to detect for-each alias')
        assert(fep.toString() == 'for user in {Blog/User {email? "joe@acme.com"}}{{Blog/Person {name user.name}}} as result',
            'Failed to regenerate for-each')

        await introspect('if (1 < 2) { user.email } else { user.name }').then((r: BasePattern[]) => { pats = r })
        const ifp: IfPattern = pats[0] as IfPattern
        assert(ifp.toString() == 'if(1 < 2) {user.email} else {user.name}', 'Failed to regenerate if pattern')
    })
})