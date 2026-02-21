import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { createAgentlangServices } from '../../src/language/agentlang-module.js';
import { ModuleDefinition } from '../../src/language/generated/ast.js';
import {
  collectErrors,
  formatError,
  formatErrors,
  renderSnippet,
  getFormattedErrors,
  editDistance,
  suggest,
  formatSuggestions,
  type AgentlangError,
  type ErrorRegion,
} from '../../src/language/error-reporter.js';

let services: ReturnType<typeof createAgentlangServices>;
let parse: ReturnType<typeof parseHelper<ModuleDefinition>>;

beforeAll(async () => {
  services = createAgentlangServices(EmptyFileSystem);
  const doParse = parseHelper<ModuleDefinition>(services.Agentlang);
  parse = (input: string) => doParse(input, { validation: true });
});

// ---------------------------------------------------------------------------
// renderSnippet unit tests
// ---------------------------------------------------------------------------
describe('renderSnippet', () => {
  const source = [
    'module test.core',
    '',
    'entity Customer {',
    '    name Strng,',
    '    age Int',
    '}',
  ].join('\n');

  test('shows line numbers and underline on a single-line error', () => {
    const region: ErrorRegion = {
      startLine: 4,
      startCol: 10,
      endLine: 4,
      endCol: 14,
    };
    const snippet = renderSnippet(source, region, 1);
    // Should contain line numbers
    expect(snippet).toContain('3 |');
    expect(snippet).toContain('4 |');
    expect(snippet).toContain('5 |');
    // Should contain the source line
    expect(snippet).toContain('name Strng,');
    // Should contain underline tildes
    expect(snippet).toContain('~~~~~');
  });

  test('respects context lines parameter', () => {
    const region: ErrorRegion = {
      startLine: 4,
      startCol: 10,
      endLine: 4,
      endCol: 14,
    };
    const snippet = renderSnippet(source, region, 0);
    // Only the error line, no surrounding context
    const lines = snippet.split('\n');
    expect(lines.length).toBe(2); // source line + underline
    expect(lines[0]).toContain('name Strng,');
    expect(lines[1]).toContain('~~~~~');
  });

  test('handles error on first line', () => {
    const region: ErrorRegion = {
      startLine: 1,
      startCol: 8,
      endLine: 1,
      endCol: 16,
    };
    const snippet = renderSnippet(source, region, 2);
    expect(snippet).toContain('1 |');
    expect(snippet).toContain('module test.core');
    expect(snippet).toContain('~~~~~~~~~');
  });

  test('handles error on last line', () => {
    const region: ErrorRegion = {
      startLine: 6,
      startCol: 1,
      endLine: 6,
      endCol: 1,
    };
    const snippet = renderSnippet(source, region, 1);
    expect(snippet).toContain('5 |');
    expect(snippet).toContain('6 |');
    expect(snippet).toContain('}');
    expect(snippet).toContain('~');
  });
});

// ---------------------------------------------------------------------------
// formatError unit tests
// ---------------------------------------------------------------------------
describe('formatError', () => {
  test('produces header with category and file', () => {
    const err: AgentlangError = {
      category: 'SYNTAX ERROR',
      file: 'test.al',
      region: { startLine: 3, startCol: 1, endLine: 3, endCol: 5 },
      message: 'I was expecting a comma but found a name.',
    };
    const source = 'module test\n\nentity Foo {}\n';
    const formatted = formatError(err, source);
    expect(formatted).toContain('-- SYNTAX ERROR');
    expect(formatted).toContain('test.al');
    expect(formatted).toContain('I was expecting a comma');
  });

  test('includes hint when provided', () => {
    const err: AgentlangError = {
      category: 'MISSING TOKEN',
      file: 'test.al',
      region: { startLine: 1, startCol: 1, endLine: 1, endCol: 3 },
      message: 'Missing closing brace.',
      hint: 'Check that all opening braces have matching closing ones.',
    };
    const source = 'module test\n';
    const formatted = formatError(err, source);
    expect(formatted).toContain('Hint: Check that all opening braces');
  });

  test('includes source snippet with underline', () => {
    const err: AgentlangError = {
      category: 'SYNTAX ERROR',
      file: 'test.al',
      region: { startLine: 2, startCol: 5, endLine: 2, endCol: 9 },
      message: 'Unexpected token.',
    };
    const source = 'module test\nbad stuff here\n';
    const formatted = formatError(err, source);
    expect(formatted).toContain('bad stuff here');
    expect(formatted).toContain('~~~~~');
  });
});

// ---------------------------------------------------------------------------
// collectErrors integration tests – feed broken agentlang to the parser
// ---------------------------------------------------------------------------
describe('collectErrors', () => {
  test('collects parser errors for invalid module name', async () => {
    const doc = await parse('module 1234');
    const errors = collectErrors(doc);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].region.startLine).toBeGreaterThanOrEqual(1);
  });

  test('collects parser errors for missing closing brace', async () => {
    const doc = await parse(`
module test
entity Customer {
    name String
`);
    const errors = collectErrors(doc);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('collects errors for completely invalid syntax', async () => {
    const doc = await parse(`
module test
entity Customer {
    name String,
    @@@ invalid
}
`);
    const errors = collectErrors(doc);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getFormattedErrors – end-to-end formatted output
// ---------------------------------------------------------------------------
describe('getFormattedErrors', () => {
  test('returns undefined for valid input', async () => {
    const doc = await parse(`
module test
entity Customer {
    name String,
    age Int
}
`);
    const formatted = getFormattedErrors(doc);
    expect(formatted).toBeUndefined();
  });

  test('produces formatted output for syntax errors', async () => {
    const doc = await parse('module 1234 entity Foo {}');
    const formatted = getFormattedErrors(doc);
    expect(formatted).toBeDefined();
    // Should have the header line
    expect(formatted).toMatch(/^-- (SYNTAX ERROR|UNEXPECTED TOKEN|MISSING TOKEN)/);
    // Should have line numbers and pipe separator
    expect(formatted).toMatch(/\d+ \|/);
    // Should have underline
    expect(formatted).toContain('~');
  });

  test('produces readable output for missing closing brace', async () => {
    const doc = await parse(`
module test
entity Customer {
    name String,
    age Int
`);
    const formatted = getFormattedErrors(doc);
    expect(formatted).toBeDefined();
    expect(formatted).toMatch(/-- (SYNTAX ERROR|MISSING TOKEN)/);
    expect(formatted).toContain('~');
  });

  test('limits output to at most 3 errors', async () => {
    // A very broken input that generates many errors
    const doc = await parse('module 1234 @@@ %%% !!!');
    const formatted = getFormattedErrors(doc);
    if (formatted) {
      const headerCount = (formatted.match(/^-- /gm) || []).length;
      expect(headerCount).toBeLessThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// formatErrors deduplication
// ---------------------------------------------------------------------------
describe('formatErrors deduplication', () => {
  test('deduplicates errors on the same line', () => {
    const source = 'module test\nbad line\n';
    const errors: AgentlangError[] = [
      {
        category: 'SYNTAX ERROR',
        file: 'test.al',
        region: { startLine: 2, startCol: 1, endLine: 2, endCol: 3 },
        message: 'First error.',
      },
      {
        category: 'SYNTAX ERROR',
        file: 'test.al',
        region: { startLine: 2, startCol: 5, endLine: 2, endCol: 8 },
        message: 'Second error on same line.',
      },
    ];
    const formatted = formatErrors(errors, source);
    // Only one header should appear (deduplicated)
    const headerCount = (formatted.match(/^-- SYNTAX ERROR/gm) || []).length;
    expect(headerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Plain English error messages for common mistakes
// ---------------------------------------------------------------------------
describe('plain English error messages', () => {
  test('invalid module name says what it expected', async () => {
    const doc = await parse('module 1234');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('module name');
    expect(formatted).toContain('1234');
    expect(formatted).toContain('module MyApp');
  });

  test('missing closing brace identifies the definition type', async () => {
    const doc = await parse('module test\nentity Customer {\n    name String,\n    age Int\n');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('MISSING TOKEN');
    expect(formatted).toContain('entity');
    expect(formatted).toContain('`}`');
  });

  test('bad decorator gives spelling hint', async () => {
    const doc = await parse('module test\n@pubic agent MyAgent {}');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain("don't recognize");
    expect(formatted).toContain('@public');
  });

  test('incomplete module gives helpful example', async () => {
    const doc = await parse('module');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('MISSING TOKEN');
    expect(formatted).toContain('module name');
    expect(formatted).toContain('end of the file');
    expect(formatted).toContain('module MyApp');
  });

  test('incomplete entity names the definition type', async () => {
    const doc = await parse('module test\nentity');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('MISSING TOKEN');
    expect(formatted).toContain('entity name');
  });

  test('double comma gives specific guidance', async () => {
    const doc = await parse('module test\nentity E { name String, , age Int }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('comma');
  });

  test('workflow body error mentions workflow context', async () => {
    const doc = await parse('module test\nworkflow W { if (x > 5 { } }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('workflow');
  });

  test('missing closing brace for entity uses correct category', async () => {
    const doc = await parse('module test\nentity E {\n    name String\n');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toMatch(/-- MISSING TOKEN/);
    expect(formatted).toContain('entity');
    expect(formatted).toContain('`}`');
  });

  test('@ref without proper args explains the context', async () => {
    const doc = await parse('module test\nentity E { name String @id, email String @ref() }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('SYNTAX ERROR');
    expect(formatted).toContain('@ref');
  });

  test('valid input produces no errors', async () => {
    const doc = await parse(`
module test
entity Customer {
    name String,
    age Int
}
workflow ProcessCustomer {
    {Customer {name "John", age 30}}
}
`);
    const formatted = getFormattedErrors(doc);
    expect(formatted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 3: Edit distance, suggestions, and "Did you mean?"
// ---------------------------------------------------------------------------
describe('editDistance', () => {
  test('identical strings have distance 0', () => {
    expect(editDistance('hello', 'hello')).toBe(0);
  });

  test('case-insensitive comparison', () => {
    expect(editDistance('Hello', 'hello')).toBe(0);
    expect(editDistance('@Public', '@public')).toBe(0);
  });

  test('single insertion', () => {
    expect(editDistance('pubic', 'public')).toBe(1);
  });

  test('single deletion', () => {
    expect(editDistance('public', 'pubic')).toBe(1);
  });

  test('single substitution', () => {
    expect(editDistance('entity', 'entitx')).toBe(1);
  });

  test('transposition', () => {
    expect(editDistance('enttiy', 'entity')).toBe(1);
  });

  test('empty strings', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });

  test('completely different strings', () => {
    expect(editDistance('abc', 'xyz')).toBe(3);
  });
});

describe('suggest', () => {
  const candidates = ['entity', 'event', 'record', 'workflow', 'agent'];

  test('finds close matches', () => {
    const result = suggest('entty', candidates);
    expect(result).toContain('entity');
    // 'event' is distance 3 from 'entty', which exceeds the adaptive max (2 for 5-char input)
    expect(result).not.toContain('event');
  });

  test('exact match is excluded (distance 0)', () => {
    const result = suggest('entity', candidates);
    expect(result).not.toContain('entity');
  });

  test('returns empty for completely unrelated input', () => {
    const result = suggest('zzzzzzz', candidates);
    expect(result).toHaveLength(0);
  });

  test('returns at most maxResults items', () => {
    const result = suggest('e', ['a', 'b', 'c', 'd', 'f'], undefined, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test('empty input returns empty', () => {
    expect(suggest('', candidates)).toHaveLength(0);
  });

  test('adaptive max distance: short inputs are stricter', () => {
    // '@id' is length 3 → max distance 1
    // '@as' has distance 2 from '@id' → should NOT be suggested
    const result = suggest('@id', ['@as', '@id', '@ref']);
    expect(result).not.toContain('@as');
  });
});

describe('formatSuggestions', () => {
  test('no suggestions returns undefined', () => {
    expect(formatSuggestions([])).toBeUndefined();
  });

  test('single suggestion uses "Did you mean?"', () => {
    const result = formatSuggestions(['@public']);
    expect(result).toBe('Did you mean `@public`?');
  });

  test('multiple suggestions uses list format', () => {
    const result = formatSuggestions(['@public', '@rbac'])!;
    expect(result).toContain('These names seem close');
    expect(result).toContain('@public');
    expect(result).toContain('@rbac');
  });
});

describe('"Did you mean?" in formatted errors', () => {
  test('@pubic suggests @public', async () => {
    const doc = await parse('module test\n@pubic agent MyAgent {}');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('@pubic');
    expect(formatted).toContain('Did you mean `@public`?');
  });

  test('@optonal suggests @optional', async () => {
    const doc = await parse('module test\nentity E { name String }\n@optonal');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('@optonal');
    expect(formatted).toContain('Did you mean `@optional`?');
  });

  test('@befor suggests @before', async () => {
    const doc = await parse('module test\n@befor');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('@befor');
    expect(formatted).toContain('Did you mean `@before`?');
  });

  test('@refr suggests @ref', async () => {
    const doc = await parse('module test\nentity E { name String }\n@refr');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('@refr');
    expect(formatted).toContain('@ref');
  });

  test('decorator underline covers full @xxx text, not just @', async () => {
    const doc = await parse('module test\n@pubic agent MyAgent {}');
    const formatted = getFormattedErrors(doc)!;
    // @pubic is 6 chars, so underline should be 6 tildes
    expect(formatted).toContain('~~~~~~');
  });

  test('completely unknown decorator falls back to generic hint', async () => {
    const doc = await parse('module test\n@zzzzzzz');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('Valid decorators include');
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Common mistake detectors
// ---------------------------------------------------------------------------
describe('common mistake detectors', () => {
  test('trailing comma says to remove it', async () => {
    const doc = await parse('module test\nentity E { name String, age Int, }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('trailing comma');
    expect(formatted).toContain('Remove the comma');
  });

  test('missing type on attribute names the attribute', async () => {
    const doc = await parse('module test\nentity E { name, age Int }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('`name`');
    expect(formatted).toContain('missing a type');
    expect(formatted).toContain('name String');
  });

  test('missing entity braces suggests correct syntax', async () => {
    const doc = await parse('module test\nentity E name String');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('`{`');
    expect(formatted).toContain('entity');
    expect(formatted).toContain('braces');
  });

  test('unclosed string says quote is missing', async () => {
    const doc = await parse('module test\nentity E { name "hello }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('missing its closing');
    expect(formatted).toContain('quote');
  });

  test('semicolon instead of comma explains the difference', async () => {
    const doc = await parse('module test\nentity E { name String; age Int }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('semicolon');
    expect(formatted).toContain('commas');
  });

  test('colon in attribute explains correct syntax', async () => {
    const doc = await parse('module test\nentity E { name: String, age: Int }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('colon');
    expect(formatted).toContain('name String');
  });

  test('equals in attribute explains correct syntax', async () => {
    const doc = await parse('module test\nentity E { name = "hello" }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('`=`');
    expect(formatted).toContain('name String');
  });

  test('duplicate module keyword gives clear message', async () => {
    const doc = await parse('module test\nmodule test2');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('second');
    expect(formatted).toContain('module');
    expect(formatted).toContain('one');
  });
});

// ---------------------------------------------------------------------------
// Phase 5: Contextual hints on all error paths
// ---------------------------------------------------------------------------
describe('contextual hints on all error paths', () => {
  test('unclosed string gets a hint with example', async () => {
    const doc = await parse('module test\nentity E { name "hello }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('Hint:');
    expect(formatted).toContain('closing');
  });

  test('unexpected character gets a hint', async () => {
    const doc = await parse('module test\nentity E { name String# }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('Hint:');
  });

  test('generic mismatch includes a hint', async () => {
    // This triggers a mismatch that doesn't hit a specific handler
    const doc = await parse('module test\nentity E { name String @id } entity F [ ]');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('Hint:');
  });

  test('every error in formatted output includes a hint', async () => {
    // Various broken inputs that exercise different paths
    const inputs = [
      'module test\nentity E { name "hello }', // unclosed string (lexer)
      'module test\nentity E { name String; age Int }', // semicolon (mismatch)
      'module test\nentity E { name, age Int }', // missing type (NoViableAlt)
      'module test\n@pubic agent A {}', // bad decorator (NotAllInput)
      'module test\nentity', // incomplete (NoViableAlt at EOF)
      'module test\nentity E name String', // missing braces (NoViableAlt)
    ];
    for (const input of inputs) {
      const doc = await parse(input);
      const formatted = getFormattedErrors(doc);
      if (formatted) {
        expect(formatted).toContain('Hint:');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 6: Reserved keyword detection
// ---------------------------------------------------------------------------
describe('reserved keyword used as name', () => {
  test('entity named with reserved keyword "query"', async () => {
    const doc = await parse('module test\nentity query { name String }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('reserved keyword');
    expect(formatted).toContain('`query`');
    expect(formatted).toContain('entity name');
  });

  test('entity named with reserved keyword "delete"', async () => {
    const doc = await parse('module test\nentity delete { name String }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('reserved keyword');
    expect(formatted).toContain('`delete`');
  });

  test('event named with reserved keyword "event"', async () => {
    const doc = await parse('module test\nevent event { name String }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('reserved keyword');
    expect(formatted).toContain('event name');
  });

  test('record named with reserved keyword "true"', async () => {
    const doc = await parse('module test\nrecord true { name String }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('reserved keyword');
    expect(formatted).toContain('`true`');
    expect(formatted).toContain('record name');
  });

  test('workflow named with reserved keyword "if"', async () => {
    const doc = await parse('module test\nworkflow if {}');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('reserved keyword');
    expect(formatted).toContain('`if`');
  });

  test('agent named with reserved keyword "for"', async () => {
    const doc = await parse('module test\nagent for {}');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('reserved keyword');
    expect(formatted).toContain('`for`');
  });

  test('reserved keyword hint suggests alternative name', async () => {
    const doc = await parse('module test\nentity query { name String }');
    const formatted = getFormattedErrors(doc)!;
    expect(formatted).toContain('Choose a different name');
  });

  test('no validator crash (TypeError) on reserved keyword entity', async () => {
    const doc = await parse('module test\nentity delete { name String }');
    const formatted = getFormattedErrors(doc)!;
    // Should get a clean error, not a stack trace
    expect(formatted).not.toContain('TypeError');
    expect(formatted).not.toContain('Cannot read properties');
    expect(formatted).toContain('reserved keyword');
  });
});
