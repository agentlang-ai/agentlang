import { LangiumDocument } from 'langium';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | 'SYNTAX ERROR'
  | 'UNEXPECTED TOKEN'
  | 'MISSING TOKEN'
  | 'VALIDATION ERROR';

export interface ErrorRegion {
  startLine: number; // 1-based
  startCol: number; // 1-based
  endLine: number; // 1-based
  endCol: number; // 1-based
}

export interface AgentlangError {
  category: ErrorCategory;
  file: string;
  region: ErrorRegion;
  message: string;
  hint?: string;
}

// ---------------------------------------------------------------------------
// Error collection – convert Langium/Chevrotain errors to AgentlangError[]
// ---------------------------------------------------------------------------

export function collectErrors(document: LangiumDocument): AgentlangError[] {
  const errors: AgentlangError[] = [];
  const uri = document.uri.toString();
  const file = uri.replace(/^file:\/\/\//, '');

  // Lexer errors
  for (const err of document.parseResult.lexerErrors) {
    const le = err as any;
    const line = le.line ?? 1;
    const col = le.column ?? 1;
    const length = le.length ?? 1;
    const { message: lexMsg, hint: lexHint } = humanizeLexerError(le.message);
    errors.push({
      category: 'UNEXPECTED TOKEN',
      file,
      region: {
        startLine: line,
        startCol: col,
        endLine: line,
        endCol: col + length - 1,
      },
      message: lexMsg,
      hint: lexHint,
    });
  }

  // Parser errors
  const sourceLines = document.textDocument.getText().split('\n');
  for (const err of document.parseResult.parserErrors) {
    const pe = err as any;
    const token = pe.token;
    let startLine = token?.startLine;
    let startCol = token?.startColumn;
    let endLine = token?.endLine;
    let endCol = token?.endColumn;

    // When the error token is EOF, positions are NaN.
    // Fall back to the previous token's end position, or the last line.
    if (!startLine || isNaN(startLine)) {
      const prev = pe.previousToken;
      if (prev?.endLine && !isNaN(prev.endLine)) {
        startLine = prev.endLine;
        startCol = (prev.endColumn ?? 0) + 1;
        endLine = startLine;
        endCol = startCol;
      } else {
        // Last resort: point to end of source
        startLine = sourceLines.length;
        startCol = (sourceLines[sourceLines.length - 1]?.length ?? 0) + 1;
        endLine = startLine;
        endCol = startCol;
      }
    }

    const source = document.textDocument.getText();
    const { category, message, hint, regionOverride } = classifyParserError(pe, source);
    errors.push({
      category,
      file,
      region: regionOverride ?? {
        startLine: startLine ?? 1,
        startCol: startCol ?? 1,
        endLine: endLine ?? startLine ?? 1,
        endCol: endCol ?? startCol ?? 1,
      },
      message,
      hint,
    });
  }

  // Validation errors (severity 1 = error)
  const validationErrors = (document.diagnostics ?? []).filter(e => e.severity === 1);
  for (const ve of validationErrors) {
    const text = document.textDocument.getText(ve.range);
    errors.push({
      category: 'VALIDATION ERROR',
      file,
      region: {
        startLine: ve.range.start.line + 1,
        startCol: ve.range.start.character + 1,
        endLine: ve.range.end.line + 1,
        endCol: ve.range.end.character + 1,
      },
      message: ve.message || `Unexpected token '${text}'.`,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Error classification – turn raw Chevrotain messages into categories + plain English
// ---------------------------------------------------------------------------

type ClassifiedError = {
  category: ErrorCategory;
  message: string;
  hint?: string;
  regionOverride?: ErrorRegion;
};

// Human-readable names for grammar rules found in Chevrotain's ruleStack
const RULE_NAMES: Record<string, string> = {
  ModuleDefinition: 'module',
  EntityDefinition: 'entity',
  EventDefinition: 'event',
  RecordDefinition: 'record',
  WorkflowDefinition: 'workflow',
  AgentDefinition: 'agent',
  FlowDefinition: 'flow',
  DecisionDefinition: 'decision',
  RelationshipDefinition: 'relationship',
  ResolverDefinition: 'resolver',
  ScenarioDefinition: 'scenario',
  DirectiveDefinition: 'directive',
  RecordSchemaDefinition: 'schema body',
  RecDef: 'definition',
  CrudMap: 'data pattern',
  CrudMapBody: 'data pattern body',
  If: 'if expression',
  ForEach: 'for-each loop',
  Body: 'body',
  QualifiedName: 'name',
  AttributeDefinition: 'attribute',
  GenericDefBody: 'definition body',
};

// The known decorator keywords in agentlang (used for suggestions in later phases)
export const KNOWN_DECORATORS = [
  '@public',
  '@id',
  '@ref',
  '@enum',
  '@oneof',
  '@expr',
  '@optional',
  '@unique',
  '@default',
  '@as',
  '@catch',
  '@empty',
  '@then',
  '@async',
  '@after',
  '@before',
  '@when',
  '@rbac',
  '@meta',
  '@with_unique',
  '@actions',
  '@where',
  '@into',
  '@join',
  '@inner_join',
  '@left_join',
  '@right_join',
  '@full_join',
  '@groupBy',
  '@orderBy',
  '@limit',
  '@offset',
  '@upsert',
  '@distinct',
  '@withRole',
];

function classifyParserError(err: any, source: string): ClassifiedError {
  const raw: string = err.message ?? '';
  const token = err.token;
  const prevToken = err.previousToken;
  // Langium appends U+200B (zero-width space) to rule names; strip it for matching
  const ruleStack: string[] = (err.context?.ruleStack ?? []).map((s: string) =>
    s.replace(/\u200B/g, '')
  );
  const found = token?.image ?? '';
  const prevImage = prevToken?.image ?? '';
  const isEOF = !found || found === '' || token?.tokenType?.name === 'EOF';
  const errorName: string = err.name ?? '';

  // -----------------------------------------------------------------------
  // 1. NotAllInputParsedException – extra tokens after valid parse
  // -----------------------------------------------------------------------
  if (errorName === 'NotAllInputParsedException' || raw.includes('Expecting end of file')) {
    if (found === '@' || found.startsWith('@')) {
      const attempted = extractDecoratorAtPosition(source, token);
      const decoratorHint = buildDecoratorSuggestion(attempted);
      return {
        category: 'SYNTAX ERROR',
        message: attempted
          ? `I don't recognize \`${attempted}\` as a valid decorator or keyword here.`
          : `I don't recognize '${found}' as a valid decorator or keyword here.`,
        hint: decoratorHint,
        regionOverride: decoratorRegion(token, attempted),
      };
    }
    return {
      category: 'SYNTAX ERROR',
      message: `There is unexpected input '${found}' after what I expected to be the end.`,
      hint: `This usually means a closing brace '}' is missing earlier, or there are extra characters that don't belong.`,
    };
  }

  // -----------------------------------------------------------------------
  // 2. MismatchedTokenException – expected a specific token, got something else
  // -----------------------------------------------------------------------
  if (errorName === 'MismatchedTokenException' || raw.includes('Expecting token of type')) {
    return classifyMismatch(raw, found, prevImage, ruleStack, isEOF, source, token);
  }

  // -----------------------------------------------------------------------
  // 3. NoViableAltException – none of the grammar alternatives matched
  // -----------------------------------------------------------------------
  if (
    errorName === 'NoViableAltException' ||
    raw.includes('one of these possible Token sequences')
  ) {
    return classifyNoViableAlt(found, prevImage, ruleStack, isEOF, source, token);
  }

  // -----------------------------------------------------------------------
  // 4. EarlyExitException – a required repetition had zero matches
  // -----------------------------------------------------------------------
  if (errorName === 'EarlyExitException' || raw.includes('EarlyExit')) {
    const ctx = innermostContext(ruleStack);
    return {
      category: 'SYNTAX ERROR',
      message: `I was expecting more input here${ctx ? ` while parsing ${ctx}` : ''}, but the definition ended too soon.`,
      hint: `A required element may be missing. Check that all definitions are complete.`,
    };
  }

  // -----------------------------------------------------------------------
  // Fallback
  // -----------------------------------------------------------------------
  const fallbackCtx = innermostContext(ruleStack);
  return {
    category: 'SYNTAX ERROR',
    message: humanizeFallback(raw),
    hint: fallbackCtx
      ? `This error occurred while parsing ${fallbackCtx}. Check for typos, missing punctuation, or incomplete definitions.`
      : `Check for typos, missing commas, unclosed braces, or other syntax issues near this location.`,
  };
}

// ---------------------------------------------------------------------------
// MismatchedTokenException handler
// ---------------------------------------------------------------------------

function classifyMismatch(
  raw: string,
  found: string,
  prevImage: string,
  ruleStack: string[],
  isEOF: boolean,
  source: string,
  token: any
): ClassifiedError {
  // Extract the expected token from the raw message
  const expectMatch = raw.match(/Expecting token of type '([^']+)'/);
  const expectedToken = expectMatch ? expectMatch[1] : '';

  // --- Missing closing brace at EOF ---
  if (expectedToken === '}' && isEOF) {
    const ctx = innermostDefinition(ruleStack);
    if (ctx) {
      return {
        category: 'MISSING TOKEN',
        message: `I was parsing ${aOrAn(ctx)} ${ctx} definition but never found a closing \`}\`.`,
        hint: `Check that every opening \`{\` has a matching closing \`}\`.`,
      };
    }
    return {
      category: 'MISSING TOKEN',
      message: `I reached the end of the file but was expecting a closing \`}\`.`,
      hint: `Check that every opening \`{\` has a matching closing \`}\`.`,
    };
  }

  // --- Missing closing paren at EOF ---
  if (expectedToken === ')' && isEOF) {
    return {
      category: 'MISSING TOKEN',
      message: `I reached the end of the file but was expecting a closing \`)\`.`,
      hint: `Check that every opening \`(\` has a matching closing \`)\`.`,
    };
  }

  // --- Semicolon instead of comma in entity attributes ---
  if (expectedToken === '}' && found === ';' && ruleStack.includes('RecordSchemaDefinition')) {
    return {
      category: 'SYNTAX ERROR',
      message: `I found a semicolon \`;\` but attributes should be separated by commas.`,
      hint: `Use commas between attributes, not semicolons. Example:\n\n    entity E {\n        name String,\n        age Int\n    }`,
    };
  }

  // --- Duplicate module declaration ---
  if (expectedToken === 'EOF' && found === 'module') {
    return {
      category: 'SYNTAX ERROR',
      message: `I found a second \`module\` declaration, but only one is allowed per file.`,
      hint: `Each file should contain exactly one \`module\` declaration at the top.`,
    };
  }

  // --- Expected '}' but found a decorator like '@ref' ---
  if (expectedToken === '}' && found.startsWith('@')) {
    const ctx = innermostDefinition(ruleStack);
    if (ctx) {
      return {
        category: 'SYNTAX ERROR',
        message: `I was expecting \`}\` to close the ${ctx}, but found \`${found}\`.`,
        hint: `'${found}' may need a preceding comma, or you may be missing a closing \`}\` before it.`,
      };
    }
  }

  // --- Expected EOF but found '@' (bad decorator) ---
  if (expectedToken === 'EOF' && (found === '@' || found.startsWith('@'))) {
    const attempted = extractDecoratorAtPosition(source, token);
    const decoratorHint = buildDecoratorSuggestion(attempted);
    return {
      category: 'SYNTAX ERROR',
      message: attempted
        ? `I don't recognize \`${attempted}\` as a valid decorator or keyword here.`
        : `I don't recognize '${found}' as a valid decorator or keyword here.`,
      hint: decoratorHint,
      regionOverride: decoratorRegion(token, attempted),
    };
  }

  // --- Generic mismatch at EOF ---
  if (isEOF) {
    const ctx = innermostContext(ruleStack);
    return {
      category: 'MISSING TOKEN',
      message: `I reached the end of the file${ctx ? ` while parsing ${ctx}` : ''}, but I was expecting \`${expectedToken}\`.`,
      hint: `The definition may be incomplete. Check that nothing is missing at the end.`,
    };
  }

  // --- Generic mismatch ---
  const humanExpected = humanizeTokenName(expectedToken);
  const mismatchCtx = innermostContext(ruleStack);
  const defType = innermostDefinition(ruleStack);
  let mismatchHint: string;
  if (defType && expectedToken === '{') {
    mismatchHint = `${capitalize(defType)} definitions need braces around their body. Example:\n\n    ${defType} MyName {\n        ...\n    }`;
  } else if (defType) {
    mismatchHint = `Check the syntax of your ${defType} definition. There may be a typo, a missing comma, or an extra token before \`${found}\`.`;
  } else if (mismatchCtx) {
    mismatchHint = `This error occurred while parsing ${mismatchCtx}. Check for typos or missing punctuation near \`${found}\`.`;
  } else {
    mismatchHint = `There may be a typo or missing punctuation near \`${found}\`.`;
  }
  return {
    category: 'SYNTAX ERROR',
    message: `I was expecting ${humanExpected} but found \`${found}\`.`,
    hint: mismatchHint,
  };
}

// ---------------------------------------------------------------------------
// NoViableAltException handler
// ---------------------------------------------------------------------------

function classifyNoViableAlt(
  found: string,
  prevImage: string,
  ruleStack: string[],
  isEOF: boolean,
  _source: string,
  _token: any
): ClassifiedError {
  // --- Missing module name (after 'module' keyword) ---
  if (ruleStack.includes('QualifiedName') && prevImage === 'module') {
    if (isEOF) {
      return {
        category: 'MISSING TOKEN',
        message: `I was expecting a module name after \`module\`, but reached the end of the file.`,
        hint: `Every module needs a name, like:\n\n    module MyApp\n    module acme.core`,
      };
    }
    return {
      category: 'SYNTAX ERROR',
      message: `I was expecting a module name after \`module\`, but found \`${found}\`.`,
      hint: `Module names must start with a letter. Example:\n\n    module MyApp\n    module acme.core`,
    };
  }

  // --- Missing entity/event/record name ---
  if (ruleStack.includes('QualifiedName') && ruleStack.includes('RecDef')) {
    const defType = ruleStack.includes('EntityDefinition')
      ? 'entity'
      : ruleStack.includes('EventDefinition')
        ? 'event'
        : ruleStack.includes('RecordDefinition')
          ? 'record'
          : 'definition';
    if (isEOF) {
      return {
        category: 'MISSING TOKEN',
        message: `I was expecting ${aOrAn(defType)} ${defType} name after \`${prevImage}\`, but reached the end of the file.`,
        hint: `Every ${defType} needs a name and a body. Example:\n\n    ${defType} My${capitalize(defType)} {\n        name String\n    }`,
      };
    }
    if (RESERVED_KEYWORDS.has(found)) {
      return {
        category: 'SYNTAX ERROR',
        message: `\`${found}\` is a reserved keyword and cannot be used as ${aOrAn(defType)} ${defType} name.`,
        hint: `Choose a different name, for example:\n\n    ${defType} My${capitalize(found)} { ... }`,
      };
    }
    return {
      category: 'SYNTAX ERROR',
      message: `I was expecting ${aOrAn(defType)} ${defType} name after \`${prevImage}\`, but found \`${found}\`.`,
      hint: `Names must start with a letter. Example:\n\n    ${defType} My${capitalize(defType)} { ... }`,
    };
  }

  // --- Missing type on attribute (found comma or '}' when parsing AttributeDefinition) ---
  if (
    (found === ',' || found === '}') &&
    ruleStack.includes('AttributeDefinition') &&
    ruleStack.includes('RecordSchemaDefinition')
  ) {
    return {
      category: 'SYNTAX ERROR',
      message: `The attribute \`${prevImage}\` is missing a type.`,
      hint: `Each attribute needs a name followed by a type. Example:\n\n    name String,\n    age Int`,
    };
  }

  // --- Colon after attribute name (coming from another language) ---
  if (
    found === ':' &&
    ruleStack.includes('AttributeDefinition') &&
    ruleStack.includes('RecordSchemaDefinition')
  ) {
    return {
      category: 'SYNTAX ERROR',
      message: `Attributes don't use colons between the name and type.`,
      hint: `Write the type directly after the name, without a colon:\n\n    name String    (not name: String)`,
    };
  }

  // --- Equals in attribute definition (coming from another language) ---
  if (
    found === '=' &&
    ruleStack.includes('AttributeDefinition') &&
    ruleStack.includes('RecordSchemaDefinition')
  ) {
    return {
      category: 'SYNTAX ERROR',
      message: `Attributes don't use \`=\` for assignment.`,
      hint: `To declare an attribute, write: \`name String\`\nTo set a default value, use: \`name String @default("value")\``,
    };
  }

  // --- Missing opening brace for entity/record/event body ---
  if (
    ruleStack.includes('RecordSchemaDefinition') &&
    !ruleStack.includes('AttributeDefinition') &&
    !isEOF &&
    found !== ',' &&
    found !== '}'
  ) {
    const defType = innermostDefinition(ruleStack) ?? 'definition';
    return {
      category: 'SYNTAX ERROR',
      message: `I was expecting \`{\` to start the ${defType} body, but found \`${found}\`.`,
      hint: `${capitalize(defType)} definitions need braces around their attributes. Example:\n\n    ${defType} MyName {\n        name String\n    }`,
    };
  }

  // --- Trailing comma (found '}' in RecordExtraDefinition context) ---
  if (found === '}' && ruleStack.includes('RecordExtraDefinition')) {
    return {
      category: 'SYNTAX ERROR',
      message: `There is a trailing comma before the closing \`}\`.`,
      hint: `Remove the comma after the last attribute:\n\n    entity E {\n        name String,\n        age Int\n    }`,
    };
  }

  // --- Double comma / unexpected comma in entity attributes ---
  if (found === ',' && ruleStack.includes('RecordExtraDefinition')) {
    return {
      category: 'SYNTAX ERROR',
      message: `I found an unexpected comma here.`,
      hint: `It looks like there may be a double comma in the attribute list, or an attribute is missing between two commas.`,
    };
  }

  // --- Unexpected token in entity attribute list (cascading from double comma) ---
  if (ruleStack.includes('RecordExtraDefinition') && !isEOF) {
    return {
      category: 'SYNTAX ERROR',
      message: `I found unexpected \`${found}\` in the attribute list.`,
      hint: `Check for double commas or missing attribute definitions. Each attribute needs a name and a type:\n\n    name String,\n    age Int`,
    };
  }

  // --- Workflow body parse failure ---
  if (ruleStack.includes('WorkflowDefinition') && ruleStack.includes('Body')) {
    return {
      category: 'SYNTAX ERROR',
      message: `I had trouble parsing the workflow body starting at \`${found}\`.`,
      hint: `Check for missing closing parentheses \`)\`, unclosed braces \`}\`, or incorrect statement syntax inside the workflow.`,
    };
  }

  // --- Reserved keyword used as workflow/agent/flow/decision name ---
  if (!isEOF && RESERVED_KEYWORDS.has(found)) {
    const nameDefRules: [string, string][] = [
      ['WorkflowDefinition', 'workflow'],
      ['AgentDefinition', 'agent'],
      ['FlowDefinition', 'flow'],
      ['DecisionDefinition', 'decision'],
    ];
    for (const [rule, defType] of nameDefRules) {
      if (
        ruleStack.includes(rule) &&
        !ruleStack.includes('Body') &&
        !ruleStack.includes('GenericDefBody') &&
        !ruleStack.includes('FlowDefBody') &&
        !ruleStack.includes('DecisionDefBody')
      ) {
        return {
          category: 'SYNTAX ERROR',
          message: `\`${found}\` is a reserved keyword and cannot be used as ${aOrAn(defType)} ${defType} name.`,
          hint: `Choose a different name, for example:\n\n    ${defType} My${capitalize(found)} { ... }`,
        };
      }
    }
  }

  // --- Definition-level failure (can't match any definition type) ---
  if (
    ruleStack.length >= 2 &&
    ruleStack[ruleStack.length - 1] === 'Definition' &&
    ruleStack[ruleStack.length - 2] === 'ModuleDefinition'
  ) {
    const keywordSuggestions = suggest(found, KNOWN_KEYWORDS);
    const suggestionText = formatSuggestions(keywordSuggestions);
    return {
      category: 'SYNTAX ERROR',
      message: `I don't recognize what kind of definition starts with \`${found}\`.`,
      hint: suggestionText
        ? suggestionText
        : `Definitions must start with a keyword like: entity, event, record, workflow, agent, flow, relationship, or a decorator like @public.`,
    };
  }

  // --- Generic NoViableAlt at EOF ---
  if (isEOF) {
    const ctx = innermostContext(ruleStack);
    return {
      category: 'MISSING TOKEN',
      message: `I reached the end of the file${ctx ? ` while parsing ${ctx}` : ''}, but I was expecting more input.`,
      hint: `The definition may be incomplete. Check that nothing is missing at the end.`,
    };
  }

  // --- Generic NoViableAlt ---
  const ctx = innermostContext(ruleStack);
  if (!isEOF && RESERVED_KEYWORDS.has(found)) {
    return {
      category: 'SYNTAX ERROR',
      message: `I got stuck on \`${found}\`${ctx ? ` while parsing ${ctx}` : ''}.`,
      hint: `\`${found}\` is a reserved keyword and cannot be used as a name. Choose a different name.`,
    };
  }
  return {
    category: 'SYNTAX ERROR',
    message: `I got stuck on \`${found}\`${ctx ? ` while parsing ${ctx}` : ''}.`,
    hint: `Check for typos, missing commas, or incorrect punctuation around this location.`,
  };
}

// ---------------------------------------------------------------------------
// Helpers for context extraction from ruleStack
// ---------------------------------------------------------------------------

/** Find the innermost "definition" rule (entity, workflow, agent, etc.) */
function innermostDefinition(ruleStack: string[]): string | undefined {
  for (let i = ruleStack.length - 1; i >= 0; i--) {
    const name = RULE_NAMES[ruleStack[i]];
    if (
      name &&
      name !== 'name' &&
      name !== 'body' &&
      name !== 'schema body' &&
      name !== 'definition' &&
      name !== 'attribute'
    ) {
      return name;
    }
  }
  return undefined;
}

/** Get a human-readable description of the innermost parsing context */
function innermostContext(ruleStack: string[]): string | undefined {
  for (let i = ruleStack.length - 1; i >= 0; i--) {
    const name = RULE_NAMES[ruleStack[i]];
    if (name && name !== 'name' && name !== 'definition') {
      return aOrAn(name) + ' ' + name;
    }
  }
  return undefined;
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Decorator suggestion helpers
// ---------------------------------------------------------------------------

/**
 * When the lexer produces a bare `@` token (because `@pubic` isn't a known
 * decorator keyword), look at the source text starting at the `@` to extract
 * the full attempted decorator string like `@pubic`.
 */
function extractDecoratorAtPosition(source: string, token: any): string | undefined {
  const line = token?.startLine;
  const col = token?.startColumn;
  if (!line || !col || isNaN(line) || isNaN(col)) return undefined;

  const lines = source.split('\n');
  const lineText = lines[line - 1];
  if (!lineText) return undefined;

  // Starting from the @ position, grab the @ and the word that follows it
  const rest = lineText.substring(col - 1); // col is 1-based
  const match = rest.match(/^@[a-zA-Z_]\w*/);
  return match ? match[0] : undefined;
}

/**
 * Expand the error region to cover the full `@xxx` text instead of just `@`.
 */
function decoratorRegion(token: any, attempted: string | undefined): ErrorRegion | undefined {
  if (!attempted || !token?.startLine || isNaN(token.startLine)) return undefined;
  return {
    startLine: token.startLine,
    startCol: token.startColumn,
    endLine: token.startLine,
    endCol: token.startColumn + attempted.length - 1,
  };
}

/**
 * Build a hint string for an unrecognized decorator, including
 * "Did you mean?" suggestions when a close match exists.
 */
function buildDecoratorSuggestion(attempted: string | undefined): string {
  if (attempted) {
    const suggestions = suggest(attempted, KNOWN_DECORATORS);
    const suggestionText = formatSuggestions(suggestions);
    if (suggestionText) {
      return suggestionText;
    }
  }
  return `Valid decorators include: @public, @id, @ref, @optional, @expr, @as, @catch, and others.\nMake sure the decorator is spelled correctly.`;
}

// ---------------------------------------------------------------------------
// Lexer error humanizer
// ---------------------------------------------------------------------------

function humanizeLexerError(raw: string): { message: string; hint?: string } {
  const charMatch = raw.match(/unexpected character:\s*(.+?)\s*at offset/i);
  if (charMatch) {
    const ch = charMatch[1].trim();
    // Chevrotain wraps chars in arrows: ->"<- — extract the inner character
    const innerMatch = ch.match(/^->(.+)<-$/);
    const actualChar = innerMatch ? innerMatch[1] : ch;
    // Unclosed string literal
    if (actualChar === '"' || actualChar === '`') {
      const quote = actualChar === '"' ? 'double' : 'backtick';
      return {
        message: `This string literal is missing its closing ${quote} quote \`${actualChar}\`.`,
        hint: `Add the matching closing \`${actualChar}\` at the end of the string. Example:\n\n    name ${actualChar}hello world${actualChar}`,
      };
    }
    return {
      message: `I found an unexpected character \`${actualChar}\` that I don't recognize.`,
      hint: `This character isn't valid in agentlang. Check for accidental keystrokes or characters copied from another source.`,
    };
  }
  return { message: raw };
}

// ---------------------------------------------------------------------------
// Token name humanizer
// ---------------------------------------------------------------------------

function humanizeTokenName(token: string): string {
  const map: Record<string, string> = {
    ID: 'a name',
    NAME: 'a name',
    INT: 'a number',
    STRING: 'a string',
    QUOTED_STRING: 'a quoted string',
    TICK_QUOTED_STRING: 'a backtick-quoted string',
    EOF: 'the end of the file',
    WS: 'whitespace',
  };
  // Punctuation tokens — show them as literals
  if (token.length <= 3 && /^[^a-zA-Z]/.test(token)) {
    return `\`${token}\``;
  }
  return map[token] ?? `\`${token}\``;
}

// ---------------------------------------------------------------------------
// Fallback humanizer
// ---------------------------------------------------------------------------

function humanizeFallback(raw: string): string {
  const msg = raw.replace(/^\w+Exception:\s*/i, '');
  const expMatch = msg.match(/Expecting[:\s]+(.+?),?\s*but found[:\s]+'([^']*)'/i);
  if (expMatch) {
    return `I was expecting ${expMatch[1].trim().toLowerCase()}, but found \`${expMatch[2]}\`.`;
  }
  return msg || 'I encountered an unexpected error while parsing.';
}

// ---------------------------------------------------------------------------
// Edit distance & suggestions ("Did you mean?")
// ---------------------------------------------------------------------------

/**
 * Restricted Damerau-Levenshtein distance between two strings.
 * Handles insertions, deletions, substitutions, and adjacent transpositions.
 * Comparison is case-insensitive.
 */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const sLen = s.length;
  const tLen = t.length;

  // Quick exits
  if (s === t) return 0;
  if (sLen === 0) return tLen;
  if (tLen === 0) return sLen;

  // Full matrix for restricted Damerau-Levenshtein
  const d: number[][] = Array.from({ length: sLen + 1 }, () => new Array(tLen + 1).fill(0));

  for (let i = 0; i <= sLen; i++) d[i][0] = i;
  for (let j = 0; j <= tLen; j++) d[0][j] = j;

  for (let i = 1; i <= sLen; i++) {
    for (let j = 1; j <= tLen; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      // Transposition
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[sLen][tLen];
}

/**
 * Find the closest matches to `input` from a list of `candidates`.
 * Returns up to `maxResults` candidates sorted by ascending distance.
 *
 * The effective max distance scales with input length to avoid noisy
 * suggestions on short inputs:
 *   length 1-3 → max 1,  length 4-6 → max 2,  length 7+ → max 3
 */
export function suggest(
  input: string,
  candidates: string[],
  maxDistance?: number,
  maxResults: number = 4
): string[] {
  if (!input) return [];
  const effectiveMax = maxDistance ?? (input.length <= 3 ? 1 : input.length <= 6 ? 2 : 3);
  const scored = candidates
    .map(c => ({ candidate: c, distance: editDistance(input, c) }))
    .filter(({ distance }) => distance > 0 && distance <= effectiveMax)
    .sort((a, b) => a.distance - b.distance);
  return scored.slice(0, maxResults).map(s => s.candidate);
}

/**
 * Format suggestion list into a hint string:
 * - 0 matches → undefined
 * - 1 match  → "Did you mean `X`?"
 * - 2+ matches → "These names seem close:\n    X\n    Y"
 */
export function formatSuggestions(suggestions: string[]): string | undefined {
  if (suggestions.length === 0) return undefined;
  if (suggestions.length === 1) return `Did you mean \`${suggestions[0]}\`?`;
  const list = suggestions.map(s => `    ${s}`).join('\n');
  return `These names seem close though:\n\n${list}`;
}

// ---------------------------------------------------------------------------
// Known keywords for suggestion matching
// ---------------------------------------------------------------------------

/** Top-level definition keywords in agentlang */
export const KNOWN_KEYWORDS = [
  'entity',
  'event',
  'record',
  'workflow',
  'agent',
  'flow',
  'relationship',
  'resolver',
  'scenario',
  'directive',
  'glossaryEntry',
  'eval',
  'decision',
  'import',
  'module',
];

/**
 * All grammar keywords that conflict with identifier (ID) positions.
 * When a user writes e.g. `entity query { ... }`, the lexer tokenizes `query`
 * as a keyword token instead of ID, causing a confusing parse error.
 * This set lets us detect that case and produce a clear message.
 */
export const RESERVED_KEYWORDS = new Set([
  // Top-level definition keywords
  ...KNOWN_KEYWORDS,
  // Control flow
  'if',
  'else',
  'for',
  'in',
  'return',
  'throw',
  'await',
  // CRUD / resolver operations
  'create',
  'update',
  'delete',
  'read',
  'query',
  'purge',
  'upsert',
  // Logical / boolean
  'true',
  'false',
  'not',
  'or',
  'and',
  // Schema / relationship
  'extends',
  'contains',
  'between',
  // Decision / case
  'case',
  // RBAC
  'roles',
  'allow',
  'where',
  // SQL-like
  'like',
  // Misc
  'backoff',
  'attempts',
  'subscribe',
]);

// ---------------------------------------------------------------------------
// Snippet renderer – show source context with ^^^ underlines
// ---------------------------------------------------------------------------

export function renderSnippet(
  source: string,
  region: ErrorRegion,
  contextLines: number = 2
): string {
  const lines = source.split('\n');
  const totalLines = lines.length;

  // Compute visible line range (1-based internally, but array is 0-based)
  const firstVisible = Math.max(1, region.startLine - contextLines);
  const lastVisible = Math.min(totalLines, region.endLine + contextLines);

  // Width of the widest line number for alignment
  const gutterWidth = String(lastVisible).length;

  const output: string[] = [];

  for (let lineNum = firstVisible; lineNum <= lastVisible; lineNum++) {
    const lineText = lines[lineNum - 1] ?? '';
    const numStr = String(lineNum).padStart(gutterWidth);
    const isErrorLine = lineNum >= region.startLine && lineNum <= region.endLine;
    const prefix = isErrorLine ? `${numStr} | ` : `${numStr} | `;

    output.push(`${prefix}${lineText}`);

    // Add underline on error lines
    if (isErrorLine) {
      const underlineStart = lineNum === region.startLine ? region.startCol : 1;
      const underlineEnd = lineNum === region.endLine ? region.endCol : lineText.length;
      const caretCount = Math.max(1, underlineEnd - underlineStart + 1);
      const padding = ' '.repeat(gutterWidth) + '   ' + ' '.repeat(underlineStart - 1);
      output.push(`${padding}${'~'.repeat(caretCount)}`);
    }
  }

  return output.join('\n');
}

// ---------------------------------------------------------------------------
// Error formatter
// ---------------------------------------------------------------------------

const SEPARATOR_WIDTH = 60;

function header(category: ErrorCategory, file: string): string {
  const left = `-- ${category} `;
  const right = ` ${file}`;
  const dashCount = Math.max(3, SEPARATOR_WIDTH - left.length - right.length);
  return `${left}${'-'.repeat(dashCount)}${right}`;
}

export function formatError(err: AgentlangError, source: string): string {
  const parts: string[] = [];

  // 1. Header
  parts.push(header(err.category, err.file));
  parts.push('');

  // 2. Message
  parts.push(err.message);
  parts.push('');

  // 3. Source snippet
  parts.push(renderSnippet(source, err.region));

  // 4. Hint
  if (err.hint) {
    parts.push('');
    parts.push(`Hint: ${err.hint}`);
  }

  return parts.join('\n');
}

export function formatErrors(errors: AgentlangError[], source: string): string {
  if (errors.length === 0) return '';
  // Show only the first error to avoid cascading noise
  // but include up to 3 for genuinely independent errors.
  const toShow = deduplicateErrors(errors).slice(0, 3);
  return toShow.map(err => formatError(err, source)).join('\n\n');
}

// ---------------------------------------------------------------------------
// Deduplication – avoid cascading / duplicate errors on the same line
// ---------------------------------------------------------------------------

function deduplicateErrors(errors: AgentlangError[]): AgentlangError[] {
  const seen = new Set<number>();
  const result: AgentlangError[] = [];
  for (const err of errors) {
    if (!seen.has(err.region.startLine)) {
      seen.add(err.region.startLine);
      result.push(err);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main entry point – collect + format from a LangiumDocument
// ---------------------------------------------------------------------------

export function getFormattedErrors(document: LangiumDocument): string | undefined {
  const errors = collectErrors(document);
  if (errors.length === 0) return undefined;
  const source = document.textDocument.getText();
  return formatErrors(errors, source);
}
