import { fetchConfig as al_fetchConfig } from './interpreter.js';
import {
  makeInstance as al_makeInstance,
  isInstanceOfType as al_isInstanceOfType,
} from './module.js';

export const makeInstance = al_makeInstance;
export const isInstanceOfType = al_isInstanceOfType;
export const fetchConfig = al_fetchConfig;
