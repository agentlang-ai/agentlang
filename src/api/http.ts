import chalk from 'chalk';
import express, { Request, Response } from 'express';
import {
  getAllEventNames,
  Instance,
  makeInstance,
  objectAsInstanceAttributes,
} from '../runtime/module.js';
import { evaluate, Result } from '../runtime/interpreter.js';
import { ApplicationSpec } from '../runtime/loader.js';
import { logger } from '../runtime/logger.js';
import { verifySession } from '../runtime/modules/auth.js';
import { ActiveSessionInfo, AdminSession } from '../runtime/auth/defs.js';

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
  const sessionInfo = await verifyAuth(req.headers.authorization);
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
}

async function verifyAuth(authValue: string | undefined): Promise<ActiveSessionInfo> {
  if (authValue) {
    const token = authValue.substring(authValue.indexOf(' ')).trim();
    return await verifySession(token);
  } else {
    return AdminSession;
  }
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
