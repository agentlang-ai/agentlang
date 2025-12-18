import { assert } from 'vitest';
import { parseAndIntern } from '../src/runtime/loader.js';
import { isModule } from '../src/runtime/module.js';
import { resetDefaultDatabase } from '../src/runtime/resolvers/sqldb/database.js';
import { testLogger } from './test-logger.js';
import { runPostInitTasks, runPreInitTasks } from '../src/cli/main.js';
import { setRuntimeMode_test } from '../src/runtime/defs.js';

let CoreModulesInited = false;

export async function doPreInit() {
  setRuntimeMode_test()
  if (!CoreModulesInited) {
    await runPreInitTasks();
    CoreModulesInited = true;
  }
}

export async function doInternModule(moduleName: string, code: string) {
  await resetDefaultDatabase();
  await doPreInit();
  await parseAndIntern(`module ${moduleName} ${code}`);
  await runPostInitTasks();
  assert(isModule(moduleName), `Module ${moduleName} not found`);
}

export async function doInitRuntime() {
  await resetDefaultDatabase();
  await doPreInit();
  await runPostInitTasks();
}

function DefaultErrorHandler(err: any): PromiseLike<never> {
  throw new Error(err);
}

export class ErrorHandler {
  isFailed: boolean = false;
  handler: ((r: any) => PromiseLike<never>) | undefined;

  constructor() {
    this.handler = undefined;
  }

  f(): (r: any) => PromiseLike<never> {
    if (this.handler) return this.handler;
    else return DefaultErrorHandler;
  }
}

export function expectError(): ErrorHandler {
  const eh = new ErrorHandler();
  const f = function (err: any) {
    testLogger.verbose(`Expected ${err}`);
    eh.isFailed = true;
  } as (r: any) => PromiseLike<never>;
  eh.handler = f;
  return eh;
}
