import {
  getAllEntityNames,
  getAllEventNames,
  getAllBetweenRelationshipNames,
  Instance,
  makeInstance,
  objectAsInstanceAttributes,
  fetchModule,
  Record,
  Event,
  AttributeSpec,
  RecordSchema,
  isOptionalAttribute,
  isArrayAttribute,
  getEnumValues,
  getAttributeDefaultValue,
} from '../runtime/module.js';
import { evaluate, parseAndEvaluateStatement, Result } from '../runtime/interpreter.js';
import { ActiveSessionInfo, BypassSession, NoSession } from '../runtime/auth/defs.js';
import { requireAuth, verifySession } from '../runtime/modules/auth.js';
import { isPathAttribute, PathAttributeNameQuery } from '../runtime/defs.js';
import { escapeSepInPath, isString, makeFqName, walkDownInstancePath } from '../runtime/util.js';

// ---- Normalized result ----

export function normalizedResult(r: Result): Result {
  if (r instanceof Array) {
    return r.map((x: Result) => {
      return normalizedResult(x);
    });
  } else if (Instance.IsInstance(r)) {
    r.mergeRelatedInstances();
    Array.from(r.attributes.keys()).forEach(k => {
      const v: Result = r.attributes.get(k);
      if (v instanceof Array || Instance.IsInstance(v)) {
        r.attributes.set(k, normalizedResult(v));
      }
    });
    return r.asObject();
  } else {
    if (r instanceof Map) {
      return Object.fromEntries(r.entries());
    }
    return r;
  }
}

// ---- Authentication ----

/**
 * Extracts the bearer token from an Authorization header value.
 * Handles "Bearer <token>" format and plain token strings.
 */
export function extractBearerToken(authHeaderValue: string): string {
  const spaceIndex = authHeaderValue.indexOf(' ');
  if (spaceIndex >= 0) {
    return authHeaderValue.substring(spaceIndex + 1).trim();
  }
  return authHeaderValue.trim();
}

/**
 * Transport-agnostic auth verification.
 * Checks if auth is required for the given module/entry, extracts and verifies
 * the token from the provided Authorization header value.
 *
 * Returns:
 *  - BypassSession if auth is not required
 *  - NoSession if auth is required but no token is provided
 *  - ActiveSessionInfo from verifySession if token is valid
 *  - Throws UnauthorisedError if token is invalid
 */
export async function verifyAuth(
  moduleName: string,
  entryName: string,
  authHeaderValue: string | undefined
): Promise<ActiveSessionInfo> {
  if (requireAuth(moduleName, entryName)) {
    if (authHeaderValue) {
      const token = extractBearerToken(authHeaderValue);
      return await verifySession(token);
    } else {
      return NoSession;
    }
  }
  return BypassSession;
}

// ---- Shared handler functions ----

export async function evaluateEvent(
  moduleName: string,
  eventName: string,
  body: object,
  authContext: ActiveSessionInfo
): Promise<Result> {
  const inst: Instance = makeInstance(
    moduleName,
    eventName,
    objectAsInstanceAttributes(body)
  ).setAuthContext(authContext);
  let result: any;
  await evaluate(inst, (r: any) => (result = normalizedResult(r)));
  return result;
}

export async function queryEntity(
  moduleName: string,
  entityName: string,
  queryParams: object | undefined,
  authContext: ActiveSessionInfo,
  path?: string
): Promise<Result> {
  let pattern: string;
  if (path) {
    pattern = queryPatternFromPathAndParams(path, queryParams);
  } else {
    const fqName = `${moduleName}/${entityName}`;
    pattern = `{${fqName}? {}}`;
  }
  const result = await parseAndEvaluateStatement(pattern, authContext.userId);
  return normalizedResult(result);
}

export async function createEntity(
  moduleName: string,
  entityName: string,
  body: object,
  authContext: ActiveSessionInfo
): Promise<Result> {
  const pattern = patternFromAttributes(moduleName, entityName, objectAsInstanceAttributes(body));
  const result = await parseAndEvaluateStatement(pattern, authContext.userId);
  return normalizedResult(result);
}

export async function updateEntity(
  moduleName: string,
  entityName: string,
  path: string,
  body: object,
  authContext: ActiveSessionInfo
): Promise<Result> {
  const attrs = objectAsInstanceAttributes(body);
  attrs.set(PathAttributeNameQuery, path);
  const r = walkDownInstancePath(path);
  moduleName = r[0];
  entityName = r[1];
  const pattern = patternFromAttributes(moduleName, entityName, attrs);
  const result = await parseAndEvaluateStatement(pattern, authContext.userId);
  return normalizedResult(result);
}

export async function deleteEntity(
  moduleName: string,
  entityName: string,
  path: string,
  purge: boolean,
  authContext: ActiveSessionInfo,
  queryParams?: object
): Promise<Result> {
  const cmd = purge ? 'purge' : 'delete';
  const pattern = `${cmd} ${queryPatternFromPathAndParams(path, queryParams)}`;
  const result = await parseAndEvaluateStatement(pattern, authContext.userId);
  return normalizedResult(result);
}

// ---- Schema conversion ----

const TypeMapping: { [key: string]: any } = {
  String: { type: 'string' },
  Int: { type: 'integer' },
  Integer: { type: 'integer' },
  Number: { type: 'number' },
  Float: { type: 'number' },
  Decimal: { type: 'number' },
  Email: { type: 'string', format: 'email' },
  DateTime: { type: 'string', format: 'date-time' },
  Boolean: { type: 'boolean' },
  UUID: { type: 'string', format: 'uuid' },
  URL: { type: 'string', format: 'uri' },
  Map: { type: 'object' },
  Any: {},
};

export function recordSchemaToJsonSchema(schema: RecordSchema): {
  type: 'object';
  properties: { [key: string]: any };
  required?: string[];
} {
  const properties: { [key: string]: any } = {};
  const required: string[] = [];

  schema.forEach((attrSpec: AttributeSpec, name: string) => {
    let propSchema = TypeMapping[attrSpec.type] || { type: 'object' };
    propSchema = { ...propSchema };

    if (isArrayAttribute(attrSpec)) {
      propSchema = { type: 'array', items: propSchema };
    }

    const enumVals = getEnumValues(attrSpec);
    if (enumVals && enumVals.size > 0) {
      propSchema.enum = Array.from(enumVals);
    }

    properties[name] = propSchema;

    if (!isOptionalAttribute(attrSpec) && getAttributeDefaultValue(attrSpec) === undefined) {
      required.push(name);
    }
  });

  const result: any = { type: 'object' as const, properties };
  if (required.length > 0) {
    result.required = required;
  }
  return result;
}

// ---- Exposed endpoints ----

export type ExposedEndpoint = {
  moduleName: string;
  name: string;
  fqName: string;
  description?: string;
  schema: RecordSchema;
};

export function getExposedEvents(): ExposedEndpoint[] {
  const endpoints: ExposedEndpoint[] = [];
  getAllEventNames().forEach((eventNames: string[], moduleName: string) => {
    const m = fetchModule(moduleName);
    eventNames.forEach((name: string) => {
      if (m.eventIsPublic(name)) {
        const entry = m.getEntry(name);
        if (entry instanceof Event) {
          const doc = entry.meta?.get('doc') || entry.meta?.get('description');
          endpoints.push({
            moduleName,
            name,
            fqName: makeFqName(moduleName, name),
            description: doc,
            schema: entry.getUserAttributes(),
          });
        }
      }
    });
  });
  return endpoints;
}

export function getExposedEntities(): ExposedEndpoint[] {
  const endpoints: ExposedEndpoint[] = [];
  getAllEntityNames().forEach((entityNames: string[], moduleName: string) => {
    entityNames.forEach((name: string) => {
      const m = fetchModule(moduleName);
      const entry = m.getEntry(name);
      if (entry instanceof Record) {
        const doc = entry.meta?.get('doc') || entry.meta?.get('description');
        endpoints.push({
          moduleName,
          name,
          fqName: makeFqName(moduleName, name),
          description: doc,
          schema: entry.getUserAttributes(),
        });
      }
    });
  });
  return endpoints;
}

export function getExposedBetweenRelationships(): ExposedEndpoint[] {
  const endpoints: ExposedEndpoint[] = [];
  getAllBetweenRelationshipNames().forEach((relNames: string[], moduleName: string) => {
    relNames.forEach((name: string) => {
      endpoints.push({
        moduleName,
        name,
        fqName: makeFqName(moduleName, name),
        schema: new Map(),
      });
    });
  });
  return endpoints;
}

// ---- Helpers (moved from http.ts) ----

function patternFromAttributes(
  moduleName: string,
  recName: string,
  attrs: Map<string, any>
): string {
  const attrsStrs = new Array<string>();
  attrs.forEach((v: any, n: string) => {
    let av = isString(v) ? `"${v}"` : v;
    if (av instanceof Object) {
      av = JSON.stringify(av);
    }
    if (isPathAttribute(n)) {
      av = escapeSepInPath(av);
    }
    attrsStrs.push(`${n} ${av}`);
  });
  return `{${moduleName}/${recName} { ${attrsStrs.join(',\n')} }}`;
}

function queryPatternFromPathAndParams(path: string, queryParams?: object): string {
  const r = walkDownInstancePath(path);
  const moduleName = r[0];
  const entityName = r[1];
  const id = r[2];
  const parts = r[3];
  const fqName = `${moduleName}/${entityName}`;
  if (parts.length == 2 && id === undefined) {
    return `{${fqName}? {}}`;
  } else {
    const escapedPath = escapeSepInPath(path);
    if (id === undefined) {
      return `{${moduleName}/${entityName} {${PathAttributeNameQuery}like "${escapedPath}%"}}`;
    } else {
      return `{${moduleName}/${entityName} {${PathAttributeNameQuery} "${escapedPath}"}}`;
    }
  }
}
