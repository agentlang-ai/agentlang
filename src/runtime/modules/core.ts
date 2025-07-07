import { default as ai } from './ai.js';
import { default as auth } from './auth.js';
import { DefaultModuleName } from '../util.js';
import { Instance } from '../module.js';
import { Environment, parseAndEvaluateStatement } from '../interpreter.js';

const CoreModuleDefinition = `module ${DefaultModuleName}
entity timer {
  name String @id,
  duration Int,
  unit @oneof("millisecond", "second", "minute", "hour") @default("second"),
  trigger String,
  status @oneof("I", "C", "R") @default("I") // Inited, Cancelled, Running
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
