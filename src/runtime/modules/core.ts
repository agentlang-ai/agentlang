import { default as ai } from './ai.js';
import { default as auth } from './auth.js';
import { DefaultModuleName } from '../util.js';
import { Instance, isInstanceOfType } from '../module.js';
import { Environment, parseAndEvaluateStatement } from '../interpreter.js';
import { logger } from '../logger.js';

const CoreModuleDefinition = `module ${DefaultModuleName}
entity timer {
  name String @id,
  duration Int,
  unit @oneof("millisecond", "second", "minute", "hour") @default("second"),
  trigger String,
  status @oneof("I", "C", "R") @default("I") // Inited, Cancelled, Running
}

entity auditlog {
  id UUID @id @default(uuid()),
  action @oneof("c", "d", "u"), // Create, Delete, Update
  resource String, // __path__
  timestamp DateTime @default(now()),
  previous_value Any @optional,
  user String,
  token String @optional
}
`;
export const CoreModules: string[] = [];

export function registerCoreModules() {
  CoreModules.push(CoreModuleDefinition);
  [auth, ai].forEach((mdef: string) => {
    CoreModules.push(mdef);
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
  const r: any = await parseAndEvaluateStatement(
    `{agentlang/auditlog {
        action "${action}",
        previous_value "${previuos_value ? JSON.stringify(previuos_value.asObject()) : ''}",
        user "${user}",
        token "${token ? token : ''}"
}}`,
    undefined,
    env
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
