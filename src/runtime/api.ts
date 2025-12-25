import { fetchConfig as al_fetchConfig } from './interpreter.js';
import {
  makeInstance as al_makeInstance,
  isInstanceOfType as al_isInstanceOfType,
} from './module.js';
import { getLocalEnv as al_getLocalEnv, setLocalEnv as al_setLocalEnv } from './auth/defs.js';

declare global {
  var agentlang: any | undefined;
  function getLocalEnv(k: string, defaultValue?: string): string | undefined;
  function setLocalEnv(k: string, v: string): string;
}

let ApiInited = false;

export function initGlobalApi() {
  if (!ApiInited) {
    globalThis.agentlang = {};
    globalThis.agentlang.makeInstance = al_makeInstance;
    globalThis.agentlang.isInstanceOfType = al_isInstanceOfType;
    globalThis.agentlang.fetchConfig = al_fetchConfig;

    // Expose environment variable functions globally (like readSecret pattern)
    globalThis.getLocalEnv = al_getLocalEnv;
    globalThis.setLocalEnv = al_setLocalEnv;

    ApiInited = true;
  }
}
