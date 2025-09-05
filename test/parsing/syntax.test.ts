import { assert, describe, test } from 'vitest';
import {
  BasePattern,
  CrudPattern,
  DeletePattern,
  ExpressionPattern,
  ForEachPattern,
  IfPattern,
  isCreatePattern,
  isQueryPattern,
  isQueryUpdatePattern,
  LiteralPattern,
  ReferencePattern,
} from '../../src/language/syntax.js';
import { introspect } from '../../src/language/parser.js';
import { doInternModule } from '../util.js';
import { addBeforeDeleteWorkflow, fetchModule, isModule, removeModule } from '../../src/runtime/module.js';
import { parseAndIntern } from '../../src/runtime/loader.js';

describe('Pattern generation using the syntax API', () => {
  test('test01', async () => {
    const crud0: CrudPattern = new CrudPattern('User?');
    assert(crud0.toString() == '{User? {}}')
    assert(isQueryPattern(crud0))
    crud0.addAttribute('email', LiteralPattern.String("joe@acme.com"))
    assert(crud0.toString() == '{User {email "joe@acme.com"}}')
    assert(isCreatePattern(crud0))
    crud0.addAttribute('age?', LiteralPattern.Number(18), '>')
    assert(crud0.toString() == '{User {email "joe@acme.com", age?> 18}}')
    assert(isQueryUpdatePattern(crud0))
    const crud1: CrudPattern = new CrudPattern('Acme/Employee');
    crud1
      .addAttribute('firstName', new ReferencePattern('CreateEmployee', 'firstName'))
      .addAttribute('lastName', new ReferencePattern('CreateEmployee', 'lastName'))
      .addAttribute('email', new ReferencePattern('CreateEmployee', 'email'))
      .addAttribute('salary', new ExpressionPattern('CreateEmployee.salary * 0.5'))
      .setAlias('emp');
    const stmt1 = `{Acme/Employee {firstName CreateEmployee.firstName, lastName CreateEmployee.lastName, email CreateEmployee.email, salary CreateEmployee.salary * 0.5}} @as emp`;
    assert(crud1.toString() == stmt1, 'Failed to generate employee-create pattern');
    const crud2: CrudPattern = new CrudPattern('Acme/Employee')
      .addAttribute('salary?>=', LiteralPattern.Number(1500))
      .setAlias('employees');
    const stmt2 = '{Acme/Employee {salary?>= 1500}} @as employees';
    assert(crud2.toString() == stmt2, 'Failed to generate employee query pattern');
    const crud3: CrudPattern = new CrudPattern('Blog/User')
      .addAttribute('name', new ReferencePattern('CreateUser', 'name'))
      .addRelationship(
        'UserProfile',
        new CrudPattern('Profile').addAttribute(
          'email',
          new ReferencePattern('CreateUser', 'email')
        )
      );
    const crud4 = new CrudPattern('Erp/User')
    const age1 = LiteralPattern.Number(20)
    const age2 = LiteralPattern.Number(40)
    crud4.addAttribute('age?', LiteralPattern.Array([age1, age2]), 'between')
      .addAttribute('status', LiteralPattern.String('ok'))
    assert(crud4.toString() == '{Erp/User {age?between [20, 40], status "ok"}}', 'Failed to generate query-update')
    const stmt3 =
      '{Blog/User {name CreateUser.name},UserProfile {Profile {email CreateUser.email}}}';
    assert(crud3.toString() == stmt3, 'Failed to generate relationship pattern');
    const fe: ForEachPattern = new ForEachPattern('emp', crud2.unsetAlias());
    fe.addPattern(
      new CrudPattern('Acme/Manager').addAttribute(
        'employeeEmail',
        new ReferencePattern('emp', 'email')
      )
    ).setAlias('managers');
    const stmt4 =
      'for emp in {Acme/Employee {salary?>= 1500}}{{Acme/Manager {employeeEmail emp.email}}} @as managers';
    assert(fe.toString() == stmt4, 'Failed to generate for-each');
    const emptyfe = new ForEachPattern()
    assert(emptyfe.toString() == 'for X in []{}', 'Failed to generate empty for-each')
    const ifp: IfPattern = new IfPattern(new ExpressionPattern('emp.salary > 1000'))
      .addPattern(LiteralPattern.String('+1000'))
      .setElse(
        [new IfPattern(new ExpressionPattern('emp.salary < 500')).addPattern(
          LiteralPattern.String('-500')
        ).setElse([LiteralPattern.String('ok')])]
      )
    const stmt5 = `if(emp.salary > 1000) {"+1000"} else if(emp.salary < 500) {"-500"} else {"ok"}`;
    assert(ifp.toString() == stmt5, 'Failed to generate if pattern');
    const qp: CrudPattern = new CrudPattern('Blog/User');
    qp.addAttribute('salary?', LiteralPattern.Number(1500), '>');
    const dfp: DeletePattern = new DeletePattern(qp);
    assert(
      dfp.toString() == 'delete {Blog/User {salary?> 1500}}',
      'Failed to generate delete pattern'
    );
    const emptyCrud: CrudPattern = new CrudPattern('Blog/Post');
    assert(emptyCrud.toString() == '{Blog/Post {}}', 'Failed to generate empty CRUD pattern');
    const emptyDfp: DeletePattern = new DeletePattern(emptyCrud);
    assert(
      emptyDfp.toString() == 'delete {Blog/Post {}}',
      'Failed to generate empty delete pattern'
    );
  });
});

describe('Pattern introspection', () => {
  test('test01', async () => {
    let pats: BasePattern[] = await introspect(
      '{Blog/User {name CreateUser.name, email CreateUser.email}}'
    );
    assert(pats.length == 1, 'Exactly one pattern expected');
    const bp: BasePattern = pats[0];
    assert(bp instanceof CrudPattern, 'Expected a Crud pattern');
    let cp: CrudPattern = bp as CrudPattern;
    assert(cp.recordName == 'Blog/User', 'Invalid record name');
    assert(cp.isCreate, 'Failed to detect create pattern');
    assert(
      cp.toString() == '{Blog/User {name CreateUser.name, email CreateUser.email}}',
      'Failed to regenerate create pattern'
    );

    pats = await introspect('{Blog/User {}}');
    assert(isCreatePattern(pats[0]), 'Failed to detect empty create pattern');
    pats = await introspect('{Blog/User? {}}');
    assert(isQueryPattern(pats[0]), 'Failed to detect empty query-all pattern');

    pats = await introspect('{Blog/User {email? "joe@acme.com"}} @as users');
    cp = pats[0] as CrudPattern;
    assert(cp.isQuery, 'Failed to detect query pattern');
    assert(cp.alias == 'users', 'Failed to detect query alias');
    assert(
      cp.toString() == '{Blog/User {email? "joe@acme.com"}} @as users',
      'Failed to regenerate query pattern'
    );

    pats = await introspect('{Blog/User {email? "joe@acme.com", name "Sam"}} @as [user]');
    cp = pats[0] as CrudPattern;
    assert(cp.isQueryUpdate, 'Failed to detect query-update pattern');
    assert(
      cp.aliases && cp.aliases.length == 1 && cp.aliases[0] == 'user',
      'Failed to parse aliases'
    );
    assert(
      cp.toString() == '{Blog/User {email? "joe@acme.com", name "Sam"}} @as [user]',
      'Failed to regenerate query-update pattern'
    );

    pats = await introspect(
      '{User {name CreateUser.name}, UserProfile {Profile {email CreateUser.email}}, UserPost {Post {title "hello, world"}}}'
    );
    cp = pats[0] as CrudPattern;
    assert(cp.isCreate, 'Failed to detect create pattern with relationships');
    assert(cp.relationships && cp.relationships.size == 2, 'Failed to parse relationships');
    assert(
      cp.toString() ==
      '{User {name CreateUser.name},UserProfile {Profile {email CreateUser.email}},UserPost {Post {title "hello, world"}}}',
      'Failed to regenerate create pattern with relationships'
    );

    pats = await introspect('delete {Blog/User {email? "joe@acme.com"}} @as users');
    const dp: DeletePattern = pats[0] as DeletePattern;
    assert(dp.alias == 'users', 'Failed to detect alias for delete');
    cp = dp.pattern as CrudPattern;
    assert(cp.isQuery, 'Failed to detect query pattern in delete');
    assert(
      dp.toString() == 'delete {Blog/User {email? "joe@acme.com"}} @as users',
      'Failed to re-generate delete pattern'
    );

    pats = await introspect(
      'for user in {Blog/User {email? "joe@acme.com"}} { {Blog/Person {name user.name}} } @as result'
    );
    const fep: ForEachPattern = pats[0] as ForEachPattern;
    assert(fep.variable == 'user', 'Failed to detect variable of for-each');
    cp = fep.source as CrudPattern;
    assert(cp.isQuery, 'Failed to detect for-each source query');
    assert(fep.body.length == 1, 'Failed to parse for-each body');
    assert(fep.alias == 'result', 'Failed to detect for-each alias');
    assert(
      fep.toString() ==
      'for user in {Blog/User {email? "joe@acme.com"}}{{Blog/Person {name user.name}}} @as result',
      'Failed to regenerate for-each'
    );

    pats = await introspect('if (1 < 2) { user.email } else { user.name }');
    const ifp: IfPattern = pats[0] as IfPattern;
    assert(
      ifp.toString() == 'if(1 < 2) {user.email} else {user.name}',
      'Failed to regenerate if pattern'
    );

    pats = await introspect('{User {Age? > 18 Status 3}}');
    let qup: CrudPattern = pats[0] as CrudPattern
    assert(qup.isQueryUpdate, "Failed to detect query-update pattern")
    assert(qup.toString() == '{User {Age?> 18, Status 3}}', 'Failed to regenereate query-update pattern')

    pats = await introspect('{User {Age?between [10, 20] Status 3}}');
    qup = pats[0] as CrudPattern
    assert(qup.isQueryUpdate, "Failed to detect query-update pattern")
    assert(qup.toString() == '{User {Age?between [10, 20], Status 3}}', 'Failed to regenereate query-update pattern')

    pats = await introspect('{User {Name?like "Th%" Status 3}}');
    qup = pats[0] as CrudPattern
    assert(qup.isQueryUpdate, "Failed to detect query-update pattern")
    assert(qup.toString() == '{User {Name?like "Th%", Status 3}}', 'Failed to regenereate query-update pattern')

    const emptyIf = new IfPattern()
    assert(emptyIf.toString() == 'if(true) {}')
    const emptyIfWithElse = new IfPattern().setElse()
    assert(emptyIfWithElse.toString() == 'if(true) {} else {}')

    const subArray = LiteralPattern.Array([LiteralPattern.Id("a"), LiteralPattern.Reference("a.b")])
    const arrayPat = LiteralPattern.Array([LiteralPattern.Number(100), LiteralPattern.String("hi"), subArray])
    assert(arrayPat.toString() == '[100, "hi", [a, a.b]]')

    const mapPat = LiteralPattern.Map(new Map()
      .set({str: 'a'}, LiteralPattern.Number(1))
      .set({str: 'b'}, arrayPat))
    assert(mapPat.toString() == '{"a": 1, "b": [100, "hi", [a, a.b]]}')

    const e1 = await ExpressionPattern.Validated('(x < 4)')
    assert(e1.toString() == '(x < 4)')
    const e2 = await ExpressionPattern.Validated('((X - 2) + (2 / 5)) = 1')
    assert(e2.toString() == '((X - 2) + (2 / 5)) = 1')
    let exprErr = false
    await ExpressionPattern.Validated('(X > 5').catch(() => exprErr = true)
    assert(exprErr, 'Failed to validate expression')
    const e3 = await ExpressionPattern.Validated('(X < 5 and (y = 10 or y < 3))')
    assert(e3.toString() == '(X < 5 and (y = 10 or y < 3))')
    const e4 = await ExpressionPattern.Validated('(X + 6) or (Y > 5)')
    assert(e4.toString() == '(X + 6) or (Y > 5)')
    const e5 = await ExpressionPattern.Validated('((X + 6) or (Y > 5))')
    assert(e5.toString() == '((X + 6) or (Y > 5))')
  });
});

describe('Relationship and `into` introspection', () => {
  test('test01', async () => {
    let pats = await introspect(`{Allocation? {},
    ResourceAllocation {Resource? {},
       TeamResource {Team {Id? GetTeamAllocations.TeamId}}},
    @into {Id Allocation.Id,
         Project Allocation.Project,
         ProjectName Allocation.ProjectName,
         Resource Allocation.Resource,
         ResourceName Resource.FullName,
         Manager Resource.Manager,
         Period Allocation.Period,
         Duration Allocation.Duration,
         AllocationEntered Allocation.AllocationEntered,
         ActualsEntered Allocation.ActualsEntered,
         Notes Allocation.Notes}}`)
    let p = pats[0] as CrudPattern
    assert(p.isQuery)
    assert(!p.isCreate)
    assert(!p.isQueryUpdate)
    assert(p.into != undefined)
    assert(p.into.get('Project') == 'Allocation.Project')
    assert(p.into.get('AllocationEntered') == 'Allocation.AllocationEntered')
    assert(p.into.get('Duration') == 'Allocation.Duration')
    p.removeInto('Duration')
    const s = p.toString();
    assert(s == `{Allocation? {},ResourceAllocation {Resource? {},TeamResource {Team {Id? GetTeamAllocations.TeamId}}},@into { Id Allocation.Id,
Project Allocation.Project,
ProjectName Allocation.ProjectName,
Resource Allocation.Resource,
ResourceName Resource.FullName,
Manager Resource.Manager,
Period Allocation.Period,
AllocationEntered Allocation.AllocationEntered,
ActualsEntered Allocation.ActualsEntered,
Notes Allocation.Notes }}`)
    pats = await introspect(s)
    assert(p.into != undefined)
    assert(p.into.get('Project') == 'Allocation.Project')
    assert(p.into.get('AllocationEntered') == 'Allocation.AllocationEntered')
    assert(p.into.get('Duration') == undefined)
    pats = await introspect(` {Resource {id? CreateAllocation.id},
    ResAlloc {Allocation {name CreateAllocation.name}}}`)
    p = pats[0] as CrudPattern
    assert(!p.isCreate)
    assert(p.isQuery)
    assert(!p.isQueryUpdate)
    const rp = p.relationships?.get('ResAlloc')
    assert(rp)
    if (rp instanceof Array) {
      p = rp[0] as CrudPattern
    } else {
      p = rp as CrudPattern
    }
    assert(p.isCreate)
    assert(!p.isQuery)
    assert(!p.isQueryUpdate)
  })
})

describe('Pre/Post workflow syntax', () => {
  test('test01', async () => {
    const mname = 'WfSyntaxGen'
    await doInternModule(mname,
      `
      entity incident {
        id Int @id,
        description String,
        created DateTime @default(now())
      }
      workflow @after create:incident {
        {orchestratorAgent {message this}}
      }
      workflow onIncident {
        {orchestratorAgent {message onIncident.incident}}
      }`
    )

    const mod = fetchModule(mname)
    const s = mod.toString()
    assert(s == `module WfSyntaxGen

entity incident
{
    id Int @id,
    description String,
    created DateTime @default(now())
}


workflow @after create:WfSyntaxGen/incident {
    {orchestratorAgent {message this}}
}

workflow onIncident {
    {orchestratorAgent {message onIncident.incident}}
}`)
    removeModule(mname)
    assert(!isModule(mname))
    await parseAndIntern(s)
    assert(isModule(mname))
    assert(s == fetchModule(mname).toString())
    const wf = addBeforeDeleteWorkflow('incident', mname)
    await wf.addStatement('{abc/incidentAdded {id this.id}}')
    const ss = fetchModule(mname).toString()
    assert(ss == `module WfSyntaxGen

entity incident
{
    id Int @id,
    description String,
    created DateTime @default(now())
}


workflow @after create:WfSyntaxGen/incident {
    {orchestratorAgent {message this}}
}

workflow onIncident {
    {orchestratorAgent {message onIncident.incident}}
}

workflow @before delete:WfSyntaxGen/incident {
    {abc/incidentAdded {id this.id}}
}`)
  })
})

describe('Flow syntax', () => {
  test('test01', async () => {
    const mname = 'FlowSyntax'
    await doInternModule(mname,
      `
      entity manager {
        id String @id,
        category @enum("DNS", "WLAN")
      }
      entity managerSlackChannel {
        managerId String @id,
        channel String
      }
      
      agent incidentTriager {
        llm "ticketflow_llm",
        instruction "Based on the description of the incident (in context), return one of - DNS, WLAN or Other.
Only return one of the strings [DNS, WLAN, Other] and nothing else."
      }

    agent managerRequestHandler {
        channels [slack],
        instruction "Create an approval request from the incident and send it over the slack-channel. Details of the incident
and the slack channel id will be available in the context passed to you. For example, if the context contains an incident related to
WLAN provisioning and the slack channel id CC774882, then send the approvale request as: 
{slack/sendMessageOnChannel {channel &quote;CC774882&quote;, message &quote;Request to provision WLAN&quote;}}.
Try to include as much information about the provisioning request in the message as possible."
    }

    agent incidentProvisioner {
        tools [ticketflow.core/handleDnsProvisioning,
	             ticketflow.core/handleWlanProvisioning],
        instruction "If the incident triage category is DNS, do DNS provisioning. Otherwise do WLAN provisioning.
The incident data and triage category will be available in the context. The relevant DNS or WLAN name will be available
in the incident's description."
    }
  
    flow orchestrator {
        incidentTriager --> "DNS" findManagerForCategory
        incidentTriager --> "WLAN" findManagerForCategory
        incidentTriager --> "Other" incidentStatusUpdater
        findManagerForCategory --> managerRequestHandler
        managerRequestHandler --> "approve" incidentProvisioner
        managerRequestHandler --> "reject" incidentStatusUpdater
        incidentProvisioner --> incidentStatusUpdater
    }

    agent orchestratorAgent {
        llm "ticketflow_llm",
        role "You are an incident manager.",
        flows [orchestrator]
    }

    {manager {id "01", category "DNS"}}
    {manager {id "02", category "WLAN"}}
    {managerSlackChannel {managerId "01", channel "C09C00XJ3GC"}}
    {managerSlackChannel {managerId "02", channel "C09BRHX9B7D"}}`
    )

    const mod = fetchModule(mname)
    const s = mod.toString()
    assert(s == `module FlowSyntax

entity manager
{
    id String @id,
    category  @enum("DNS","WLAN")
}

entity managerSlackChannel
{
    managerId String @id,
    channel String
}

agent incidentTriager
{
    llm "ticketflow_llm",
    instruction "Based on the description of the incident (in context), return one of - DNS, WLAN or Other.
Only return one of the strings [DNS, WLAN, Other] and nothing else."
}
agent managerRequestHandler
{
    channels "slack",
    instruction "Create an approval request from the incident and send it over the slack-channel. Details of the incident
and the slack channel id will be available in the context passed to you. For example, if the context contains an incident related to
WLAN provisioning and the slack channel id CC774882, then send the approvale request as: 
{slack/sendMessageOnChannel {channel &quote;CC774882&quote;, message &quote;Request to provision WLAN&quote;}}.
Try to include as much information about the provisioning request in the message as possible."
}
agent incidentProvisioner
{
    tools "ticketflow.core/handleDnsProvisioning,ticketflow.core/handleWlanProvisioning",
    instruction "If the incident triage category is DNS, do DNS provisioning. Otherwise do WLAN provisioning.
The incident data and triage category will be available in the context. The relevant DNS or WLAN name will be available
in the incident's description."
}
flow orchestrator {
      incidentTriager --> "DNS" findManagerForCategory
incidentTriager --> "WLAN" findManagerForCategory
incidentTriager --> "Other" incidentStatusUpdater
findManagerForCategory --> managerRequestHandler
managerRequestHandler --> "approve" incidentProvisioner
managerRequestHandler --> "reject" incidentStatusUpdater
incidentProvisioner --> incidentStatusUpdater
    }
agent orchestratorAgent
{
    llm "ticketflow_llm",
    role "You are an incident manager.",
    flows [orchestrator]
}
{manager {id "01", category "DNS"}}
{manager {id "02", category "WLAN"}}
{managerSlackChannel {managerId "01", channel "C09C00XJ3GC"}}
{managerSlackChannel {managerId "02", channel "C09BRHX9B7D"}}`)
  })
})