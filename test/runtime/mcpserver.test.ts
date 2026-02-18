import { assert, describe, test } from 'vitest';
import {
  AttributeSpec,
  RecordSchema,
} from '../../src/runtime/module.js';
import { doInternModule } from '../util.js';
import {
  recordSchemaToJsonSchema,
  getExposedEvents,
  getExposedEntities,
  evaluateEvent,
  queryEntity,
  verifyAuth,
  extractBearerToken,
} from '../../src/api/handlers.js';
import { BypassSession, isNoSession } from '../../src/runtime/auth/defs.js';
import { AppConfig, ConfigSchema, setAppConfig } from '../../src/runtime/state.js';

// ---- Schema conversion tests ----

describe('recordSchemaToJsonSchema', () => {
  test('basic type mapping', () => {
    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('name', { type: 'String' });
    schema.set('age', { type: 'Int' });
    schema.set('score', { type: 'Number' });
    schema.set('active', { type: 'Boolean' });

    const result = recordSchemaToJsonSchema(schema);
    assert.equal(result.type, 'object');
    assert.deepEqual(result.properties.name, { type: 'string' });
    assert.deepEqual(result.properties.age, { type: 'integer' });
    assert.deepEqual(result.properties.score, { type: 'number' });
    assert.deepEqual(result.properties.active, { type: 'boolean' });
    assert.deepEqual(result.required, ['name', 'age', 'score', 'active']);
  });

  test('format types', () => {
    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('email', { type: 'Email' });
    schema.set('created', { type: 'DateTime' });
    schema.set('id', { type: 'UUID' });
    schema.set('link', { type: 'URL' });

    const result = recordSchemaToJsonSchema(schema);
    assert.deepEqual(result.properties.email, { type: 'string', format: 'email' });
    assert.deepEqual(result.properties.created, { type: 'string', format: 'date-time' });
    assert.deepEqual(result.properties.id, { type: 'string', format: 'uuid' });
    assert.deepEqual(result.properties.link, { type: 'string', format: 'uri' });
  });

  test('optional attributes are excluded from required', () => {
    const optProps = new Map<string, any>();
    optProps.set('optional', true);

    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('name', { type: 'String' });
    schema.set('nickname', { type: 'String', properties: optProps });

    const result = recordSchemaToJsonSchema(schema);
    assert.deepEqual(result.required, ['name']);
  });

  test('attributes with @default are excluded from required', () => {
    const defProps = new Map<string, any>();
    defProps.set('default', 'hello');

    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('name', { type: 'String' });
    schema.set('greeting', { type: 'String', properties: defProps });

    const result = recordSchemaToJsonSchema(schema);
    assert.deepEqual(result.required, ['name']);
  });

  test('enum attributes', () => {
    const enumProps = new Map<string, any>();
    enumProps.set('enum', new Set(['RED', 'GREEN', 'BLUE']));

    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('color', { type: 'String', properties: enumProps });

    const result = recordSchemaToJsonSchema(schema);
    assert.deepEqual(result.properties.color.enum, ['RED', 'GREEN', 'BLUE']);
  });

  test('array attributes', () => {
    const arrayProps = new Map<string, any>();
    arrayProps.set('array', true);

    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('tags', { type: 'String', properties: arrayProps });

    const result = recordSchemaToJsonSchema(schema);
    assert.deepEqual(result.properties.tags, { type: 'array', items: { type: 'string' } });
  });

  test('empty schema', () => {
    const schema: RecordSchema = new Map<string, AttributeSpec>();
    const result = recordSchemaToJsonSchema(schema);
    assert.equal(result.type, 'object');
    assert.deepEqual(result.properties, {});
    assert.equal(result.required, undefined);
  });

  test('Map and Any types', () => {
    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('data', { type: 'Map' });
    schema.set('extra', { type: 'Any' });

    const result = recordSchemaToJsonSchema(schema);
    assert.deepEqual(result.properties.data, { type: 'object' });
    assert.deepEqual(result.properties.extra, {});
  });

  test('unknown type defaults to object', () => {
    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('custom', { type: 'SomeCustomType' });

    const result = recordSchemaToJsonSchema(schema);
    assert.deepEqual(result.properties.custom, { type: 'object' });
  });

  test('Float and Decimal map to number', () => {
    const schema: RecordSchema = new Map<string, AttributeSpec>();
    schema.set('price', { type: 'Float' });
    schema.set('amount', { type: 'Decimal' });

    const result = recordSchemaToJsonSchema(schema);
    assert.deepEqual(result.properties.price, { type: 'number' });
    assert.deepEqual(result.properties.amount, { type: 'number' });
  });
});

// ---- Config schema tests ----

describe('MCP config schema', () => {
  test('accepts valid MCP config', () => {
    const config = ConfigSchema.parse({
      mcp: {
        enabled: true,
        path: '/my-mcp',
        name: 'test-server',
        version: '2.0.0',
      },
    });
    assert.equal(config.mcp?.enabled, true);
    assert.equal(config.mcp?.path, '/my-mcp');
    assert.equal(config.mcp?.name, 'test-server');
    assert.equal(config.mcp?.version, '2.0.0');
  });

  test('applies defaults for MCP config', () => {
    const config = ConfigSchema.parse({
      mcp: {},
    });
    assert.equal(config.mcp?.enabled, false);
    assert.equal(config.mcp?.path, '/mcp');
    assert.equal(config.mcp?.name, undefined);
    assert.equal(config.mcp?.version, undefined);
  });

  test('MCP config is optional', () => {
    const config = ConfigSchema.parse({});
    assert.equal(config.mcp, undefined);
  });

  test('accepts instructions, stateless, and enableJsonResponse', () => {
    const config = ConfigSchema.parse({
      mcp: {
        enabled: true,
        instructions: 'Use tools to manage tasks',
        stateless: true,
        enableJsonResponse: true,
      },
    });
    assert.equal(config.mcp?.instructions, 'Use tools to manage tasks');
    assert.equal(config.mcp?.stateless, true);
    assert.equal(config.mcp?.enableJsonResponse, true);
  });

  test('applies defaults for new config options', () => {
    const config = ConfigSchema.parse({
      mcp: {},
    });
    assert.equal(config.mcp?.instructions, undefined);
    assert.equal(config.mcp?.stateless, false);
    assert.equal(config.mcp?.enableJsonResponse, false);
  });
});

// ---- Integration tests with module ----

describe('MCP exposed endpoints', () => {
  test('public events are exposed', async () => {
    await doInternModule(
      'McpTest1',
      `
      entity Item {
        id Int @id,
        name String
      }
      @public event CreateItem {
        name String
      }
      workflow CreateItem {
        { Item { name CreateItem.name } }
      }
      `
    );

    const events = getExposedEvents();
    const mcpEvent = events.find(e => e.moduleName === 'McpTest1' && e.name === 'CreateItem');
    assert(mcpEvent !== undefined, 'CreateItem event should be exposed');
    assert.equal(mcpEvent!.fqName, 'McpTest1/CreateItem');
    assert(mcpEvent!.schema.has('name'), 'Schema should include name attribute');
  });

  test('entities are exposed', async () => {
    await doInternModule(
      'McpTest2',
      `
      entity Product {
        id Int @id,
        title String,
        price Decimal
      }
      `
    );

    const entities = getExposedEntities();
    const entity = entities.find(e => e.moduleName === 'McpTest2' && e.name === 'Product');
    assert(entity !== undefined, 'Product entity should be exposed');
    assert.equal(entity!.fqName, 'McpTest2/Product');
  });
});

describe('MCP tool execution', () => {
  test('evaluateEvent creates entity via event', async () => {
    await doInternModule(
      'McpToolTest',
      `
      entity Task {
        taskId Int @id,
        title String
      }
      @public event AddTask {
        taskId Int,
        title String
      }
      workflow AddTask {
        { Task { taskId AddTask.taskId, title AddTask.title } }
      }
      `
    );

    const result = await evaluateEvent(
      'McpToolTest',
      'AddTask',
      { taskId: 1, title: 'Test Task' },
      BypassSession
    );
    assert(result !== null && result !== undefined, 'evaluateEvent should return a result');
  });

  test('queryEntity returns entities', async () => {
    await doInternModule(
      'McpQueryTest',
      `
      entity Note {
        id Int @id,
        content String
      }
      `
    );

    // Query empty table — should succeed (even if result is empty)
    const result = await queryEntity('McpQueryTest', 'Note', undefined, BypassSession);
    assert(result !== undefined, 'queryEntity should return a result');
  });
});

describe('recordSchemaToJsonSchema with real module', () => {
  test('converts event user attributes to JSON schema', async () => {
    await doInternModule(
      'McpSchemaTest',
      `
      entity Order {
        id Int @id,
        item String,
        quantity Int,
        price Decimal
      }
      @public event PlaceOrder {
        item String,
        quantity Int,
        price Decimal
      }
      workflow PlaceOrder {
        { Order { item PlaceOrder.item, quantity PlaceOrder.quantity, price PlaceOrder.price } }
      }
      `
    );

    const events = getExposedEvents();
    const event = events.find(e => e.name === 'PlaceOrder');
    assert(event !== undefined);

    const jsonSchema = recordSchemaToJsonSchema(event!.schema);
    assert.equal(jsonSchema.type, 'object');
    assert(jsonSchema.properties.item !== undefined, 'Should have item property');
    assert(jsonSchema.properties.quantity !== undefined, 'Should have quantity property');
    assert(jsonSchema.properties.price !== undefined, 'Should have price property');
    assert.deepEqual(jsonSchema.properties.item, { type: 'string' });
    assert.deepEqual(jsonSchema.properties.quantity, { type: 'integer' });
    assert.deepEqual(jsonSchema.properties.price, { type: 'number' });
  });
});

// ---- Auth tests ----

describe('extractBearerToken', () => {
  test('extracts token from Bearer prefix', () => {
    assert.equal(extractBearerToken('Bearer abc123'), 'abc123');
  });

  test('extracts token from other prefix', () => {
    assert.equal(extractBearerToken('Token xyz789'), 'xyz789');
  });

  test('returns plain string when no prefix', () => {
    assert.equal(extractBearerToken('plaintoken'), 'plaintoken');
  });

  test('trims whitespace', () => {
    assert.equal(extractBearerToken('Bearer   spaced  '), 'spaced');
  });
});

describe('verifyAuth', () => {
  test('returns BypassSession when auth is disabled', async () => {
    // Auth is disabled by default in test environment (no auth config)
    const result = await verifyAuth('SomeModule', 'SomeEvent', undefined);
    assert(result === BypassSession, 'Should return BypassSession when auth is disabled');
  });

  test('returns BypassSession when auth is disabled even with token', async () => {
    const result = await verifyAuth('SomeModule', 'SomeEvent', 'Bearer sometoken');
    assert(result === BypassSession, 'Should return BypassSession when auth is disabled');
  });

  test('returns NoSession when auth is enabled but no token provided', async () => {
    const savedConfig = AppConfig;
    try {
      setAppConfig(ConfigSchema.parse({ auth: { enabled: true } }));
      const result = await verifyAuth('SomeModule', 'SomeEvent', undefined);
      assert(isNoSession(result), 'Should return NoSession when auth enabled and no token');
    } finally {
      // Restore original config
      if (savedConfig) {
        setAppConfig(savedConfig);
      } else {
        // Reset to default
        setAppConfig(ConfigSchema.parse({}));
      }
    }
  });

  test('returns BypassSession for public auth events even when auth is enabled', async () => {
    const savedConfig = AppConfig;
    try {
      setAppConfig(ConfigSchema.parse({ auth: { enabled: true } }));
      // 'agentlang.auth' + 'login' is a public auth event that is exempt
      const result = await verifyAuth('agentlang.auth', 'login', undefined);
      assert(
        result === BypassSession,
        'Should return BypassSession for public auth events'
      );
    } finally {
      if (savedConfig) {
        setAppConfig(savedConfig);
      } else {
        setAppConfig(ConfigSchema.parse({}));
      }
    }
  });
});
