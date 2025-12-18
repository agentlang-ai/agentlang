import chalk from 'chalk';
import express, { Request, Response } from 'express';
import * as path from 'path';
import {
  getAllChildRelationships,
  getAllEntityNames,
  getAllEventNames,
  Instance,
  InstanceAttributes,
  isBetweenRelationship,
  makeInstance,
  objectAsInstanceAttributes,
  Relationship,
  fetchModule,
  getModuleNames,
  Record,
  fetchRefTarget,
  getAttributeNames,
  Module,
} from '../runtime/module.js';
import { isNodeEnv } from '../utils/runtime.js';
import { parseAndEvaluateStatement, Result } from '../runtime/interpreter.js';
import { ApplicationSpec } from '../runtime/loader.js';
import { logger } from '../runtime/logger.js';
import { requireAuth, verifySession } from '../runtime/modules/auth.js';
import { ActiveSessionInfo, BypassSession, isNoSession, NoSession } from '../runtime/auth/defs.js';
import {
  escapeFqName,
  forceAsEscapedName,
  forceAsFqName,
  isString,
  isStringNumeric,
  makeFqName,
  restoreFqName,
  nameToPath,
  walkDownInstancePath,
  DefaultFileHandlingDirectory,
  splitRefs,
  splitFqName,
  escapeSepInPath,
  generateLoggerCallId,
} from '../runtime/util.js';
import {
  BadRequestError,
  isPathAttribute,
  PathAttributeNameQuery,
  setEntityEndpointsUpdater,
  setEventEndpointsUpdater,
  UnauthorisedError,
} from '../runtime/defs.js';
import { evaluate } from '../runtime/interpreter.js';
import { Config } from '../runtime/state.js';
import {
  findFileByFilename,
  createFileRecord,
  deleteFileRecord,
} from '../runtime/modules/files.js';

export async function startServer(
  appSpec: ApplicationSpec,
  port: number,
  host?: string,
  config?: Config
) {
  const app = express();
  app.use(express.json());

  // Add CORS middleware
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  });

  // Log all HTTP requests and responses
  app.use((req: Request, res: Response, next) => {
    const startTime = Date.now();
    const callId = generateLoggerCallId();

    const requestLog: any = {
      method: req.method,
      path: req.path,
      url: req.url,
      query: req.query,
      headers: {
        ...req.headers,
        // Mask authorization header for security
        authorization: req.headers.authorization ? '[REDACTED]' : undefined,
      },
    };

    if (req.method !== 'GET' && req.method !== 'DELETE' && req.body) {
      requestLog.body = req.body;
    }

    logger.debug(`${callId}: HTTP Request: ${JSON.stringify(requestLog)}`);

    const originalSend = res.send;
    const originalJson = res.json;
    let responseBody: any = null;

    res.send = function (body?: any): Response {
      responseBody = body;
      return originalSend.call(this, body);
    };

    res.json = function (body?: any): Response {
      responseBody = body;
      return originalJson.call(this, body);
    };

    // Log response when finished
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const responseLog: any = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
      };

      if (responseBody !== null) {
        try {
          if (typeof responseBody === 'string') {
            try {
              responseLog.body = JSON.parse(responseBody);
            } catch {
              responseLog.body =
                responseBody.length > 1000
                  ? responseBody.substring(0, 1000) + '... [truncated]'
                  : responseBody;
            }
          } else {
            responseLog.body = responseBody;
          }
        } catch {
          responseLog.body = '[Unable to serialize response body]';
        }
      }
      logger.debug(`${callId}: HTTP Response: ${JSON.stringify(responseLog)}`);
    });

    next();
  });

  let uploadDir: string | null = null;
  let upload: any = null;

  if (isNodeEnv) {
    const multer = (await import('multer')).default;
    const fs = await import('fs');

    uploadDir = path.join(process.cwd(), DefaultFileHandlingDirectory);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const storage = multer.diskStorage({
      destination: (req: any, file: any, cb: any) => {
        cb(null, uploadDir!);
      },
      filename: (req: any, file: any, cb: any) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext);
        cb(null, `${basename}-${uniqueSuffix}${ext}`);
      },
    });

    upload = multer({
      storage: storage,
      limits: {
        fileSize: 1024 * 1024 * 1024,
      },
    });
  }

  const appName: string = appSpec.name;
  const appVersion: string = appSpec.version;

  app.get('/', (req: Request, res: Response) => {
    res.send({ agentlang: { application: `${appName}@${appVersion}` } });
  });

  app.get('/meta', (req: Request, res: Response) => {
    handleMetaGet(req, res);
  });

  if (isNodeEnv && upload && uploadDir) {
    app.post('/uploadFile', upload.single('file'), (req: Request, res: Response) => {
      handleFileUpload(req, res, config);
    });

    app.get('/downloadFile/:filename', (req: Request, res: Response) => {
      handleFileDownload(req, res, uploadDir!, config);
    });

    app.post('/deleteFile/:filename', (req: Request, res: Response) => {
      handleFileDelete(req, res, uploadDir!, config);
    });
  } else {
    app.post('/uploadFile', (req: Request, res: Response) => {
      res.status(501).send({ error: 'File upload is only supported in Node.js environment' });
    });

    app.get('/downloadFile/:filename', (req: Request, res: Response) => {
      res.status(501).send({ error: 'File download is only supported in Node.js environment' });
    });

    app.post('/deleteFile/:filename', (req: Request, res: Response) => {
      res.status(501).send({ error: 'File delete is only supported in Node.js environment' });
    });
  }

  const addEventHandler = (moduleName: string, m: Module, n: string) => {
    if (m.eventIsPublic(n))
      app.post(`/${moduleName}/${n}`, (req: Request, res: Response) => {
        handleEventPost(moduleName, n, req, res);
      });
  };

  getAllEventNames().forEach((eventNames: string[], moduleName: string) => {
    const m = fetchModule(moduleName);
    eventNames.forEach((n: string) => {
      addEventHandler(moduleName, m, n);
    });
  });

  const addEntityHandlers = (moduleName: string, n: string) => {
    app.get(`/${moduleName}/${n}`, (req: Request, res: Response) => {
      handleEntityGet(moduleName, n, req, res);
    });
    app.get(`/${moduleName}/${n}/*path`, (req: Request, res: Response) => {
      handleEntityGet(moduleName, n, req, res);
    });
    app.post(`/${moduleName}/${n}`, (req: Request, res: Response) => {
      handleEntityPost(moduleName, n, req, res);
    });
    app.post(`/${moduleName}/${n}/*path`, (req: Request, res: Response) => {
      handleEntityPost(moduleName, n, req, res);
    });
    app.put(`/${moduleName}/${n}/*path`, (req: Request, res: Response) => {
      handleEntityPut(moduleName, n, req, res);
    });
    app.patch(`/${moduleName}/${n}/*path`, (req: Request, res: Response) => {
      handleEntityPut(moduleName, n, req, res);
    });
    app.delete(`/${moduleName}/${n}/*path`, (req: Request, res: Response) => {
      handleEntityDelete(moduleName, n, req, res);
    });
  };

  getAllEntityNames().forEach((entityNames: string[], moduleName: string) => {
    entityNames.forEach((n: string) => {
      addEntityHandlers(moduleName, n);
    });
  });

  const cb = () => {
    console.log(
      chalk.green(
        `Application ${chalk.bold(appName + ' version ' + appVersion)} started on port ${chalk.bold(port)}`
      )
    );
  };
  if (host) {
    app.listen(port, host, cb);
  } else {
    app.listen(port, cb);
  }

  setEventEndpointsUpdater((moduleName: string) => {
    const m = fetchModule(moduleName);
    const eventNames = m.getEventNames();
    eventNames.forEach((n: string) => {
      addEventHandler(moduleName, m, n);
    });
  });
  setEntityEndpointsUpdater((moduleName: string) => {
    const m = fetchModule(moduleName);
    const entityNames = m.getEntityNames();
    entityNames.forEach((n: string) => {
      addEntityHandlers(moduleName, n);
    });
  });

  // Default 404 handler for unmatched routes
  app.use((req: Request, res: Response) => {
    logger.debug(`Route not found: ${req.path} ${req.method}`);
    res.status(404).json({
      error: 'Route not found',
      path: req.path,
      method: req.method,
    });
  });
}

function ok(res: Response) {
  return (value: Result) => {
    const result: Result = normalizedResult(value);
    res.contentType('application/json');
    res.send(JSON.stringify(result));
  };
}

function statusFromErrorType(err: any): number {
  if (err instanceof UnauthorisedError) {
    return 401;
  } else if (err instanceof BadRequestError) {
    return 400;
  } else {
    return 500;
  }
}

function internalError(res: Response) {
  return (reason: any) => {
    logger.error(reason);
    res.status(statusFromErrorType(reason)).send(reason.message);
  };
}

function patternFromAttributes(
  moduleName: string,
  recName: string,
  attrs: InstanceAttributes
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

function normalizeRequestPath(path: string[], moduleName: string): string[] {
  if (path.length <= 1) {
    return path;
  }
  const result = new Array<string>();
  result.push(path[0]);
  for (let i = 1; i < path.length; ++i) {
    const rn = forceAsEscapedName(path[i], moduleName);
    const en = forceAsEscapedName(path[++i], moduleName);
    result.push(rn);
    result.push(en);
    if (i < path.length) {
      result.push(path[++i]);
    }
  }
  return result;
}

function pathFromRequest(moduleName: string, entryName: string, req: Request): string {
  const path: any = req.params.path;
  if (!path) {
    const url = req.url;
    const i = url.indexOf('?');
    if (i > 0) {
      return url.substring(0, i);
    }
    return url;
  }
  let p = '';
  if (path instanceof Array) {
    p = normalizeRequestPath(path, moduleName).join('/');
  } else {
    p = path.toString();
  }
  p = p.trim();
  if (p.endsWith('/')) {
    p = p.substring(0, p.length - 1);
  }
  return `${escapeFqName(makeFqName(moduleName, entryName))}/${p}`;
}

async function handleEventPost(
  moduleName: string,
  eventName: string,
  req: Request,
  res: Response
): Promise<void> {
  try {
    const sessionInfo = await verifyAuth(moduleName, eventName, req.headers.authorization);
    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }
    const inst: Instance = makeInstance(
      moduleName,
      eventName,
      objectAsInstanceAttributes(req.body)
    ).setAuthContext(sessionInfo);
    evaluate(inst, ok(res)).catch(internalError(res));
  } catch (err: any) {
    logger.error(err);
    res.status(500).send(err.toString());
  }
}

async function handleEntityPost(
  moduleName: string,
  entityName: string,
  req: Request,
  res: Response
): Promise<void> {
  try {
    const sessionInfo = await verifyAuth(moduleName, entityName, req.headers.authorization);
    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }
    const pattern = req.params.path
      ? createChildPattern(moduleName, entityName, req)
      : patternFromAttributes(moduleName, entityName, objectAsInstanceAttributes(req.body));
    parseAndEvaluateStatement(pattern, sessionInfo.userId).then(ok(res)).catch(internalError(res));
  } catch (err: any) {
    logger.error(err);
    res.status(500).send(err.toString());
  }
}

async function handleEntityGet(
  moduleName: string,
  entityName: string,
  req: Request,
  res: Response
): Promise<void> {
  try {
    const path = pathFromRequest(moduleName, entityName, req);
    const sessionInfo = await verifyAuth(moduleName, entityName, req.headers.authorization);
    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }
    let pattern = '';
    if (req.query.tree) {
      pattern = fetchTreePattern(makeFqName(moduleName, entityName), path);
    } else {
      pattern = queryPatternFromPath(path, req);
    }
    parseAndEvaluateStatement(pattern, sessionInfo.userId).then(ok(res)).catch(internalError(res));
  } catch (err: any) {
    logger.error(err);
    res.status(500).send(err.toString());
  }
}

const joinTags = new Map()
  .set('@joinOn', '@join')
  .set('@leftJoinOn', '@left_join')
  .set('@rightJoinOn', '@right_join');

function objectAsAttributesPattern(entityFqName: string, obj: object): [string, boolean] {
  const attrs = new Array<string>();
  let joinType: string | undefined;
  let joinOnAttr: string | undefined;
  Object.keys(obj).forEach(key => {
    const s: string = obj[key as keyof object];
    if (joinTags.has(key)) {
      joinType = joinTags.get(key);
      joinOnAttr = s;
    } else {
      let v = s;
      if (!s.startsWith('"')) {
        if (!isStringNumeric(s) && s != 'true' && s != 'false') {
          v = `"${s}"`;
        }
      }
      attrs.push(`${key}? ${v}`);
    }
  });
  const hasQueryAttrs = attrs.length > 0;
  const pat = `{
    ${attrs.join(',')}
  }`;
  if (joinType && joinOnAttr) {
    const [targetEntity, targetAttr, reverseJoin] = fetchRefTarget(entityFqName, joinOnAttr);
    const intoSpec = new Array<string>();
    const en1 = splitFqName(entityFqName)[1];
    getAttributeNames(entityFqName).forEach((n: string) => {
      intoSpec.push(`${en1}_${n} ${entityFqName}.${n}`);
    });
    const en2 = splitFqName(targetEntity)[1];
    getAttributeNames(targetEntity).forEach((n: string) => {
      intoSpec.push(`${en2}_${n} ${targetEntity}.${n}`);
    });
    const intoPat = `@into {${intoSpec.join(', ')}}`;
    joinOnAttr = reverseJoin ? splitRefs(joinOnAttr)[1] : joinOnAttr;
    return [
      `${pat},\n${joinType} ${targetEntity} {${targetAttr}? ${entityFqName}.${joinOnAttr}}, \n${intoPat}`,
      hasQueryAttrs,
    ];
  } else {
    return [pat, hasQueryAttrs];
  }
}

function queryPatternFromPath(path: string, req: Request): string {
  const r = walkDownInstancePath(path);
  let moduleName = r[0];
  let entityName = r[1];
  const id = r[2];
  const parts = r[3];
  const fqName = `${moduleName}/${entityName}`;
  if (parts.length == 2 && id === undefined) {
    if (req.query && Object.keys(req.query).length > 0) {
      const [pat, hasQueryAttrs] = objectAsAttributesPattern(fqName, req.query);
      const n = hasQueryAttrs ? fqName : `${fqName}?`;
      return `{${n} ${pat}}`;
    } else {
      return `{${fqName}? {}}`;
    }
  } else {
    moduleName = restoreFqName(moduleName);
    const relName: string | undefined = restoreFqName(parts[parts.length - 2]);
    if (relName && isBetweenRelationship(relName, moduleName)) {
      const n = restoreFqName(parts[0]);
      const ns = nameToPath(n);
      const pe = ns.getEntryName();
      const pm = ns.hasModule() ? ns.getModuleName() : moduleName;
      const p = escapeSepInPath(parts.slice(0, parts.length - 2).join('/'));
      return `{${pm}/${pe} {${PathAttributeNameQuery} "${p}"}, ${relName} {${moduleName}/${entityName}? {}}}`;
    }
    entityName = restoreFqName(entityName);
    path = escapeSepInPath(path);
    if (id === undefined) {
      return `{${moduleName}/${entityName} {${PathAttributeNameQuery}like "${path}%"}}`;
    } else {
      return `{${moduleName}/${entityName} {${PathAttributeNameQuery} "${path}"}}`;
    }
  }
}

async function handleEntityPut(
  moduleName: string,
  entityName: string,
  req: Request,
  res: Response
): Promise<void> {
  try {
    const path = pathFromRequest(moduleName, entityName, req);
    const sessionInfo = await verifyAuth(moduleName, entityName, req.headers.authorization);
    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }
    const attrs = objectAsInstanceAttributes(req.body);
    attrs.set(PathAttributeNameQuery, path);
    const r = walkDownInstancePath(path);
    moduleName = r[0];
    entityName = r[1];
    const pattern = patternFromAttributes(moduleName, entityName, attrs);
    parseAndEvaluateStatement(pattern, sessionInfo.userId).then(ok(res)).catch(internalError(res));
  } catch (err: any) {
    logger.error(err);
    res.status(500).send(err.toString());
  }
}

async function handleEntityDelete(
  moduleName: string,
  entityName: string,
  req: Request,
  res: Response
): Promise<void> {
  try {
    const path = pathFromRequest(moduleName, entityName, req);
    const sessionInfo = await verifyAuth(moduleName, entityName, req.headers.authorization);
    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }
    const cmd = req.query.purge == 'true' ? 'purge' : 'delete';
    const pattern = `${cmd} ${queryPatternFromPath(path, req)}`;
    parseAndEvaluateStatement(pattern, sessionInfo.userId).then(ok(res)).catch(internalError(res));
  } catch (err: any) {
    logger.error(err);
    res.status(500).send(err.toString());
  }
}

function fetchTreePattern(fqName: string, path?: string): string {
  let pattern = path ? `{${fqName} {${PathAttributeNameQuery} "${path}"}` : `{${fqName}? {}`;
  const rels = getAllChildRelationships(fqName);
  if (rels.length > 0) {
    const treePats = new Array<string>();
    rels.forEach((rel: Relationship) => {
      treePats.push(`${rel.getFqName()} ${fetchTreePattern(rel.getChildFqName())}`);
    });
    pattern = pattern.concat(',', treePats.join(','));
  }
  return `${pattern}}`;
}

function createChildPattern(moduleName: string, entityName: string, req: Request): string {
  const path = pathFromRequest(moduleName, entityName, req);
  try {
    const parts = path.split('/');
    const pinfo = parts.slice(-4);
    const parentFqname = forceAsFqName(pinfo[0], moduleName);
    const relName = forceAsFqName(pinfo[2], moduleName);
    const parentPath = escapeSepInPath(parts.slice(0, parts.length - 2).join('/'));
    const childFqName = forceAsFqName(pinfo[3], moduleName);
    const cparts = nameToPath(childFqName);
    const childModuleName = cparts.getModuleName();
    const childName = cparts.getEntryName();
    const cp = patternFromAttributes(
      childModuleName,
      childName,
      objectAsInstanceAttributes(req.body)
    );
    return `{${parentFqname} {${PathAttributeNameQuery} "${parentPath}"}, ${relName} ${cp}}`;
  } catch (err: any) {
    throw new BadRequestError(err.message);
  }
}

async function verifyAuth(
  moduleName: string,
  eventName: string,
  authValue: string | undefined
): Promise<ActiveSessionInfo> {
  if (requireAuth(moduleName, eventName)) {
    if (authValue) {
      const token = authValue.substring(authValue.indexOf(' ')).trim();
      return await verifySession(token);
    } else {
      return NoSession;
    }
  }
  return BypassSession;
}

function normalizedResult(r: Result): Result {
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

async function handleMetaGet(req: Request, res: Response): Promise<void> {
  try {
    const sessionInfo = await verifyAuth('', '', req.headers.authorization);
    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }

    const moduleFilter = req.query.module as string;
    const entityFilter = req.query.entity as string;
    const eventFilter = req.query.event as string;

    const entities: any[] = [];
    const events: any[] = [];
    const entityNames = getAllEntityNames();
    const eventNames = getAllEventNames();

    // entities
    // skip entities if eventFilter is provided
    if (!eventFilter || eventFilter === '') {
      entityNames.forEach((entityNames: string[], moduleName: string) => {
        if (moduleFilter && moduleName !== moduleFilter) {
          return;
        }

        entityNames.forEach((entityName: string) => {
          if (entityFilter && !entityName.toLowerCase().includes(entityFilter.toLowerCase())) {
            return;
          }

          try {
            const module = fetchModule(moduleName);
            const entity = module.getEntry(entityName);

            const attributes: any[] = [];
            if (entity instanceof Record && entity.schema) {
              entity.schema.forEach((attrSpec: any, attrName: string) => {
                let properties = {};
                if (attrSpec.properties) {
                  const propsObj: any = {};
                  attrSpec.properties.forEach((value: any, key: string) => {
                    if (value instanceof Set) {
                      propsObj[key] = Array.from(value);
                    } else {
                      propsObj[key] = value;
                    }
                  });
                  properties = propsObj;
                }

                const attrInfo: any = {
                  name: attrName,
                  type: attrSpec.type,
                  properties: JSON.stringify(properties),
                };
                attributes.push(attrInfo);
              });
            }

            const relationships: any[] = [];
            const allModules = getModuleNames();
            allModules.forEach((modName: string) => {
              const mod = fetchModule(modName);
              const rels = mod.getRelationshipEntries();
              rels.forEach((rel: Relationship) => {
                const parentNode = rel.parentNode();
                const childNode = rel.childNode();

                if (
                  parentNode.path.getModuleName() === moduleName &&
                  parentNode.path.getEntryName() === entityName
                ) {
                  relationships.push({
                    name: rel.name,
                    type: rel.isContains() ? 'contains' : 'between',
                    direction: 'parent',
                    target: childNode.path.asFqName(),
                    cardinality: rel.isOneToOne()
                      ? 'one-to-one'
                      : rel.isOneToMany()
                        ? 'one-to-many'
                        : 'many-to-many',
                  });
                } else if (
                  childNode.path.getModuleName() === moduleName &&
                  childNode.path.getEntryName() === entityName
                ) {
                  relationships.push({
                    name: rel.name,
                    type: rel.isContains() ? 'contains' : 'between',
                    direction: 'child',
                    target: parentNode.path.asFqName(),
                    cardinality: rel.isOneToOne()
                      ? 'one-to-one'
                      : rel.isOneToMany()
                        ? 'one-to-many'
                        : 'many-to-many',
                  });
                }
              });
            });

            const entityInfo = {
              name: entityName,
              module: moduleName,
              fqName: makeFqName(moduleName, entityName),
              type: 'entity',
              attributes: attributes,
              relationships: relationships,
              meta: entity instanceof Record && entity.meta ? Object.fromEntries(entity.meta) : {},
            };
            entities.push(entityInfo);
          } catch (err: any) {
            logger.warn(
              `Could not get detailed info for entity ${moduleName}/${entityName}: ${err.message}`
            );
            const entityInfo = {
              name: entityName,
              module: moduleName,
              fqName: makeFqName(moduleName, entityName),
              type: 'entity',
              error: 'Could not load detailed information',
            };
            entities.push(entityInfo);
          }
        });
      });
    }

    // events
    if (!entityFilter || entityFilter === '') {
      eventNames.forEach((eventNames: string[], moduleName: string) => {
        if (moduleFilter && moduleName !== moduleFilter) {
          return;
        }

        eventNames.forEach((eventName: string) => {
          if (eventFilter && !eventName.toLowerCase().includes(eventFilter.toLowerCase())) {
            return;
          }

          try {
            const module = fetchModule(moduleName);
            const event = module.getEntry(eventName);

            const attributes: any[] = [];
            if (event instanceof Record && event.schema) {
              event.schema.forEach((attrSpec: any, attrName: string) => {
                let properties = {};
                if (attrSpec.properties) {
                  const propsObj: any = {};
                  attrSpec.properties.forEach((value: any, key: string) => {
                    if (value instanceof Set) {
                      propsObj[key] = Array.from(value);
                    } else {
                      propsObj[key] = value;
                    }
                  });
                  properties = propsObj;
                }

                const attrInfo: any = {
                  name: attrName,
                  type: attrSpec.type,
                  properties: JSON.stringify(properties),
                };
                attributes.push(attrInfo);
              });
            }

            const eventInfo = {
              name: eventName,
              module: moduleName,
              fqName: makeFqName(moduleName, eventName),
              type: 'event',
              attributes: attributes,
              meta: event instanceof Record && event.meta ? Object.fromEntries(event.meta) : {},
            };
            events.push(eventInfo);
          } catch (err: any) {
            logger.warn(
              `Could not get detailed info for event ${moduleName}/${eventName}: ${err.message}`
            );
            const eventInfo = {
              name: eventName,
              module: moduleName,
              fqName: makeFqName(moduleName, eventName),
              type: 'event',
              error: 'Could not load detailed information',
            };
            events.push(eventInfo);
          }
        });
      });
    }

    const entitiesByModule: { [key: string]: any[] } = {};
    const eventsByModule: { [key: string]: any[] } = {};

    entities.forEach(entity => {
      if (!entitiesByModule[entity.module]) {
        entitiesByModule[entity.module] = [];
      }
      entitiesByModule[entity.module].push(entity);
    });

    events.forEach(event => {
      if (!eventsByModule[event.module]) {
        eventsByModule[event.module] = [];
      }
      eventsByModule[event.module].push(event);
    });

    const result = {
      entities: entitiesByModule,
      events: eventsByModule,
      modules: Array.from(new Set([...entities.map(e => e.module), ...events.map(e => e.module)])),
    };

    res.contentType('application/json');
    res.send(result);
  } catch (err: any) {
    logger.error(err);
    res.status(500).send(err.toString());
  }
}

async function handleFileUpload(
  req: Request & { file?: Express.Multer.File },
  res: Response,
  config?: Config
): Promise<void> {
  try {
    if (!isNodeEnv) {
      res.status(501).send({ error: 'File upload is only supported in Node.js environment' });
      return;
    }

    if (!config?.service?.httpFileHandling) {
      res
        .status(403)
        .send({ error: 'File handling is not enabled. Set httpFileHandling: true in config.' });
      return;
    }

    const sessionInfo = await verifyAuth('', '', req.headers.authorization);

    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }

    if (!req.file) {
      res.status(400).send({ error: 'No file uploaded' });
      return;
    }

    const file = req.file;

    try {
      await createFileRecord(
        {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          path: file.path,
          uploadedBy: sessionInfo.userId,
        },
        sessionInfo
      );
    } catch (dbErr: any) {
      logger.error(`Failed to create file record in database: ${dbErr.message}`);
    }

    const fileInfo = {
      success: true,
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
      uploadedAt: new Date().toISOString(),
      uploadedBy: sessionInfo.userId,
    };

    logger.info(`File uploaded successfully: ${file.originalname} -> ${file.filename}`);

    res.contentType('application/json');
    res.send(fileInfo);
  } catch (err: any) {
    logger.error(`File upload error: ${err}`);
    res.status(500).send({ error: err.message || 'File upload failed' });
  }
}

async function handleFileDownload(
  req: Request,
  res: Response,
  uploadDir: string,
  config?: Config
): Promise<void> {
  try {
    if (!isNodeEnv) {
      res.status(501).send({ error: 'File download is only supported in Node.js environment' });
      return;
    }

    if (!config?.service?.httpFileHandling) {
      res
        .status(403)
        .send({ error: 'File handling is not enabled. Set httpFileHandling: true in config.' });
      return;
    }

    const sessionInfo = await verifyAuth('', '', req.headers.authorization);
    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }

    const filename = req.params.filename;

    if (!filename) {
      res.status(400).send({ error: 'Filename is required' });
      return;
    }

    const file = await findFileByFilename(filename, sessionInfo);

    if (!file) {
      res.status(404).send({ error: 'File not found' });
      return;
    }

    const sanitizedFilename = path.basename(filename);

    const fs = await import('fs');

    const filePath = path.join(uploadDir, sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      res.status(404).send({ error: 'File not found' });
      return;
    }

    const realPath = fs.realpathSync(filePath);
    const realUploadDir = fs.realpathSync(uploadDir);
    if (!realPath.startsWith(realUploadDir)) {
      res.status(403).send({ error: 'Access denied' });
      return;
    }

    const stats = fs.statSync(filePath);

    const ext = path.extname(sanitizedFilename).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.zip': 'application/zip',
      '.csv': 'text/csv',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    logger.info(`File download: ${sanitizedFilename}`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (err: any) => {
      logger.error(`File stream error: ${err}`);
      if (!res.headersSent) {
        res.status(500).send({ error: 'Error streaming file' });
      }
    });
  } catch (err: any) {
    logger.error(`File download error: ${err}`);
    if (!res.headersSent) {
      res.status(500).send({ error: err.message || 'File download failed' });
    }
  }
}

async function handleFileDelete(
  req: Request,
  res: Response,
  uploadDir: string,
  config?: Config
): Promise<void> {
  try {
    if (!isNodeEnv) {
      res.status(501).send({ error: 'File delete is only supported in Node.js environment' });
      return;
    }

    if (!config?.service?.httpFileHandling) {
      res
        .status(403)
        .send({ error: 'File handling is not enabled. Set httpFileHandling: true in config.' });
      return;
    }

    const sessionInfo = await verifyAuth('', '', req.headers.authorization);
    if (isNoSession(sessionInfo)) {
      res.status(401).send('Authorization required');
      return;
    }

    const filename = req.params.filename;

    if (!filename) {
      res.status(400).send({ error: 'Filename is required' });
      return;
    }

    const file = await findFileByFilename(filename, sessionInfo);

    if (!file) {
      res.status(404).send({ error: 'File not found' });
      return;
    }

    const sanitizedFilename = path.basename(filename);

    const fs = await import('fs');

    const filePath = path.join(uploadDir, sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      res.status(404).send({ error: 'File not found' });
      return;
    }

    const realPath = fs.realpathSync(filePath);
    const realUploadDir = fs.realpathSync(uploadDir);
    if (!realPath.startsWith(realUploadDir)) {
      res.status(403).send({ error: 'Access denied' });
      return;
    }

    await deleteFileRecord(filename, sessionInfo);

    fs.unlinkSync(filePath);

    logger.info(`File deleted: ${sanitizedFilename}`);

    res.status(200).send({
      message: 'File deleted successfully',
      filename: sanitizedFilename,
    });
  } catch (err: any) {
    logger.error(`File delete error: ${err}`);
    if (!res.headersSent) {
      res.status(500).send({ error: err.message || 'File delete failed' });
    }
  }
}
