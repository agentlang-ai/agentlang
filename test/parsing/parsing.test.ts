import { assert, beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { expandToString as s } from 'langium/generate';
import { parseHelper } from 'langium/test';
import { createAgentlangServices } from '../../src/language/agentlang-module.js';
import {
  Definition,
  isModuleDefinition,
  isStandaloneStatement,
  ModuleDefinition,
} from '../../src/language/generated/ast.js';
import { parseAndIntern } from '../../src/runtime/loader.js';
import {
  Agent,
  Entity,
  enumAttributeSpec,
  fetchModule,
  getRelationship,
  oneOfAttributeSpec,
} from '../../src/runtime/module.js';
import { doInternModule } from '../util.js';
import { introspect } from '../../src/language/parser.js';
import { BasePattern } from '../../src/language/syntax.js';

let services: ReturnType<typeof createAgentlangServices>;
let parse: ReturnType<typeof parseHelper<ModuleDefinition>>;
let model: LangiumDocument<ModuleDefinition> | undefined;

beforeAll(async () => {
  services = createAgentlangServices(EmptyFileSystem);
  parse = parseHelper<ModuleDefinition>(services.Agentlang);

  // activate the following if your linking test requires elements from a built-in library, for example
  // await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
});

describe('Parsing tests', () => {
  test('parse simple model', async () => {
    model = await parse(`
            module Acme
            entity Person {
                id Int @id
                email Email @unique
                name String
                DOB Date @optional
            }
            event UpdatePersonEmail {
                personId Int
                email Email
            }
        `);

    // check for absence of parser errors the classic way:
    //  deactivated, find a much more human readable way below!
    // expect(document.parseResult.parserErrors).toHaveLength(0);

    expect(
      // here we use a (tagged) template expression to create a human readable representation
      //  of the AST part we are interested in and that is to be compared to our expectation;
      // prior to the tagged template expression we check for validity of the parsed document object
      //  by means of the reusable function 'checkDocumentValid()' to sort out (critical) typos first;
      checkDocumentValid(model) ||
        model.parseResult.value.defs.map((v: Definition) => {
          if (isStandaloneStatement(v)) return 'standalone-statement';
          else return v.name;
        })
    ).toStrictEqual(['Person', 'UpdatePersonEmail']);
  });
});

function checkDocumentValid(document: LangiumDocument): string | undefined {
  return (
    (document.parseResult.parserErrors.length &&
      s`
        Parser errors:
          ${document.parseResult.parserErrors.map(e => e.message).join('\n  ')}
    `) ||
    (document.parseResult.value === undefined && `ParseResult is 'undefined'.`) ||
    (!isModuleDefinition(document.parseResult.value) &&
      `Root AST object is a ${document.parseResult.value.$type}, expected a '${ModuleDefinition}'.`) ||
    undefined
  );
}

describe('Workflow update tests', () => {
  test('check setting and removing statements in workflows', async () => {
    await parseAndIntern(`module WfUpdateTest
      workflow Test {}
      `);
    const wf = fetchModule('WfUpdateTest').getWorkflowForEvent('Test');
    await wf.addStatement('{Acme/User {salary?> 1500}} @as users');
    await wf.setStatementAt('for u in users { }', 1);
    await wf.setStatementAt('{Acme/Profile {email u.email}}', [1, 0]);
    await wf.setStatementAt('{Acme/Account {email u.email}}', [1, 1]);
    await wf.addStatement('users');
    assert(
      wf.toString() ==
        `workflow Test {
    {Acme/User {salary?> 1500}} @as users;
   for u in users {
            {Acme/Profile {email u.email}};
    {Acme/Account {email u.email}}
    };
    users
}`,
      'Failed to set statements by index'
    );
    wf.removeStatementAt([1, 1]);
    assert(
      wf.toString() ==
        `workflow Test {
    {Acme/User {salary?> 1500}} @as users;
   for u in users {
            {Acme/Profile {email u.email}}
    };
    users
}`,
      'Failed to remove statement by index'
    );
    await wf.setStatementAt('if (u.age < 20) {} else {}', [1, 1]);
    await wf.setStatementAt('{Acme/Account {email u.email, type "A"}}', [1, 1, 0]);
    await wf.setStatementAt('{Acme/Account {email u.email, type "B"}}', [1, 1, -0]);
    assert(
      wf.toString() ==
        `workflow Test {
    {Acme/User {salary?> 1500}} @as users;
   for u in users {
            {Acme/Profile {email u.email}};
   if (u.age < 20) {
            {Acme/Account {email u.email, type "A"}}
    } else {
                {Acme/Account {email u.email, type "B"}}
    }
    };
    users
}`
    );
    wf.removeStatementAt([1, 1, -0]);
    assert(
      wf.toString() ==
        `workflow Test {
    {Acme/User {salary?> 1500}} @as users;
   for u in users {
            {Acme/Profile {email u.email}};
   if (u.age < 20) {
            {Acme/Account {email u.email, type "A"}}
    } else {
            
    }
    };
    users
}`
    );
  });
});

describe('Module toString tests', () => {
  test('Code generation from Modules', async () => {
    await doInternModule(
      'MtoStr',
      `
      entity E {
        name String @id
      }
      entity F {
        Id UUID @default(uuid()) @id
      }
      `
    );
    const m = fetchModule('MtoStr');
    m.addAgent(new Agent('agent01', 'MtoStr'));
    const str = m.toString();
    assert(
      str ==
        `module MtoStr

entity E
{
    name String @id
}

entity F
{
    Id UUID @default(uuid())  @id
}

agent agent01
{

}`
    );
  });
});

describe('Agent toString test', () => {
  test('Code generation for agent', async () => {
    await doInternModule(
      'AtoStr',
      `
      entity E {
        name String @id
      }
      entity F {
        Id UUID @default(uuid()) @id
      }

      agent Agent1 {
        instruction "This Agent will solve higher ordered equation"
      }

      agent Agent2 {
        instruction "This Agent will solve any math problem",
        tools "a,b",
        llm "agent2_llm"
      }
      `
    );
    const m = fetchModule('AtoStr');
    const str = m.toString();
    assert(
      str ===
        `module AtoStr

entity E
{
    name String @id
}

entity F
{
    Id UUID @default(uuid())  @id
}

agent Agent1
{
    instruction "This Agent will solve higher ordered equation"
}
agent Agent2
{
    instruction "This Agent will solve any math problem",
    tools "a,b",
    llm "agent2_llm"
}`
    );
  });
});

describe('Rbac toString test', () => {
  test('Code generation for rbac', async () => {
    await doInternModule(
      'RbacToStr',
      `
      entity E {
        name String @id,
        @rbac [(roles: [manager], allow: [create]),
           (allow: [read], where: auth.user = this.id)]
      }`
    );
    const str = fetchModule('RbacToStr').toString();
    assert(
      str ==
        `module RbacToStr

entity E
{
    name String @id,
    @rbac [(roles: [manager], allow: [create]),
(where: auth.user = this.id, allow: [read])]
}
`
    );
  });
});

describe('enum toString test', () => {
  test('test01', async () => {
    await doInternModule(
      'EnumOutTest',
      `entity E {
        id Int @id,
        x Int,
        a String[],
        r String @default("ok"),
        d DateTime @default(now()) @optional
      }`
    );
    let m = fetchModule('EnumOutTest');
    const e = m.getEntry('E') as Entity;
    let attrSpec = enumAttributeSpec(new Set(['a', 'b', 'c']));
    e.addAttribute('s', attrSpec);
    attrSpec = oneOfAttributeSpec('Acme/F.name');
    e.addAttribute('t', attrSpec);
    let str = m.toString();
    const idx = str.indexOf('entity');
    await doInternModule('EnumOutTest2', str.substring(idx));
    m = fetchModule('EnumOutTest2');
    str = m.toString();
    assert(
      str ==
        `module EnumOutTest2

entity E
{
    id Int @id,
    x Int,
    a String[],
    r String @default("ok"),
    d DateTime @default(now())  @optional,
    s  @enum("a","b","c"),
    t  @oneof(Acme/F.name)
}
`
    );
  });

  test('@enum should appear before other decorators in toString', async () => {
    await doInternModule(
      'EnumOrderTest',
      `entity Product {
        id UUID @id @default(uuid()),
        category @enum("electronics", "clothing", "food") @optional,
        status @enum("active", "inactive") @default("active") @optional,
        priority @enum("low", "medium", "high") @indexed
      }`
    );
    const m = fetchModule('EnumOrderTest');
    const result = m.toString();

    const lines = result.split('\n');

    const categoryLine = lines.find((line: string) => line.includes('category'));
    if (categoryLine) {
      const enumIndex = categoryLine.indexOf('@enum');
      const optionalIndex = categoryLine.indexOf('@optional');
      expect(enumIndex).toBeGreaterThan(-1);
      expect(optionalIndex).toBeGreaterThan(-1);
      expect(enumIndex).toBeLessThan(optionalIndex);
    }

    const statusLine = lines.find((line: string) => line.includes('status'));
    if (statusLine) {
      const enumIndex = statusLine.indexOf('@enum');
      const defaultIndex = statusLine.indexOf('@default');
      const optionalIndex = statusLine.indexOf('@optional');
      expect(enumIndex).toBeLessThan(defaultIndex);
      expect(enumIndex).toBeLessThan(optionalIndex);
    }

    const priorityLine = lines.find((line: string) => line.includes('priority'));
    if (priorityLine) {
      const enumIndex = priorityLine.indexOf('@enum');
      const indexedIndex = priorityLine.indexOf('@indexed');
      expect(enumIndex).toBeLessThan(indexedIndex);
    }
  });

  test('@oneof should appear before other decorators in toString', async () => {
    await doInternModule(
      'OneOfOrderTest',
      `entity User {
        name String @id
      }
      
      entity Status {
        code String @id
      }
      
      entity Reference {
        id UUID @id @default(uuid()),
        entityRef @oneof(OneOfOrderTest/User.name) @optional,
        statusRef @oneof(OneOfOrderTest/Status.code) @indexed
      }`
    );
    const m = fetchModule('OneOfOrderTest');
    const result = m.toString();

    const lines = result.split('\n');

    const entityRefLine = lines.find((line: string) => line.includes('entityRef'));
    if (entityRefLine) {
      const oneofIndex = entityRefLine.indexOf('@oneof');
      const optionalIndex = entityRefLine.indexOf('@optional');
      expect(oneofIndex).toBeLessThan(optionalIndex);
    }

    const statusRefLine = lines.find((line: string) => line.includes('statusRef'));
    if (statusRefLine) {
      const oneofIndex = statusRefLine.indexOf('@oneof');
      const indexedIndex = statusRefLine.indexOf('@indexed');
      expect(oneofIndex).toBeLessThan(indexedIndex);
    }
  });
});

describe('relationships toString test', () => {
  test('test01', async () => {
    await doInternModule(
      'RelOutTest',
      `entity A {
        id Int @id
      }
      entity B {
        id Int @id
      }
      entity C {
        id Int @id
      }
      relationship AB between(A, B) @one_many
      relationship BA between(B, A)
      relationship BC contains(B, C)
      `
    );
    const m = fetchModule('RelOutTest');
    const r = getRelationship('BA', m.name);
    r.setOneToOne();
    let str = m.toString();
    const idx = str.indexOf('entity');
    await doInternModule('RelOutTest2', str.substring(idx));
    str = fetchModule('RelOutTest2').toString();
    assert(
      str ==
        `module RelOutTest2

entity A
{
    id Int @id
}

entity B
{
    id Int @id
}

entity C
{
    id Int @id
}

relationship AB between (A, B) @one_many

relationship BA between (B, A) @one_one

relationship BC contains (B, C)
`
    );
  });
});

describe('Statements to string issue', () => {
  test('test01', async () => {
    await doInternModule(
      'StmtsToStr',
      `workflow updateIncidentApprovalStatus {
    updateIncidentApprovalStatus.incidentSysId + ": " + updateIncidentApprovalStatus.approvalStatus + ", " + updateIncidentApprovalStatus.updatedOn @as s;
    console.log(s);
    {servicenow/incident {sys_id? updateIncidentApprovalStatus.incidentSysId, data {"comment": updateIncidentApprovalStatus.approvalStatus}}}
}`
    );
    const m = fetchModule('StmtsToStr');
    const wf = m.getWorkflowForEvent('updateIncidentApprovalStatus');
    const s = wf.statementsToStrings();
    for (let i = 0; i < s.length; ++i) {
      const bps: BasePattern[] = await introspect(s[i]);
      assert(bps.length > 0);
      const ps = bps[0].toString();
      assert(ps.trim() == s[i].trim());
    }
  });
});
