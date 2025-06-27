import { z } from 'zod/v4';
import yaml from 'yaml';
import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { getUserModuleNames, fetchModule, Entity, Event } from '../runtime/module.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

function getOpenApiDocumentation(registry: OpenAPIRegistry, name: string, version: string) {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: version,
      title: name,
      description: 'This is the API',
    },
    servers: [{ url: 'v1' }],
  });
}

function writeDocumentation(
  registry: OpenAPIRegistry,
  docDir: string,
  name: string,
  version: string
) {
  const docs = getOpenApiDocumentation(registry, name, version);
  const fileContent = yaml.stringify(docs);
  fs.mkdir(path.join(docDir, 'docs'), { recursive: true });
  fs.writeFile(`${docDir}/docs/openapidocs.yml`, fileContent, {
    encoding: 'utf-8',
  });
}

function generateEntitiesEntries() {
  const modules = getUserModuleNames();
  return modules.map((moduleName: string) => {
    const module = fetchModule(moduleName);
    const entities = module.getEntityEntries();
    return entities.map((entity: Entity) => {
      const entityPath = `${moduleName}/${entity.name}`;
      const entitySchema = z
        .object(
          Object.fromEntries(
            Array.from(entity.schema.entries()).map(([key, value]) => [
              key,
              value.type === 'UUID'
                ? z.uuid()
                : value.type === 'String'
                  ? z.string()
                  : value.type === 'Int'
                    ? z.number()
                    : value.type === 'Float'
                      ? z.number()
                      : value.type === 'Boolean'
                        ? z.boolean()
                        : value.type === 'Date'
                          ? z.string()
                          : value.type === 'DateTime'
                            ? z.string()
                            : z.any(),
            ])
          )
        )
        .openapi(`${entity.name}Schema`);
      const sc = z.object({
        [entityPath]: entitySchema,
      });
      const scresp = z.array(entitySchema);
      registry.registerPath({
        method: 'post',
        path: `/api/${entityPath}`,
        security: [{ [bearerAuth.name]: [] }],
        tags: [`${entityPath}`],
        request: {
          body: {
            content: {
              'application/json': {
                schema: sc,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Success',
            content: {
              'application/json': {
                schema: entitySchema,
              },
            },
          },
          500: {
            description: 'Internal Server Error',
          },
        },
      });

      registry.registerPath({
        method: 'get',
        path: `/api/${entityPath}`,
        security: [{ [bearerAuth.name]: [] }],
        tags: [`${entityPath}`],
        responses: {
          200: {
            description: 'Success',
            content: {
              'application/json': {
                schema: scresp,
              },
            },
          },
          404: {
            description: 'Not Found',
          },
          500: {
            description: 'Internal Server Error',
          },
        },
      });

      registry.registerPath({
        method: 'put',
        path: `/api/${entityPath}/{id}`,
        tags: [`${entityPath}`],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        security: [{ [bearerAuth.name]: [] }],
        request: {
          body: {
            content: {
              'application/json': {
                schema: sc,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Success',
            content: {
              'application/json': {
                schema: entitySchema,
              },
            },
          },
          404: {
            description: 'Not Found',
          },
          500: {
            description: 'Internal Server Error',
          },
        },
      });

      registry.registerPath({
        method: 'delete',
        path: `/api/${entityPath}/{id}`,
        security: [{ [bearerAuth.name]: [] }],
        tags: [`${entityPath}`],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Success',
          },
          404: {
            description: 'Not Found',
          },
          500: {
            description: 'Internal Server Error',
          },
        },
      });
    });
  });
}

function generateEventsEntries() {
  const modules = getUserModuleNames();
  return modules.map((moduleName: string) => {
    const module = fetchModule(moduleName);
    const events = module.getEventEntries();
    return events.map((event: Event) => {
      const eventPath = `${moduleName}/${event.name}`;

      const eventSchema = z
        .object(
          Object.fromEntries(
            Array.from(event.schema.entries()).map(([key, value]) => [
              key,
              value.type === 'UUID'
                ? z.uuid()
                : value.type === 'String'
                  ? z.string()
                  : value.type === 'Int'
                    ? z.number()
                    : value.type === 'Float'
                      ? z.number()
                      : value.type === 'Boolean'
                        ? z.boolean()
                        : value.type === 'Date'
                          ? z.string()
                          : value.type === 'DateTime'
                            ? z.string()
                            : z.any(),
            ])
          )
        )
        .openapi(`${event.name}Schema`);

      const sc = z.object({
        [eventPath]: eventSchema,
      });

      registry.registerPath({
        method: 'post',
        path: `/api/${eventPath}`,
        security: [{ [bearerAuth.name]: [] }],
        tags: ['Events'],
        request: {
          body: {
            content: {
              'application/json': {
                schema: sc,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Success',
          },
          404: {
            description: 'Not Found',
          },
          500: {
            description: 'Internal Server Error',
          },
        },
      });

      return {
        path: eventPath,
        name: event.name,
        schema: event.schema,
      };
    });
  });
}

export const generateSwaggerDoc = async (fileName: string): Promise<void> => {
  console.log('Generating documentation...');
  const docDir =
    path.dirname(fileName) === '.' ? process.cwd() : path.resolve(process.cwd(), fileName);

  const packagePath = path.join(docDir, 'package.json');
  const packageContent = await fs.readFile(packagePath, 'utf-8');
  const pkg = JSON.parse(packageContent);
  const name = pkg.name || 'app';
  const version = pkg.version || '0.0.1';

  generateEntitiesEntries();
  generateEventsEntries();
  writeDocumentation(registry, docDir, name, version);
};
