import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentCancelledException } from '../modules/ai.js';
import {
  BadRequestError,
  CodeMismatchError,
  ExpiredCodeError,
  InvalidParameterError,
  PasswordResetRequiredError,
  TooManyRequestsError,
  UnauthorisedError,
  UserNotConfirmedError,
  UserNotFoundError,
} from '../defs.js';
import { logger } from '../logger.js';
import { AppConfig } from '../state.js';
import { AL_RUNTIME_UNHANDLED, isCodedError } from './coded-error.js';

/** Registry of Tier-1 HTTP-facing error codes (documentation / consistency). */
export const AgentlangErrorCodes = {
  AL_RUNTIME_UNHANDLED,
  AL_HTTP_AUTH_REQUIRED: 'AL_HTTP_AUTH_REQUIRED',
  AL_HTTP_HANDLER_EXCEPTION: 'AL_HTTP_HANDLER_EXCEPTION',
} as const;

const DEFAULT_ERRORS_FILE = 'errors.json';

/** Universal: error code -> template string. Entity: `module/Entry` -> code -> template. */
export type ParsedErrorMessages = {
  universal: Record<string, string>;
  byEntity: Record<string, Record<string, string>>;
};

let parsedErrorMessages: ParsedErrorMessages = { universal: {}, byEntity: {} };

export function getParsedErrorMessages(): ParsedErrorMessages {
  return parsedErrorMessages;
}

/** Replace `{{code}}` and `{{message}}` with runtime values (iterates until stable). */
export function applyErrorMessageTemplate(
  template: string,
  code: string,
  originalMessage: string
): string {
  let out = template;
  const maxPasses = 10;
  for (let i = 0; i < maxPasses; i++) {
    const next = out.replace(/\{\{code\}\}/g, code).replace(/\{\{message\}\}/g, originalMessage);
    if (next === out) break;
    out = next;
  }
  return out;
}

function validateOverridesJson(data: unknown): ParsedErrorMessages {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('errors.json must be a JSON object at the root');
  }
  const universal: Record<string, string> = {};
  const byEntity: Record<string, Record<string, string>> = {};
  for (const [topKey, val] of Object.entries(data as Record<string, unknown>)) {
    if (typeof val === 'string') {
      universal[topKey] = val;
      continue;
    }
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const codes: Record<string, string> = {};
      for (const [code, msg] of Object.entries(val as Record<string, unknown>)) {
        if (typeof msg !== 'string') {
          throw new Error(`errors.json: "${topKey}" / "${code}" must map to a string message`);
        }
        codes[code] = msg;
      }
      byEntity[topKey] = codes;
      continue;
    }
    throw new Error(
      `errors.json: value for "${topKey}" must be a string (global code) or an object (per-entity map)`
    );
  }
  return { universal, byEntity };
}

function resolveCustomErrorFilePath(configDir: string, fileName: string | undefined): string {
  const name = fileName?.trim() || DEFAULT_ERRORS_FILE || DEFAULT_ERRORS_FILE;
  const resolved = path.resolve(configDir, name);
  const root = path.resolve(configDir);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      'customErrorMessages.fileName must resolve within the application config directory'
    );
  }
  return resolved;
}

export type CustomErrorMessagesConfig = {
  enabled?: boolean;
  fileName?: string;
};

/**
 * Load custom error messages when `customErrorMessages.enabled` is true.
 * Clears overrides when disabled or when configDir is omitted (and disabled).
 */
export async function initErrorMessageOverrides(
  configDir: string | undefined,
  customErrorMessages: CustomErrorMessagesConfig | undefined
): Promise<void> {
  parsedErrorMessages = { universal: {}, byEntity: {} };
  if (!customErrorMessages?.enabled) {
    return;
  }
  if (!configDir) {
    throw new Error(
      'customErrorMessages.enabled is true but application config directory is not available'
    );
  }
  const filePath = resolveCustomErrorFilePath(configDir, customErrorMessages.fileName);
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Custom errors file is not valid JSON: ${e?.message ?? e}`);
  }
  parsedErrorMessages = validateOverridesJson(parsed);
}

function customMessagesEnabled(): boolean {
  return AppConfig?.customErrorMessages?.enabled === true;
}

export function getErrorCode(err: unknown): string {
  if (isCodedError(err)) {
    return err.agentlangCode;
  }
  if (err instanceof UnauthorisedError) {
    return err.agentlangCode;
  }
  if (err instanceof BadRequestError) {
    return err.agentlangCode;
  }
  if (err instanceof UserNotFoundError) {
    return err.agentlangCode;
  }
  if (err instanceof UserNotConfirmedError) {
    return err.agentlangCode;
  }
  if (err instanceof PasswordResetRequiredError) {
    return err.agentlangCode;
  }
  if (err instanceof TooManyRequestsError) {
    return err.agentlangCode;
  }
  if (err instanceof InvalidParameterError) {
    return err.agentlangCode;
  }
  if (err instanceof ExpiredCodeError) {
    return err.agentlangCode;
  }
  if (err instanceof CodeMismatchError) {
    return err.agentlangCode;
  }
  if (err instanceof AgentCancelledException) {
    return err.agentlangCode;
  }
  return AL_RUNTIME_UNHANDLED;
}

export function resolveEntityErrorMessage(
  moduleName: string,
  entryName: string,
  code: string,
  defaultMessage: string
): string {
  if (!customMessagesEnabled()) {
    return defaultMessage;
  }
  const entityKey = `${moduleName}/${entryName}`;
  const entityTemplate = parsedErrorMessages.byEntity[entityKey]?.[code];
  const universalTemplate = parsedErrorMessages.universal[code];
  const template = entityTemplate ?? universalTemplate;
  if (template === undefined) {
    return defaultMessage;
  }
  return applyErrorMessageTemplate(template, code, defaultMessage);
}

export function httpStatusFromError(err: unknown): number {
  const ec = getErrorCode(err);
  if (ec === 'AL_DB_UNIQUE_VIOLATION') {
    return 409;
  }
  if (
    ec === 'AL_DB_FOREIGN_KEY_VIOLATION' ||
    ec === 'AL_DB_NOT_NULL_VIOLATION' ||
    ec === 'AL_DB_CHECK_VIOLATION'
  ) {
    return 400;
  }
  if (
    ec === 'AL_DB_DEADLOCK' ||
    ec === 'AL_DB_LOCK_WAIT_TIMEOUT' ||
    ec === 'AL_DB_SERIALIZATION_FAILURE'
  ) {
    return 503;
  }
  if (ec === 'AL_DB_SYNTAX_ERROR' || ec === 'AL_DB_QUERY_FAILED') {
    return 500;
  }
  if (err instanceof UserNotFoundError) {
    return 404;
  }
  if (err instanceof UnauthorisedError) {
    return 401;
  }
  if (err instanceof TooManyRequestsError) {
    return 429;
  }
  if (err instanceof BadRequestError || err instanceof InvalidParameterError) {
    return 400;
  }
  if (err instanceof ExpiredCodeError || err instanceof CodeMismatchError) {
    return 400;
  }
  if (err instanceof UserNotConfirmedError || err instanceof PasswordResetRequiredError) {
    return 403;
  }
  if (err instanceof Error && err.message) {
    if (
      err.message.includes('temporarily unavailable') ||
      err.message.includes('service error') ||
      err.message.includes('configuration error')
    ) {
      return 503;
    }
    if (err.message.includes('contact support')) {
      return 500;
    }
  }
  return 500;
}

export function logEntityRouteError(reason: unknown, agentlangCode: string): void {
  if (reason instanceof Error) {
    const stack = reason.stack ? `\n${reason.stack}` : '';
    logger.error(`[${agentlangCode}] ${reason.name}: ${reason.message}${stack}`);
  } else {
    logger.error(`[${agentlangCode}] ${String(reason)}`);
  }
}
