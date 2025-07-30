import { default as ai } from './ai.js';
import { default as auth } from './auth.js';
import { DefaultModuleName, DefaultModules } from '../util.js';
import { Instance, isInstanceOfType } from '../module.js';
import { Environment, evaluateStatements, parseAndEvaluateStatement } from '../interpreter.js';
import { logger } from '../logger.js';
import { Statement } from '../../language/generated/ast.js';
import { parseStatements } from '../../language/parser.js';

const CoreModuleDefinition = `module ${DefaultModuleName}

import "./modules/core.js" as Core

entity timer {
  name String @id,
  duration Int,
  unit @enum("millisecond", "second", "minute", "hour") @default("second"),
  trigger String,
  status @enum("I", "C", "R") @default("I") // Inited, Cancelled, Running
}

entity auditlog {
  id UUID @id @default(uuid()),
  action @enum("c", "d", "u"), // Create, Delete, Update
  resource String, // __path__
  timestamp DateTime @default(now()),
  previous_value Any @optional,
  user String,
  token String @optional
}

entity suspension {
  id UUID @id,
  continuation String[], // rest of the patterns to execute
  env String, // serialized environment-object
  createdOn DateTime @default(now()),
  createdBy String
}

workflow restartSuspension {
  await Core.restartSuspension(restartSuspension.id)
}
`;
export const CoreModules: string[] = [];

export function registerCoreModules() {
  DefaultModules.add(DefaultModuleName);
  CoreModules.push(CoreModuleDefinition);
  [auth, ai].forEach((mdef: string) => {
    CoreModules.push(mdef);
    DefaultModules.add(mdef);
  });
}

export function setTimerRunning(timerInst: Instance) {
  timerInst.attributes.set('status', 'R');
}

export async function maybeCancelTimer(name: string, timer: NodeJS.Timeout, env: Environment) {
  await parseAndEvaluateStatement(`{agentlang/timer {name? "${name}"}}`, undefined, env).then(
    (result: any) => {
      if (result == null || (result instanceof Array && result.length == 0)) {
        clearInterval(timer);
      }
    }
  );
}

async function addAudit(
  env: Environment,
  action: 'c' | 'd' | 'u',
  resource: string,
  previuos_value?: Instance
) {
  const user = env.getActiveUser();
  const token = env.getActiveToken();
  const newEnv = new Environment('auditlog', env).setInKernelMode(true);
  const r: any = await parseAndEvaluateStatement(
    `{agentlang/auditlog {
        action "${action}",
        resource "${resource}",
        previous_value "${previuos_value ? JSON.stringify(previuos_value.asObject()) : ''}",
        user "${user}",
        token "${token ? token : ''}"
}}`,
    undefined,
    newEnv
  );
  if (!isInstanceOfType(r, 'agentlang/auditlog')) {
    logger.warn(
      `Failed to create auditlog for action ${action} and resource ${resource} for user ${user}`
    );
  }
}

export async function addCreateAudit(resource: string, env: Environment) {
  await addAudit(env, 'c', resource);
}

export async function addDeleteAudit(
  resource: string,
  previous_value: Instance | undefined,
  env: Environment
) {
  await addAudit(env, 'd', resource, previous_value);
}

export async function addUpdateAudit(
  resource: string,
  previous_value: Instance | undefined,
  env: Environment
) {
  await addAudit(env, 'u', resource, previous_value);
}

export async function createSuspension(
  suspId: string,
  continuation: string[],
  env: Environment
): Promise<string | undefined> {
  const user = env.getActiveUser();
  const newEnv = new Environment('auditlog', env).setInKernelMode(true);
  const r: any = await parseAndEvaluateStatement(
    `{agentlang/suspension {
        id "${suspId}",
        continuation ${continuation}",
        env "${env.asSerializableObject()}",
        createdBy "${user}"
}}`,
    undefined,
    newEnv
  );
  if (!isInstanceOfType(r, 'agentlang/suspension')) {
    logger.warn(`Failed to create suspension for user ${user}`);
    return undefined;
  }
  return (r as Instance).lookup('id');
}

export type Suspension = {
  continuation: Statement[];
  env: Environment;
};

async function loadSuspension(suspId: string, env?: Environment): Promise<Suspension | undefined> {
  const newEnv = new Environment('auditlog', env).setInKernelMode(true);
  const r: any = await parseAndEvaluateStatement(
    `{agentlang/suspension {id? "${suspId}"}}`,
    undefined,
    newEnv
  );
  if (r instanceof Array && r.length > 0) {
    const inst: Instance = r[0];
    const stmts: Statement[] = await parseStatements(inst.lookup('continuation'));
    const suspEnv: Environment = Environment.FromSerializableObject(inst.lookup('env'));
    return {
      continuation: stmts,
      env: suspEnv,
    };
  }
  return undefined;
}

async function deleteSuspension(suspId: string, env?: Environment): Promise<any> {
  try {
    await parseAndEvaluateStatement(
      `purge {agentlang/suspension {id? "${suspId}"}}`,
      undefined,
      env
    );
    return suspId;
  } catch (err: any) {
    logger.warn(`Failed to delete suspension ${suspId} - ${err}`);
    return undefined;
  }
}

export async function restartSuspension(suspId: string, env?: Environment): Promise<any> {
  const susp = await loadSuspension(suspId, env);
  if (susp) {
    await evaluateStatements(susp.continuation, susp.env);
    await deleteSuspension(suspId, env);
    return susp.env.getLastResult();
  } else {
    logger.warn(`Suspension ${suspId} not found`);
    return undefined;
  }
}
