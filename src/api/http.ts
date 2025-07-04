import chalk from 'chalk';
import express, { Request, Response } from 'express';
import {
  getAllEventNames,
  getModuleNames,
  Instance,
  makeInstance,
  getEntity,
  fetchModule,
  objectAsInstanceAttributes,
} from '../runtime/module.js';
import { evaluate, parseAndEvaluateStatement, Result } from '../runtime/interpreter.js';
import { ApplicationSpec } from '../runtime/loader.js';
import { logger } from '../runtime/logger.js';
import { requireAuth, verifySession } from '../runtime/modules/auth.js';
import { ActiveSessionInfo, BypassSession, isNoSession, NoSession } from '../runtime/auth/defs.js';

export function startServer(appSpec: ApplicationSpec, port: number) {
  const app = express();
  app.use(express.json());

  const appName: string = appSpec.name;
  const appVersion: string = appSpec.version;

  app.get('/', (req: Request, res: Response) => {
    res.send(appName);
  });

  const eventNames: Map<string, string[]> = getAllEventNames();
  eventNames.forEach((eventNames: string[], moduleName: string) => {
    eventNames.forEach((n: string) => {
      app.post(`/${moduleName}/${n}`, (req: Request, res: Response) => {
        handleEventPost(moduleName, n, req, res);
      });
    });
  });

  const modules = getModuleNames();
  modules.forEach((moduleName: string) => {
    const module = fetchModule(moduleName);
    const entities = module.getEntityNames();
    entities.forEach((entityName: string) => {
      app.all(`/${moduleName}/${entityName}`, (req: Request, res: Response) => {
        handleEntityEvent(moduleName, entityName, req, res);
      });
      app.all(`/${moduleName}/${entityName}/:id`, (req: Request, res: Response) => {
        handleEntityEventId(moduleName, entityName, req, res);
      });
    });
  });

  app.listen(port, () => {
    console.log(
      chalk.green(
        `Application ${chalk.bold(appName + ' version ' + appVersion)} started on port ${chalk.bold(port)}`
      )
    );
  });
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
    evaluate(inst, (value: Result) => {
      const result: Result = normalizedResult(value);
      res.contentType('application/json');
      res.send(JSON.stringify(result));
    }).catch((reason: any) => {
      logger.error(reason);
      res.status(500).send(reason);
    });
  } catch (err: any) {
    logger.error(`Error in handing request: ${err}`);
    res.status(500).send(err.toString());
  }
}

async function handleEntityEvent(
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

    let pattern: string;

    switch (req.method) {
      case 'GET':
        pattern = `{${moduleName}/${entityName}? {}}`;
        parseAndEvaluateStatement(pattern)
          .then((value: Result) => {
            const result: Result = normalizedResult(value);
            res.contentType('application/json');
            res.send(JSON.stringify(result));
          })
          .catch((reason: any) => {
            logger.error(reason);
            res.status(500).send(reason);
          });

        break;
      case 'POST':
        const body = Object.entries(req.body)
          .map(([k, v]) => `${k} ${JSON.stringify(v)}`)
          .join(', ');
        pattern = `{${moduleName}/${entityName} {${body}}}`;
        parseAndEvaluateStatement(pattern)
          .then((value: Result) => {
            const result: Result = normalizedResult(value);
            res.contentType('application/json');
            res.send(JSON.stringify(result));
          })
          .catch((reason: any) => {
            logger.error(reason);
            res.contentType('application/json');
            res.status(500).send(JSON.stringify(reason));
          });
        break;
      default:
        res.status(405).send('Method not allowed');
        break;
    }
  } catch (err: any) {
    logger.error(`Error in handing request: ${err}`);
    res.status(500).send(err.toString());
  }
}

async function handleEntityEventId(
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

    const entity = getEntity(entityName, moduleName);
    if (!entity) {
      res.status(404).send(`Entity ${entityName} not found in module ${moduleName}`);
      return;
    }

    const idAttribute = entity.getIdAttributeName();

    let pattern: string;
    
    switch (req.method) {
      case 'PUT':
        const putQuery = {
          ...req.body,
          [idAttribute + '?']: req.params.id
        };
        const body = Object.entries(putQuery)
          .map(([k, v]) => `${k} ${JSON.stringify(v)}`)
          .join(', ');
        pattern = `{${moduleName}/${entityName} {${body}}}`;
        parseAndEvaluateStatement(pattern)
          .then((value: Result) => {
            const result: Result = normalizedResult(value);
            res.contentType('application/json');
            res.send(JSON.stringify(result));
          })
          .catch((reason: any) => {
            logger.error(reason);
            res.contentType('application/json');
            res.status(500).send(JSON.stringify(reason));
          });
        break;
      case 'DELETE':
        pattern = `delete {${moduleName}/${entityName} {${idAttribute + '?'} "${req.params.id}"}}`;
        parseAndEvaluateStatement(pattern)
          .then((value: Result) => {
            const result: Result = normalizedResult(value);
            res.contentType('application/json');
            res.send(JSON.stringify(result));
          })
          .catch((reason: any) => {
            logger.error(reason);
            res.contentType('application/json');
            res.status(500).send(JSON.stringify(reason));
          });
        break;
      default:
        res.status(405).send('Method not allowed');
        break;
    }
  } catch (err: any) {
    logger.error(`Error in handing request: ${err}`);
    res.status(500).send(err.toString());
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
    return r;
  }
}
