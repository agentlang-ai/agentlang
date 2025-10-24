import { parseAndIntern } from './loader.js';
import { logger } from './logger.js';
import { Instance } from './module.js';
import { isReservedName } from './util.js';
import { OpenAPIClient, OpenAPIClientAxios } from 'openapi-client-axios';

export type OpenApiHandle = {
  api: OpenAPIClientAxios;
  client: OpenAPIClient;
};

let OpenApiModules: Map<string, OpenApiHandle> | undefined = undefined;

export async function registerOpenApiModule(
  moduleName: string,
  handle: OpenApiHandle
): Promise<string> {
  if (OpenApiModules === undefined) {
    OpenApiModules = new Map();
  }
  const m = new Map(Object.entries(handle.client));
  const events = new Array<string>();
  m.forEach((v: any, k: string) => {
    if (v instanceof Function) {
      if (isReservedName(k)) {
        k = `_${k}`;
      }
      logger.debug(`OpenAPI event: ${moduleName}/${k}`);
      events.push(
        `event ${k} {parameters Any @optional, data Any @optional, config Any @optional}`
      );
    }
  });
  await parseAndIntern(`module ${moduleName}\n${events.join('\n')}`);
  OpenApiModules.set(moduleName, handle);
  return moduleName;
}

export function isOpenApiModule(moduleName: string): boolean {
  return OpenApiModules !== undefined && OpenApiModules.has(moduleName);
}

export type OpenApiArgs = {
  parameters?: any;
  data?: any;
  config?: any;
};

export async function invokeOpenApiEvent(
  moduleName: string,
  eventName: string,
  params: OpenApiArgs
): Promise<any> {
  if (OpenApiModules) {
    const handle = OpenApiModules.get(moduleName);
    if (handle) {
      const f = handle.client[eventName];
      if (!f) {
        throw new Error(`No event ${eventName} found in ${moduleName}`);
      } else {
        const r: any = await f(params.parameters, params.data, params.config);
        return r.data;
      }
    } else {
      throw new Error(`No OpenAPI module found - ${moduleName}`);
    }
  } else {
    throw new Error(`OpenAPI module ${moduleName} not initialized`);
  }
}

export function isOpenApiEventInstance(eventInst: Instance): boolean {
  return isOpenApiModule(eventInst.moduleName);
}
