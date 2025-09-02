import chalk from 'chalk';
import express, { Request, Response } from 'express';
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
} from '../runtime/module.js';
import { evaluate, parseAndEvaluateStatement, Result } from '../runtime/interpreter.js';
import { ApplicationSpec } from '../runtime/loader.js';
import { logger } from '../runtime/logger.js';
import { requireAuth, verifySession } from '../runtime/modules/auth.js';
import { ActiveSessionInfo, BypassSession, isNoSession, NoSession } from '../runtime/auth/defs.js';
import {
  escapeFqName,
  forceAsEscapedName,
  forceAsFqName,
  isString,
  makeFqName,
  restoreFqName,
  splitFqName,
  walkDownInstancePath,
} from '../runtime/util.js';
import { BadRequestError, PathAttributeNameQuery, UnauthorisedError } from '../runtime/defs.js';

export function startServer(appSpec: ApplicationSpec, port: number, host?: string) {
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

  const appName: string = appSpec.name;
  const appVersion: string = appSpec.version;

  app.get('/', (req: Request, res: Response) => {
    res.send({ agentlang: { application: `${appName}@${appVersion}` } });
  });

  getAllEventNames().forEach((eventNames: string[], moduleName: string) => {
    eventNames.forEach((n: string) => {
      app.post(`/${moduleName}/${n}`, (req: Request, res: Response) => {
        handleEventPost(moduleName, n, req, res);
      });
    });
  });

  getAllEntityNames().forEach((entityNames: string[], moduleName: string) => {
    entityNames.forEach((n: string) => {
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
      app.delete(`/${moduleName}/${n}/*path`, (req: Request, res: Response) => {
        handleEntityDelete(moduleName, n, req, res);
      });
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
    return req.url;
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
      pattern = queryPatternFromPath(path);
    }
    parseAndEvaluateStatement(pattern, sessionInfo.userId).then(ok(res)).catch(internalError(res));
  } catch (err: any) {
    logger.error(err);
    res.status(500).send(err.toString());
  }
}

function queryPatternFromPath(path: string): string {
  const r = walkDownInstancePath(path);
  let moduleName = r[0];
  let entityName = r[1];
  const id = r[2];
  const parts = r[3];
  if (parts.length == 2 && id == undefined) {
    return `{${moduleName}/${entityName}? {}}`;
  } else {
    moduleName = restoreFqName(moduleName);
    const relName: string | undefined = restoreFqName(parts[parts.length - 2]);
    if (relName && isBetweenRelationship(relName, moduleName)) {
      const n = restoreFqName(parts[0]);
      const ns = splitFqName(n);
      const pe = ns.getEntryName();
      const pm = ns.hasModule() ? ns.getModuleName() : moduleName;
      const p = parts.slice(0, parts.length - 2).join('/');
      return `{${pm}/${pe} {${PathAttributeNameQuery} "${p}"}, ${relName} {${moduleName}/${entityName}? {}}}`;
    }
    entityName = restoreFqName(entityName);
    if (id == undefined) {
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
    const pattern = `delete ${queryPatternFromPath(path)}`;
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
    const parentPath = parts.slice(0, parts.length - 2).join('/');
    const childFqName = forceAsFqName(pinfo[3], moduleName);
    const cparts = splitFqName(childFqName);
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
  } else if (r instanceof Instance) {
    r.mergeRelatedInstances();
    Array.from(r.attributes.keys()).forEach(k => {
      const v: Result = r.attributes.get(k);
      if (v instanceof Array || v instanceof Instance) {
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
