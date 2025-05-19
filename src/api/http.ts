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

function handleEventPost(moduleName: string, eventName: string, req: Request, res: Response): void {
  const inst: Instance = makeInstance(moduleName, eventName, objectAsInstanceAttributes(req.body));
  evaluate(inst, (value: Result) => {
    const result: Result = normalizedResult(value);
    res.contentType('application/json');
    res.send(JSON.stringify(result));
  }).catch((reason: any) => {
    logger.error(reason);
    res.status(500).send(reason);
  });
}

function normalizedResult(r: Result): Result {
  if (r instanceof Array) {
    return r.map((x: Result) => {
      return normalizedResult(x);
    });
  } else if (r instanceof Instance) {
    r.mergeRelatedInstances();
    r.attributes.keys().forEach((k: string) => {
      const v: any = r.attributes.get(k);
      if (r instanceof Array || r instanceof Instance) {
        r.attributes.set(k, normalizedResult(v));
      }
    });
    return r.asObject();
  } else {
    return r;
  }
}
