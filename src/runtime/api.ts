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
