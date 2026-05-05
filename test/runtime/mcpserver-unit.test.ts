import { assert, describe, test, beforeAll } from 'vitest';
import { __test__ } from '../../src/runtime/mcpserver.js';
import { doInternModule } from '../util.js';

const {
  fqToolName,
  parseToolName,
  metaDescription,
  attributeToJsonSchema,
  jsonSchemaForType,
  formatLiteral,
  buildAttrPattern,
  listEventTools,
  listEntityTools,
  listEntityResources,
  isExposeOn,
  searchToolDef,
  searchAvailableTools,
  scoreTool,
  SEARCH_TOOL_NAME,
} = __test__;

// ──────────────────────────────────────────────────────────────────
// fqToolName / parseToolName round-trip
// ──────────────────────────────────────────────────────────────────

describe('fqToolName / parseToolName', () => {
  test('builds module__entry and parses back', () => {
    const n = fqToolName('blog', 'CreatePost');
    assert.equal(n, 'blog__CreatePost');
    const parsed = parseToolName(n);
    assert.equal(parsed.moduleName, 'blog');
    assert.equal(parsed.entryName, 'CreatePost');
    assert.equal(parsed.suffix, undefined);
  });

  test('builds module__entry__suffix and parses back', () => {
    const n = fqToolName('blog', 'Post', 'create');
    assert.equal(n, 'blog__Post__create');
    const parsed = parseToolName(n);
    assert.equal(parsed.moduleName, 'blog');
    assert.equal(parsed.entryName, 'Post');
    assert.equal(parsed.suffix, 'create');
  });

  test('rejects single-segment names', () => {
    assert.throws(() => parseToolName('orphan'));
  });

  test('multi-segment suffix is preserved', () => {
    const parsed = parseToolName('m__E__a__b');
    assert.equal(parsed.moduleName, 'm');
    assert.equal(parsed.entryName, 'E');
    assert.equal(parsed.suffix, 'a__b');
  });
});

// ──────────────────────────────────────────────────────────────────
// metaDescription
// ──────────────────────────────────────────────────────────────────

describe('metaDescription', () => {
  test('returns fallback when meta missing', () => {
    assert.equal(metaDescription(undefined, 'fb'), 'fb');
  });

  test('returns fallback when meta has no doc-like keys', () => {
    const m = new Map<string, any>([['unrelated', 'value']]);
    assert.equal(metaDescription(m, 'fb'), 'fb');
  });

  test('prefers doc, then description, then comment', () => {
    const a = new Map<string, any>([['doc', 'D']]);
    assert.equal(metaDescription(a, 'fb'), 'D');
    const b = new Map<string, any>([['description', 'X']]);
    assert.equal(metaDescription(b, 'fb'), 'X');
    const c = new Map<string, any>([['comment', 'C']]);
    assert.equal(metaDescription(c, 'fb'), 'C');
    const both = new Map<string, any>([
      ['doc', 'D'],
      ['description', 'X'],
    ]);
    assert.equal(metaDescription(both, 'fb'), 'D');
  });

  test('ignores empty/whitespace doc value', () => {
    const m = new Map<string, any>([['doc', '   ']]);
    assert.equal(metaDescription(m, 'fb'), 'fb');
  });
});

// ──────────────────────────────────────────────────────────────────
// jsonSchemaForType
// ──────────────────────────────────────────────────────────────────

describe('jsonSchemaForType', () => {
  test('textual types map to string', () => {
    for (const t of ['String', 'Email', 'UUID', 'URL', 'Path', 'Password']) {
      assert.deepEqual(jsonSchemaForType(t, false), { type: 'string' });
    }
  });

  test('Date / Time / DateTime carry format', () => {
    assert.deepEqual(jsonSchemaForType('Date', false), { type: 'string', format: 'date' });
    assert.deepEqual(jsonSchemaForType('Time', false), { type: 'string', format: 'time' });
    assert.deepEqual(jsonSchemaForType('DateTime', false), {
      type: 'string',
      format: 'date-time',
    });
  });

  test('numeric types', () => {
    assert.deepEqual(jsonSchemaForType('Int', false), { type: 'integer' });
    for (const t of ['Number', 'Float', 'Decimal']) {
      assert.deepEqual(jsonSchemaForType(t, false), { type: 'number' });
    }
  });

  test('Boolean / Map / Any', () => {
    assert.deepEqual(jsonSchemaForType('Boolean', false), { type: 'boolean' });
    assert.deepEqual(jsonSchemaForType('Map', false), {
      type: 'object',
      additionalProperties: true,
    });
    assert.deepEqual(jsonSchemaForType('Any', false), {});
  });

  test('unknown type defaults to string, or object when isObject=true', () => {
    assert.deepEqual(jsonSchemaForType('Custom', false), { type: 'string' });
    assert.deepEqual(jsonSchemaForType('Custom', true), {
      type: 'object',
      additionalProperties: true,
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// attributeToJsonSchema
// ──────────────────────────────────────────────────────────────────

describe('attributeToJsonSchema', () => {
  test('non-array primitive', () => {
    assert.deepEqual(attributeToJsonSchema({ type: 'String' } as any), { type: 'string' });
  });

  test('array wraps inner schema', () => {
    const props = new Map<string, any>([['array', true]]);
    assert.deepEqual(attributeToJsonSchema({ type: 'Int', properties: props } as any), {
      type: 'array',
      items: { type: 'integer' },
    });
  });

  test('enum populates values', () => {
    const props = new Map<string, any>([['enum', new Set(['a', 'b', 'c'])]]);
    const schema = attributeToJsonSchema({ type: 'String', properties: props } as any);
    assert.equal(schema.type, 'string');
    assert.deepEqual([...schema.enum].sort(), ['a', 'b', 'c']);
  });

  test('empty enum set is not emitted', () => {
    const props = new Map<string, any>([['enum', new Set()]]);
    const schema = attributeToJsonSchema({ type: 'String', properties: props } as any);
    assert.isUndefined(schema.enum);
  });

  test('object-marked custom type', () => {
    const props = new Map<string, any>([['object', true]]);
    assert.deepEqual(attributeToJsonSchema({ type: 'Custom', properties: props } as any), {
      type: 'object',
      additionalProperties: true,
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// formatLiteral / buildAttrPattern
// ──────────────────────────────────────────────────────────────────

describe('formatLiteral', () => {
  test('strings are quoted and embedded quotes escaped', () => {
    assert.equal(formatLiteral('hi'), '"hi"');
    assert.equal(formatLiteral('a"b'), '"a\\"b"');
  });

  test('numbers and booleans are bare', () => {
    assert.equal(formatLiteral(42), '42');
    assert.equal(formatLiteral(true), 'true');
    assert.equal(formatLiteral(false), 'false');
  });

  test('null / undefined become null', () => {
    assert.equal(formatLiteral(null), 'null');
    assert.equal(formatLiteral(undefined), 'null');
  });

  test('arrays and objects are JSON', () => {
    assert.equal(formatLiteral([1, 2]), '[1,2]');
    assert.equal(formatLiteral({ a: 1 }), '{"a":1}');
  });
});

describe('buildAttrPattern', () => {
  test('mutation style uses no ?', () => {
    assert.equal(buildAttrPattern({ id: 1, name: 'Alice' }, false), '{id 1, name "Alice"}');
  });

  test('query style uses ?', () => {
    assert.equal(buildAttrPattern({ id: 1 }, true), '{id? 1}');
  });

  test('empty args yield empty braces', () => {
    assert.equal(buildAttrPattern({}, false), '{}');
  });
});

// ──────────────────────────────────────────────────────────────────
// isExposeOn
// ──────────────────────────────────────────────────────────────────

describe('isExposeOn', () => {
  test('default-on when no expose block', () => {
    assert.isTrue(isExposeOn(undefined, 'events'));
    assert.isTrue(isExposeOn({} as any, 'events'));
    assert.isTrue(isExposeOn({ mcpServer: {} } as any, 'entities'));
  });

  test('respects explicit false', () => {
    const cfg = {
      mcpServer: { expose: { events: false, entities: true, resources: true } },
    } as any;
    assert.isFalse(isExposeOn(cfg, 'events'));
    assert.isTrue(isExposeOn(cfg, 'entities'));
    assert.isTrue(isExposeOn(cfg, 'resources'));
  });
});

// ──────────────────────────────────────────────────────────────────
// recordToInputSchema / listEventTools / listEntityTools / resources
// (these need a live module, so set one up first)
// ──────────────────────────────────────────────────────────────────

describe('schema/listing helpers (live module)', () => {
  beforeAll(async () => {
    await doInternModule(
      'McpUnit',
      `entity Widget {
        id Int @id,
        name String,
        price Float,
        active Boolean,
        tags String @array,
        kind String @enum("small", "large")
      }

      @public event PingWidget {
        name String,
        count Int
      }

      event PrivatePing {
        name String
      }`
    );
  });

  test('recordToInputSchema marks all non-optional, non-default attrs as required', () => {
    const tools = listEntityTools();
    const create = tools.find(t => t.name === 'McpUnit__Widget__create');
    assert.ok(create, 'expected Widget__create tool');
    const sch = create!.inputSchema;
    assert.equal(sch.type, 'object');
    assert.ok(Array.isArray(sch.required));
    for (const a of ['id', 'name', 'price', 'active', 'tags', 'kind']) {
      assert.include(sch.required, a, `expected ${a} to be required`);
    }
    assert.deepEqual(sch.properties.id, { type: 'integer' });
    assert.deepEqual(sch.properties.name, { type: 'string' });
    assert.deepEqual(sch.properties.price, { type: 'number' });
    assert.deepEqual(sch.properties.active, { type: 'boolean' });
    assert.deepEqual(sch.properties.tags, { type: 'array', items: { type: 'string' } });
    assert.equal(sch.properties.kind.type, 'string');
    assert.deepEqual([...sch.properties.kind.enum].sort(), ['large', 'small']);
  });

  test('list tool input schema is permissive (all attrs included, no required block)', () => {
    const tools = listEntityTools();
    const list = tools.find(t => t.name === 'McpUnit__Widget__list');
    assert.ok(list);
    assert.isUndefined(list!.inputSchema.required);
    assert.ok(list!.inputSchema.properties.name);
  });

  test('get/delete schemas require id', () => {
    const tools = listEntityTools();
    const g = tools.find(t => t.name === 'McpUnit__Widget__get');
    const d = tools.find(t => t.name === 'McpUnit__Widget__delete');
    assert.ok(g && d);
    assert.deepEqual(g!.inputSchema.required, ['id']);
    assert.deepEqual(d!.inputSchema.required, ['id']);
  });

  test('listEventTools includes only @public events', () => {
    const tools = listEventTools();
    const names = tools.map(t => t.name);
    assert.include(names, 'McpUnit__PingWidget');
    assert.notInclude(names, 'McpUnit__PrivatePing');
  });

  test('listEventTools input schema reflects event attributes', () => {
    const ping = listEventTools().find(t => t.name === 'McpUnit__PingWidget')!;
    assert.deepEqual(ping.inputSchema.properties.name, { type: 'string' });
    assert.deepEqual(ping.inputSchema.properties.count, { type: 'integer' });
    assert.includeMembers(ping.inputSchema.required, ['name', 'count']);
  });

  test('listEntityResources emits agentlang:// URIs', () => {
    const res = listEntityResources();
    const widget = res.find(r => r.name === 'McpUnit/Widget');
    assert.ok(widget, 'expected Widget resource');
    assert.equal(widget!.uri, 'agentlang://McpUnit/Widget');
  });
});

// ──────────────────────────────────────────────────────────────────
// search-tools tool
// ──────────────────────────────────────────────────────────────────

describe('search-tools tool', () => {
  beforeAll(async () => {
    await doInternModule(
      'McpSearch',
      `entity Customer {
        id Int @id,
        name String,
        email Email
      }

      @public event SendInvoice {
        customerId Int,
        amount Float
      }

      workflow SendInvoice {
        SendInvoice.amount
      }`
    );
  });

  test('searchToolDef has the reserved name and a usable schema', () => {
    const t = searchToolDef();
    assert.equal(t.name, SEARCH_TOOL_NAME);
    assert.equal(t.name, 'agentlang_search_tools');
    assert.equal(t.inputSchema.type, 'object');
    assert.deepEqual(t.inputSchema.required, ['query']);
    assert.ok(t.inputSchema.properties.query);
    assert.ok(t.inputSchema.properties.limit);
    assert.equal(t.inputSchema.properties.kind.type, 'string');
    assert.includeMembers(t.inputSchema.properties.kind.enum, ['any', 'event', 'entity']);
  });

  test('scoreTool weights exact entry name above substring matches', () => {
    const exact = {
      name: 'McpSearch__Customer__create',
      description: 'Create a McpSearch/Customer record.',
      inputSchema: {},
    } as any;
    const partial = {
      name: 'McpSearch__SendInvoice',
      description: 'Send an invoice to a customer.',
      inputSchema: {},
    } as any;
    const exactScore = scoreTool(exact, 'entity', ['Customer']);
    const partialScore = scoreTool(partial, 'event', ['Customer']);
    assert.isAbove(
      exactScore,
      partialScore,
      `exact entry-name match (${exactScore}) should beat substring (${partialScore})`
    );
  });

  test('scoreTool returns 0 when no terms match', () => {
    const t = {
      name: 'McpSearch__Customer__create',
      description: 'Create a record',
      inputSchema: {},
    } as any;
    assert.equal(scoreTool(t, 'entity', ['nothing-matches-this-zzz']), 0);
  });

  test('searchAvailableTools finds entity CRUD by entity name', () => {
    const { matches } = searchAvailableTools('Customer', 20, 'any', undefined);
    assert.isAbove(matches.length, 0);
    const top = matches[0];
    assert.match(top.name, /McpSearch__Customer/);
  });

  test('searchAvailableTools finds events by description keyword', () => {
    const { matches } = searchAvailableTools('invoice', 20, 'any', undefined);
    const names = matches.map(m => m.name);
    assert.include(names, 'McpSearch__SendInvoice');
  });

  test('searchAvailableTools respects kind=event', () => {
    const { matches } = searchAvailableTools('Customer', 20, 'event', undefined);
    for (const m of matches) {
      assert.equal(m.kind, 'event', `expected only events, got ${m.name}`);
    }
  });

  test('searchAvailableTools respects kind=entity', () => {
    const { matches } = searchAvailableTools('McpSearch', 20, 'entity', undefined);
    for (const m of matches) {
      assert.equal(m.kind, 'entity', `expected only entities, got ${m.name}`);
    }
  });

  test('searchAvailableTools respects expose toggles', () => {
    const cfgEventsOff = {
      mcpServer: { expose: { events: false, entities: true, resources: true } },
    } as any;
    const { matches } = searchAvailableTools('Customer', 20, 'any', cfgEventsOff);
    for (const m of matches) {
      assert.notEqual(m.kind, 'event', `events should be filtered out, got ${m.name}`);
    }
  });

  test('searchAvailableTools clamps limit', () => {
    const big = searchAvailableTools('Customer', 5000, 'any', undefined);
    assert.isAtMost(big.matches.length, 100);
    const tiny = searchAvailableTools('Customer', 0, 'any', undefined);
    assert.isAtMost(tiny.matches.length, 1);
  });

  test('searchAvailableTools returns empty matches for empty query', () => {
    const { matches } = searchAvailableTools('', 20, 'any', undefined);
    assert.equal(matches.length, 0);
  });

  test('matches are sorted by score descending', () => {
    const { matches } = searchAvailableTools('Customer create', 20, 'any', undefined);
    for (let i = 1; i < matches.length; i++) {
      assert.isAtLeast(
        matches[i - 1].score,
        matches[i].score,
        `match ${i - 1} should score >= match ${i}`
      );
    }
  });
});
