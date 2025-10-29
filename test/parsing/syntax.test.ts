import { assert, describe, test } from 'vitest';
import {
  BasePattern,
  CasePattern,
  CrudPattern,
  DeletePattern,
  ExpressionPattern,
  ForEachPattern,
  IfPattern,
  isCreatePattern,
  isExpressionPattern,
  isLiteralPattern,
  isQueryPattern,
  isQueryUpdatePattern,
  LiteralPattern,
  ReferencePattern,
} from '../../src/language/syntax.js';
import { introspect, introspectCase } from '../../src/language/parser.js';
import { doInternModule } from '../util.js';
import { addBeforeDeleteWorkflow, Decision, Directive, fetchModule, flowGraphNext, isModule, Record, removeModule, Scenario } from '../../src/runtime/module.js';
import { parseAndIntern } from '../../src/runtime/loader.js';
import { AgentCondition, newAgentDirective, newAgentDirectiveFromIf, newAgentGlossaryEntry, newAgentScenarioFromIf } from '../../src/runtime/agents/common.js';

describe('Pattern generation using the syntax API', () => {
  test('test01', async () => {
    const crud0: CrudPattern = new CrudPattern('User?');
    assert(crud0.toString() == '{User? {}}')
    assert(isQueryPattern(crud0))
    assert(!isCreatePattern(crud0))
    assert(!isQueryUpdatePattern(crud0))
    crud0.addAttribute('email', LiteralPattern.String("joe@acme.com"))
    assert(crud0.toString() == '{User {email "joe@acme.com"}}')
    assert(isCreatePattern(crud0))
    assert(!isQueryPattern(crud0))
    assert(!isQueryUpdatePattern(crud0))
    crud0.addAttribute('age?', LiteralPattern.Number(18), '>')
    assert(crud0.toString() == '{User {email "joe@acme.com", age?> 18}}')
    assert(isQueryUpdatePattern(crud0))
    assert(!isQueryPattern(crud0))
    assert(!isCreatePattern(crud0))
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
    assert(!cp.isCreate)
    assert(!cp.isQuery)
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
      .set({ str: 'a' }, LiteralPattern.Number(1))
      .set({ str: 'b' }, arrayPat))
    assert(mapPat.toString() == '{"a": 1, "b": [100, "hi", [a, a.b]]}')

    const e1 = await ExpressionPattern.Validated('(x < 4)')
    assert(e1.toString() == '(x < 4)')
    const e2 = await ExpressionPattern.Validated('((X - 2) + (2 / 5)) == 1')
    assert(e2.toString() == '((X - 2) + (2 / 5)) == 1')
    let exprErr = false
    await ExpressionPattern.Validated('(X > 5').catch(() => exprErr = true)
    assert(exprErr, 'Failed to validate expression')
    const e3 = await ExpressionPattern.Validated('(X < 5 and (y == 10 or y < 3))')
    assert(e3.toString() == '(X < 5 and (y == 10 or y < 3))')
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
    assert(p.into !== undefined)
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
    assert(p.into !== undefined)
    assert(p.into.get('Project') == 'Allocation.Project')
    assert(p.into.get('AllocationEntered') == 'Allocation.AllocationEntered')
    assert(p.into.get('Duration') === undefined)
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
      @public event onIncident {
          incident Any
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
@public event onIncident
{
    incident Any
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
@public event onIncident
{
    incident Any
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

    @public agent orchestratorAgent {
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
    const flow = mod.getFlow('orchestrator')
    const fg = flow?.toGraph()
    assert(fg)
    const n0 = flowGraphNext(fg)
    assert(n0?.label == 'incidentTriager')
    const n1 = flowGraphNext(fg, n0, 'WLAN')
    assert(n1?.label == 'findManagerForCategory')
    const n2 = flowGraphNext(fg, n0, 'Other')
    assert(n2?.label == 'incidentStatusUpdater')
    const n3 = flowGraphNext(fg, n2)
    assert(n3 === undefined)
    const n4 = flowGraphNext(fg, n1)
    assert(n4?.label == 'managerRequestHandler')
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
@public agent orchestratorAgent
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

describe('Extra agent attributes', () => {
  test('Extra attributes like directives should be emitted', async () => {
    const mname = 'XtraAgentAttrs'
    await doInternModule(mname,
      `record emp {
        id Int,
        name String
      }
       agent xaaAgent
          {instruction "Create appropriate patterns for managing Employee information",
           tools "GA",
           scenarios  [{"user": "Jake hit a jackpot!", "ai": "[{GA/Employee {name? &quote;Jake&quote;}} @as [employee]; {GA/Employee {id? employee.id, salary employee.salary + employee.salary * .5}}]"}],
           glossary [{"name": "jackpot", "meaning": "sales of 5000 or above", "synonyms": "high sales, block-buster"}]}
         workflow chat {{xaaAgent {message chat.msg}}}`)
    const m = fetchModule(mname)
    const agent = m.getAgent('xaaAgent')
    const conds = new Array<AgentCondition>()
    conds.push({
      if: "Employee sales exceeded 5000",
      then: "Give a salary hike of 5 percent",
      internal: true, ifPattern: undefined
    })
    conds.push({
      if: "sales is more than 2000 but less than 5000",
      then: "hike salary by 2 percent",
      internal: true, ifPattern: undefined
    })
    agent?.setDirectives(conds)
    const scns = agent?.getScenarios()
    scns?.push({
      user: "hello", ai: "unknown request", internal: true, ifPattern: undefined
    })
    agent?.setResponseSchema('acme/response')
    agent?.getGlossary()?.push({
      name: "hit",
      meaning: "sales above 400",
      synonyms: "block-buster",
      internal: true
    })
    const s = m.toString();
    assert(s == `module XtraAgentAttrs

record emp
{
    id Int,
    name String
}

agent xaaAgent
{
    instruction "Create appropriate patterns for managing Employee information",
    tools "GA",
    directives [{"if":"Employee sales exceeded 5000","then":"Give a salary hike of 5 percent"},{"if":"sales is more than 2000 but less than 5000","then":"hike salary by 2 percent"}],
    scenarios [{"user":"Jake hit a jackpot!","ai":"[{GA/Employee {name? &quote;Jake&quote;}} @as [employee]; {GA/Employee {id? employee.id, salary employee.salary + employee.salary * .5}}]"},{"user":"hello","ai":"unknown request"}],
    glossary [{"name":"jackpot","meaning":"sales of 5000 or above","synonyms":"high sales, block-buster"},{"name":"hit","meaning":"sales above 400","synonyms":"block-buster"}],
   responseSchema acme/response
}

workflow chat {
    {xaaAgent {message chat.msg}}
}`)
    const i = s.indexOf('record')
    await doInternModule(`${mname}2`, s.substring(i))
    assert(fetchModule(`${mname}2`))
  })
})

describe('toString with extends', () => {
  test('toString should not emit parent attributes', async () => {
    await doInternModule(`ExtendsToS`,
      `record A {
        id Int,
        name String
      }
      entity B extends A {
        email Email
      }`)
    const m = fetchModule('ExtendsToS')
    const s = m.toString()
    assert(s == `module ExtendsToS

record A
{
    id Int,
    name String
}

entity B extends A
{
    email Email
}
`)
    const es = (m.getEntry('B') as Record).toString_(true)
    assert(es == `entity B
{
    id Int,
    name String,
    email Email
}
`)
  })
})

describe('agent-xtras-to-string', () => {
  test('standalone scenarios, directives', async () => {
    const mname = 'StdAloneAgentXtras'
    await doInternModule(mname,
      `workflow scenario01 {
             {GA/Employee {name? "Jake"}} @as [employee];
             {GA/Employee {id? employee.id, salary employee.salary + employee.salary * 0.5}}
         }
         agent ga
          {instruction "Create appropriate patterns for managing Employee information",
           tools "GA",
           directives [{"if": "Employee sales exceeded 5000", "then": "Give a salary hike of 5 percent"},
                       {"if": "sales is more than 2000 but less than 5000", "then": "hike salary by 2 percent"}],
           scenarios  [{"user": "Jake hit a jackpot!", "ai": "GuidedAgent/scenario01"}],
           glossary [{"name": "jackpot", "meaning": "sales of 5000 or above", "synonyms": "high sales, block-buster"}]}
         scenario ga.scn01 { if ("Kiran had a block-buster") { GuidedAgent/scenario01 } }
         directive GuidedAgent/ga.dir01 { if ("sales is less than 2000") { "hike salary by 0.5 percent"} }
         glossaryEntry ga.ge {meaning "low-sales", name "down", synonyms "bad"}
         workflow chat {{ga {message chat.msg}}}`
    )
    const m = fetchModule(mname)
    m.addDirective('ga.dir02', newAgentDirective("sales equals 500", "no hike"))
    const cond1 = new IfPattern(LiteralPattern.String("Sam hits jackpot"))
      .addPattern(LiteralPattern.Id("GuidedAgent/scenario01"))
    m.addScenario('ga.scn02', newAgentScenarioFromIf(cond1))
    m.addGlossaryEntry('ga.ge02', newAgentGlossaryEntry("up", "high-sales", "ok"))
    const s = m.toString()
    assert(s ===
      `module StdAloneAgentXtras


workflow scenario01 {
    {GA/Employee {name? "Jake"}} @as [employee];
    {GA/Employee {id? employee.id, salary employee.salary + employee.salary * 0.5}}
}
agent ga
{
    instruction "Create appropriate patterns for managing Employee information",
    tools "GA",
    directives [{"if":"Employee sales exceeded 5000","then":"Give a salary hike of 5 percent"},{"if":"sales is more than 2000 but less than 5000","then":"hike salary by 2 percent"}],
    scenarios [{"user":"Jake hit a jackpot!","ai":"GuidedAgent/scenario01"}],
    glossary [{"name":"jackpot","meaning":"sales of 5000 or above","synonyms":"high sales, block-buster"}]
}
scenario ga.scn01 {
    if("Kiran had a block-buster") {GuidedAgent/scenario01}
}

directive GuidedAgent/ga.dir01 {
        if ("sales is less than 2000") { "hike salary by 0.5 percent"}
      }
glossaryEntry ga.ge 
{
    name "down",
    meaning "low-sales",
    synonyms "bad"
}

workflow chat {
    {ga {message chat.msg}}
}
directive ga.dir02 {"if":"sales equals 500","then":"no hike"}
scenario ga.scn02 {
    if("Sam hits jackpot") {GuidedAgent/scenario01}
}

glossaryEntry ga.ge02 
{
    name "up",
    meaning "high-sales",
    synonyms "ok"
}`)
    const mname2 = `${mname}2`
    const idx = s.indexOf('workflow')
    const s2 = s.substring(idx).trim()
    await doInternModule(mname2, s2)
    const m2 = fetchModule(mname2)
    const s3 = m2.toString().substring(idx).trim()
    assert(s2 === s3)
  })
})

describe('case-generation', () => {
  test('decsion-cases generated from pattern objects', async () => {
    const c1 = new CasePattern(LiteralPattern.String("salary is greater than 1000"), LiteralPattern.Id('Accept'))
    const c2 = new CasePattern(new ExpressionPattern("salary < 1000"), LiteralPattern.Id("Reject"))
    const d = new Decision('acceptOrRejectOffer', "acme.core", [c1.toString(), c2.toString()])
    const obj1 = await introspectCase(d.cases[0])
    assert(isLiteralPattern(obj1.condition))
    assert(obj1.condition.toString() === `"salary is greater than 1000"`)
    assert(isLiteralPattern(obj1.body))
    assert(obj1.body.toString() === 'Accept')
    const obj2 = await introspectCase(d.cases[1])
    assert(isExpressionPattern(obj2.condition))
    assert(obj2.condition.toString() === "salary < 1000")
    assert(isLiteralPattern(obj2.body))
    assert(obj2.body.toString() === 'Reject')
    const s = d.toString()
    assert(s === `decision acceptOrRejectOffer {
      case ("salary is greater than 1000") {
    Accept
  }
case (salary < 1000) {
    Reject
  }
    }`)
    await doInternModule(`caseGen`,
      `${s}
  
  agent offerAccept {
      instruction "Accept the incoming offer"
  }

  agent offerReject {
      instruction "Reject the incoming offer"
  }

  flow offerReviewer {
      acceptOrRejectOffer --> "Accept" offerAccept
      acceptOrRejectOffer --> "Reject" offerReject
  }    
  `
    )
    const mods = fetchModule('caseGen').toString()
    assert(mods === `module caseGen

decision acceptOrRejectOffer {
      case ("salary is greater than 1000") {
    Accept
  }
case (salary < 1000) {
    Reject
  }
    }
agent offerAccept
{
    instruction "Accept the incoming offer"
}
agent offerReject
{
    instruction "Reject the incoming offer"
}
flow offerReviewer {
      acceptOrRejectOffer --> "Accept" offerAccept
acceptOrRejectOffer --> "Reject" offerReject
    }`)
  })
})

describe('directive-generation', () => {
  test('directives generated from pattern objects', async () => {
    const cond1 = new IfPattern(LiteralPattern.String("salary > 1000"))
      .addPattern(LiteralPattern.String("accept the offer"))
    const d = new Directive('A.dir01', 'dirGen', newAgentDirectiveFromIf(cond1))
    const s = d.toString()
    assert(s === `directive A.dir01 {
        if("salary > 1000") {"accept the offer"}
      }`)
    await doInternModule('dirGen',
      `agent A {instruction "OK"}
      ${s}`
    )
    const ms = fetchModule('dirGen').toString()
    assert(ms === `module dirGen

agent A
{
    instruction "OK"
}
directive A.dir01 {
        if("salary > 1000") {"accept the offer"}
      }`)
  })
})

describe('scenario-generation', () => {
  test('scenarios generated from pattern objects', async () => {
    const cond1 = new IfPattern(LiteralPattern.String("salary > 1000"))
      .addPattern(LiteralPattern.Id("acme.core/incrementSalary"))
    const scn01 = new Scenario('A.scn01', 'scnGen', newAgentScenarioFromIf(cond1))
    const s1 = scn01.toString()
    assert(s1 === `scenario A.scn01 {
    if("salary > 1000") {acme.core/incrementSalary}
}
`)
    // empty scenario
    const scn02 = new Scenario('A.scn02', 'scnGen', newAgentScenarioFromIf(new IfPattern()))
    const s2 = scn02.toString()
    assert(s2 === `scenario A.scn02 {
    if("") {}
}
`)
    await doInternModule('dirGen',
      `agent A {instruction "OK"}
      ${s1}
      ${s2}`
    )
    const ms = fetchModule('dirGen').toString()
    assert(ms === `module dirGen

agent A
{
    instruction "OK"
}
scenario A.scn01 {
    if("salary > 1000") {acme.core/incrementSalary}
}

scenario A.scn02 {
    if("") {}
}
`)
  })
})

describe('flow-load-fix', () => {
  test('flow should load', async () => {
    const mname = 'expaugust.core'
    const mdef = `record RecordOne
{

}

record RecordB
{

}

event EventA
{
    Name String
}

workflow EventA {
    {EntityA {}};
    {Agent1 {}};
    {EventA {}}
}
event EventB
{

}

workflow EventB {

}
entity EntityA
{
    id String @id,
    Name String,
    Age Int
}

entity EntityB
{
    make String
}

entity EntityC
{

}


workflow @after create:expaugust.core/EntityA {

}
record RecordD
{

}

record RecordE
{

}

agent Agent4
{
    llm "llm01",
    flows [Agent4],
   responseSchema expaugust.core/RecordOne
}
agent Agent1
{
    llm "llm01"
}
event id
{

}

workflow id {

}
agent Agent2
{
    type "chat",
    llm "llm01"
}
agent Agent5
{
    type "chat",
    llm "llm01"
}
flow Agent4 {
      
    }`
    await doInternModule(mname, mdef)
    const m = fetchModule(mname)
    const s = m.toString()
    const idx = s.indexOf('record')
    const s1 = s.substring(idx)
    assert(mdef === s1)
  })
})