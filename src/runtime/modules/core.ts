import { default as auth } from './auth.js';

export const CoreModules: string[] = [];

export function registerCoreModule(moduleDef: string) {
  CoreModules.push(moduleDef);
}

registerCoreModule(auth);
