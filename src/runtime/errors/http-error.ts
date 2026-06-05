import { AgentCancelledException } from '../modules/ai.js';
import { lookupCustomErrorMessage } from '../modules/core.js';
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
import { errorFileLogger, logger } from '../logger.js';
import { AppConfig } from '../state.js';
import { AL_RUNTIME_UNHANDLED, isCodedError } from './coded-error.js';

/** Registry of Tier-1 HTTP-facing error codes (documentation / consistency). */
export const AgentlangErrorCodes = {
  AL_RUNTIME_UNHANDLED,
  AL_HTTP_AUTH_REQUIRED: 'AL_HTTP_AUTH_REQUIRED',
  AL_HTTP_HANDLER_EXCEPTION: 'AL_HTTP_HANDLER_EXCEPTION',
} as const;

/** `target` value of an override that applies to any entity for a given code. */
const UNIVERSAL_TARGET = '*';

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

function customMessagesEnabled(): boolean {
  return AppConfig?.customErrorMessages?.enabled === true;
}

/**
 * When custom error messages are enabled, append the error to a dedicated
 * `logs/errors-<DATE>.log` file as a single line: timestamp (added by the logger),
 * error code, and error message. No-op when custom messages are disabled.
 */
export function recordCustomError(code: string, message: string): void {
  if (!customMessagesEnabled()) {
    return;
  }
  try {
    errorFileLogger?.error(`${code} ${message}`);
  } catch (e) {
    logger.warn(`Failed to write error to errors log file: ${e}`);
  }
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

/**
 * Resolve the message for an entity-route error from the `agentlang/errorMessage`
 * system entity. An entity-specific override (`module/Entry`) wins over a universal
 * (`*`) one for the same code; falls back to `defaultMessage` when neither exists or
 * when custom messages are disabled.
 */
export async function resolveEntityErrorMessage(
  moduleName: string,
  entryName: string,
  code: string,
  defaultMessage: string
): Promise<string> {
  if (!customMessagesEnabled()) {
    return defaultMessage;
  }
  let template: string | undefined;
  try {
    const entityKey = `${moduleName}/${entryName}`;
    template =
      (await lookupCustomErrorMessage(entityKey, code)) ??
      (await lookupCustomErrorMessage(UNIVERSAL_TARGET, code));
  } catch (e) {
    logger.warn(`Failed to resolve custom error message for code ${code}: ${e}`);
    return defaultMessage;
  }
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
    ec === 'AL_DB_CHECK_VIOLATION' ||
    ec === 'AL_DB_INVALID_TYPE' ||
    ec === 'AL_MOD_TYPE_MISMATCH' ||
    ec === 'AL_MOD_INVALID_ATTR'
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
