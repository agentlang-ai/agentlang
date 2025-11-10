import { default as ai } from './ai.js';
import { default as auth } from './auth.js';
import { default as files } from './files.js';
import { DefaultModuleName, DefaultModules, escapeSpecialChars } from '../util.js';
import { Instance, isInstanceOfType, makeInstance, newInstanceAttributes } from '../module.js';
import {
  Environment,
  evaluate,
  evaluateStatements,
  parseAndEvaluateStatement,
  restartFlow,
} from '../interpreter.js';
import { logger } from '../logger.js';
import { Statement } from '../../language/generated/ast.js';
import { parseModule, parseStatements } from '../../language/parser.js';
import { Resolver } from '../resolvers/interface.js';
import { FlowSuspensionTag, ForceReadPermFlag, PathAttributeName } from '../defs.js';
import { getMonitor, getMonitorsForEvent, Monitor } from '../monitor.js';

const CoreModuleDefinition = `module ${DefaultModuleName}

import "./modules/core.js" @as Core

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
  env Any, // serialized environment-object
  createdOn DateTime @default(now()),
  createdBy String
}

entity activeSuspension {
  id UUID @id
}

resolver suspensionResolver ["${DefaultModuleName}/activeSuspension"] {
    query Core.lookupActiveSuspension
}

workflow createSuspension {
  {suspension
    {id createSuspension.id
     continuation createSuspension.continuation,
     env createSuspension.env,
     createdBy createSuspension.createdBy}}
}

@public workflow restartSuspension {
  await Core.restartSuspension(restartSuspension.id, restartSuspension.data)
}

entity Monitor {
  id String @id,
  eventInstance Any,
  eventName String @indexed,
  user String @optional,
  totalLatencyMs Int,
  data String
}

@public event fetchEventMonitor {
  eventName String
}

workflow fetchEventMonitor {
  {Monitor {eventName? fetchEventMonitor.eventName}} @as [m]
  Core.eventMonitorData(m)
}

@public event fetchEventMonitors {
  eventName String,
  limit Int @default(0),
  offset Int @default(0)
}

workflow fetchEventMonitors {
  {Monitor {eventName? fetchEventMonitors.eventName}} @as result
  Core.eventMonitorsData(result, fetchEventMonitors.limit, fetchEventMonitors.offset)
}

@public event EventMonitor {
  id String
}

workflow EventMonitor {
  {Monitor {id? EventMonitor.id}} @as [m];
  Core.eventMonitorData(m)
}

record ValidationRequest {
    data Any
}

record ValidationResult {
    status @enum("ok", "error"),
    reason String @optional
}

event validateModule extends ValidationRequest {
}

workflow validateModule {
  await Core.validateModule(validateModule.data)
}
`;

export const CoreModules: string[] = [];

export function registerCoreModules() {
  DefaultModules.add(DefaultModuleName);
  CoreModules.push(CoreModuleDefinition);
  [auth, ai, files].forEach((mdef: string) => {
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
      if (result === null || (result instanceof Array && result.length == 0)) {
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
  newEnv.bind(ForceReadPermFlag, true);
  const r: any = await parseAndEvaluateStatement(
    `{agentlang/auditlog {
        action "${action}",
        resource "${resource}",
        previous_value "${previuos_value ? escapeSpecialChars(JSON.stringify(previuos_value.asObject())) : ''}",
        user "${user}",
        token "${token ? token : ''}"
}}`,
    user,
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
  const newEnv = new Environment('susp', env).setInKernelMode(true);
  const envObj = env.asSerializableObject();
  const inst = makeInstance(
    'agentlang',
    'createSuspension',
    newInstanceAttributes()
      .set('id', suspId)
      .set('continuation', continuation)
      .set('env', envObj)
      .set('createdBy', user)
  );
  const r: any = await evaluate(inst, undefined, newEnv);
  if (!isInstanceOfType(r, 'agentlang/suspension')) {
    logger.warn(`Failed to create suspension for user ${user}`);
    return undefined;
  }
  return (r as Instance).lookup('id');
}

export type Suspension = {
  continuation: Statement[];
  flowContext?: string[];
  env: Environment;
};

function isFlowSuspension(cont: string[]): boolean {
  return cont.length > 0 && cont[0] == FlowSuspensionTag;
}

async function loadSuspension(suspId: string, env?: Environment): Promise<Suspension | undefined> {
  const newEnv = new Environment('auditlog', env).setInKernelMode(true);
  const r: any = await parseAndEvaluateStatement(
    `{agentlang/suspension {id? "${suspId}"}}`,
    undefined,
    newEnv
  );
  if (r instanceof Array && r.length > 0) {
    const inst: Instance = r[0];
    const cont = inst.lookup('continuation');
    const ifs = isFlowSuspension(cont);
    const stmts: Statement[] = ifs ? new Array<Statement>() : await parseStatements(cont);
    const envStr = inst.lookup('env');
    const suspEnv: Environment = Environment.FromSerializableObject(JSON.parse(envStr));
    return {
      continuation: stmts,
      env: suspEnv,
      flowContext: ifs ? cont : undefined,
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

export async function restartSuspension(
  suspId: string,
  userData: string,
  env?: Environment
): Promise<any> {
  const susp = await loadSuspension(suspId, env);
  if (susp) {
    if (susp.flowContext) {
      await restartFlow(susp.flowContext, userData, susp.env);
    } else {
      susp.env.bindSuspensionUserData(userData);
      await evaluateStatements(susp.continuation, susp.env);
    }
    await deleteSuspension(suspId, env);
    return susp.env.getLastResult();
  } else {
    logger.warn(`Suspension ${suspId} not found`);
    return undefined;
  }
}

export async function lookupActiveSuspension(
  resolver: Resolver,
  inst: Instance,
  queryAll: boolean
) {
  if (!queryAll) {
    const data = inst.lookupQueryVal(PathAttributeName).split('/')[1];
    if (data) {
      const parts = data.split(':');
      const id = parts[0];
      const userData = parts[1];
      return await restartSuspension(id, userData, resolver.getEnvironment());
    } else {
      return [];
    }
  } else {
    return [];
  }
}

export async function flushMonitoringData(monitorId: string) {
  const m = getMonitor(monitorId);
  try {
    if (m) {
      const data = btoa(JSON.stringify(m.asObject()));
      const inst = m.getEventInstance();
      const eventInstance = inst ? btoa(JSON.stringify(inst.asSerializableObject())) : '';
      const user = m.getUser() || 'admin';
      const latency = m.getTotalLatencyMs();
      const env = new Environment(`monitor-${monitorId}-env`);
      const eventName = inst ? inst.getFqName() : monitorId;
      await parseAndEvaluateStatement(
        `{agentlang/Monitor {id "${monitorId}", eventName "${eventName}", eventInstance "${eventInstance}", user "${user}", totalLatencyMs ${latency}, data "${data}"}}`,
        undefined,
        env
      );
      await env.commitAllTransactions();
    } else {
      logger.warn(`Failed to locate monitor with id ${monitorId}`);
    }
  } catch (reason: any) {
    logger.error(`Failed to flush monitor ${monitorId} - ${reason}`);
  }
}

export async function fetchLatestMonitorForEvent(eventName: string): Promise<any> {
  const monitors = getMonitorsForEvent(eventName);
  const len = monitors.length;
  if (len > 0) {
    return [monitors[len - 1].asObject()];
  }
  return [];
}

export async function fetchMonitorsForEvent(
  eventName: string,
  limit: number,
  offset: number
): Promise<any> {
  const monitors = getMonitorsForEvent(eventName);
  const r = limit === 0 ? monitors : monitors.slice(offset, offset + limit);
  if (r.length > 0) {
    return r.map((m: Monitor) => {
      return m.asObject();
    });
  }
  return [];
}

export function eventMonitorData(inst: Instance | null | undefined): any {
  if (inst) return JSON.parse(atob(inst.lookup('data')));
  else return null;
}

export function eventMonitorsData(
  insts: Instance[] | null | undefined,
  limit?: number,
  offset?: number
): any {
  if (insts) {
    if (limit !== undefined && offset !== undefined) {
      insts = limit === 0 ? insts : insts.slice(offset, offset + limit);
    }
    return insts.map((inst: Instance) => {
      return eventMonitorData(inst);
    });
  } else return null;
}

export async function validateModule(moduleDef: string): Promise<Instance> {
  try {
    await parseModule(moduleDef);
    return makeInstance(
      'agentlang',
      'ValidationResult',
      newInstanceAttributes().set('status', 'ok')
    );
  } catch (reason: any) {
    return makeInstance(
      'agentlang',
      'ValidationResult',
      newInstanceAttributes().set('status', 'error').set('reason', `${reason}`)
    );
  }
}
