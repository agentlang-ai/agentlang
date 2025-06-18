import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { expandToString as s } from 'langium/generate';
import { parseHelper } from 'langium/test';
import type { Diagnostic } from 'vscode-languageserver-types';
import { createAgentlangServices } from '../../src/language/agentlang-module.js';
import { isModuleDefinition, ModuleDefinition } from '../../src/language/generated/ast.js';

let services: ReturnType<typeof createAgentlangServices>;
let parse: ReturnType<typeof parseHelper<ModuleDefinition>>;
let document: LangiumDocument<ModuleDefinition> | undefined;

beforeAll(async () => {
  services = createAgentlangServices(EmptyFileSystem);
  const doParse = parseHelper<ModuleDefinition>(services.Agentlang);
  parse = (input: string) => doParse(input, { validation: true });

  // activate the following if your linking test requires elements from a built-in library, for example
  // await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
});

describe('Validating', () => {
  test('check no errors', async () => {
    document = await parse(`
            module 1234
            entity KK {name String}
        `);
    expect(
      // here we first check for validity of the parsed document object by means of the reusable function
      //  'checkDocumentValid()' to sort out (critical) typos first,
      // and then evaluate the diagnostics by converting them into human readable strings;
      // note that 'toHaveLength()' works for arrays and strings alike ;-)
      checkDocumentValid(document) || document?.diagnostics?.map(diagnosticToString)?.join('\n')
    ).contains("Expecting token of type 'ID' but found `1234`");
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

function diagnosticToString(d: Diagnostic) {
  return d.message;
}

if (process.env.NODE_ENV === 'test') {
  setTimeout(() => process.exit(1), 1000);
} else {
  process.exit(1);
}
