import { assert, beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { expandToString as s } from 'langium/generate';
import { parseHelper } from 'langium/test';
import { createAgentlangServices } from '../../src/language/agentlang-module.js';
import { Definition, isModuleDefinition, ModuleDefinition } from '../../src/language/generated/ast.js';
import { BasePattern, MutableWorkflow } from '../../src/language/syntax.js';
import { introspect } from '../../src/language/parser.js';

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
        return v.name;
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
    const wf = new MutableWorkflow('Test/Acme')
    let bps: BasePattern[] =
      await introspect('{Acme/User {salary?> 1500}} as users')
    await wf.addPattern(bps[0])
    bps = await introspect('for u in users { }')
    wf.setPatternAt(bps[0], 1)
    bps = await introspect('{Acme/Profile {email u.email}}')
    wf.setPatternAt(bps[0], [1, 0])
    bps = await introspect('{Acme/Account {email u.email}}')
    wf.setPatternAt(bps[0], [1, 1])
    bps = await introspect('user')
    wf.addPattern(bps[0])
    assert(wf.toString() == `workflow Test/Acme {{Acme/User {salary?> 1500}} as users;
for u in users{{Acme/Profile {email u.email}};
{Acme/Account {email u.email}}};
user}`, 'Failed to add workflow patterns')
    wf.removePatternAt([1, 1])
    assert(wf.toString() == `workflow Test/Acme {{Acme/User {salary?> 1500}} as users;
for u in users{{Acme/Profile {email u.email}}};
user}`, 'Failed to remove pattern')
  })
})
