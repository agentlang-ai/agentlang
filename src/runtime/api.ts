import { fetchConfig as al_fetchConfig } from './interpreter.js';
import {
  makeInstance as al_makeInstance,
  isInstanceOfType as al_isInstanceOfType,
} from './module.js';
import { getLocalEnv as al_getLocalEnv, setLocalEnv as al_setLocalEnv } from './auth/defs.js';
import { now } from './util.js';
import { initDateFns } from './datefns.js';

declare global {
  var agentlang: any | undefined;
  var dateFns: ReturnType<typeof initDateFns> | undefined;
  function getLocalEnv(k: string, defaultValue?: string): string | undefined;
  function setLocalEnv(k: string, v: string): string;
  function uuid(): string;
  function now(): string;
}

let ApiInited = false;

export function initGlobalApi() {
  if (!ApiInited) {
    globalThis.agentlang = {};
    globalThis.agentlang.makeInstance = al_makeInstance;
    globalThis.agentlang.isInstanceOfType = al_isInstanceOfType;
    globalThis.agentlang.fetchConfig = al_fetchConfig;

    globalThis.uuid = () => {
      return crypto.randomUUID();
    };
    globalThis.now = now;

    // Expose environment variable functions globally (like readSecret pattern)
    globalThis.getLocalEnv = al_getLocalEnv;
    globalThis.setLocalEnv = al_setLocalEnv;

    // Expose date-fns functions globally as dateFns.*
    globalThis.dateFns = initDateFns();

    ApiInited = true;
  }
}
