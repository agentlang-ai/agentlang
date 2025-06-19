import { default as auth } from './auth.js';
import { default as ai } from './ai.js';

export const CoreModules: string[] = [];

function registerCoreModules(moduleDefs: string[]) {
  moduleDefs.forEach((mdef: string) => {
    CoreModules.push(mdef);
  });
}

registerCoreModules([auth, ai]);
