import chalk from 'chalk';
import express, { Request, Response } from 'express';
import {
  getAllEventNames,
  Instance,
  makeInstance,
  objectAsInstanceAttributes,
} from '../runtime/module.js';
import { evaluate, Result } from '../runtime/interpreter.js';
import { makeFqName } from '../runtime/util.js';
import { ApplicationSpec } from '../runtime/loader.js';

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
        handleEventPost(makeFqName(moduleName, n), req, res);
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

function handleEventPost(eventName: string, req: Request, res: Response): void {
  const inst: Instance = makeInstance(eventName, objectAsInstanceAttributes(req.body));
  const result: Result = normalizedResult(evaluate(inst));
  res.send(JSON.stringify(result));
}

function normalizedResult(r: Result): Result {
  if (r instanceof Array) {
    return r.map((x: Result) => {
      return normalizedResult(x);
    });
  } else if (r instanceof Instance) {
    return r.asObject();
  } else {
    return r;
  }
}
