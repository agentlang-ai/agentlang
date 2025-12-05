import { fetchConfig as al_fetchConfig } from './interpreter.js';
import {
  makeInstance as al_makeInstance,
  isInstanceOfType as al_isInstanceOfType,
} from './module.js';

declare global {
  var agentlang: any | undefined;
}

let ApiInited = false;

export function initGlobalApi() {
  if (!ApiInited) {
    globalThis.agentlang = {};
    globalThis.agentlang.makeInstance = al_makeInstance;
    globalThis.agentlang.isInstanceOfType = al_isInstanceOfType;
    globalThis.agentlang.fetchConfig = al_fetchConfig;
    ApiInited = true;
  }
}

// Global function directly accesible from workflows
declare global {
  function raiseError(reason: any): any;
}

globalThis.raiseError = (reason: any): any => {
  throw new Error(reason);
};
