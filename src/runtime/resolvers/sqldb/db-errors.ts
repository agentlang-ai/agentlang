import { QueryFailedError } from 'typeorm';
import { createCodedError, isCodedError } from '../../errors/coded-error.js';

/**
 * Normalize TypeORM / driver failures into stable Agentlang codes for HTTP and logging.
 * Preserves the original message text on the thrown Error.
 */
export function mapDatabaseError(err: unknown): never {
  if (isCodedError(err)) {
    throw err;
  }

  const anyErr = err as any;
  const msg = anyErr instanceof Error ? anyErr.message : String(err);
  const driver = anyErr?.driverError ?? anyErr;
  const sqlState =
    driver?.code !== undefined && driver?.code !== null
      ? String(driver.code)
      : anyErr?.code !== undefined && anyErr?.code !== null
        ? String(anyErr.code)
        : undefined;
  const errno = driver?.errno ?? anyErr?.errno;

  // PostgreSQL (SQLSTATE)
  if (sqlState === '23505') {
    throw createCodedError(msg, 'AL_DB_UNIQUE_VIOLATION');
  }
  if (sqlState === '23503') {
    throw createCodedError(msg, 'AL_DB_FOREIGN_KEY_VIOLATION');
  }
  if (sqlState === '23502') {
    throw createCodedError(msg, 'AL_DB_NOT_NULL_VIOLATION');
  }
  if (sqlState === '23514') {
    throw createCodedError(msg, 'AL_DB_CHECK_VIOLATION');
  }
  // Invalid text representation / datetime / numeric range (e.g. non-UUID passed to a UUID column).
  if (sqlState === '22P02' || sqlState === '22007' || sqlState === '22003') {
    throw createCodedError(msg, 'AL_DB_INVALID_TYPE');
  }
  if (sqlState === '40P01') {
    throw createCodedError(msg, 'AL_DB_DEADLOCK');
  }
  if (sqlState === '40001' || sqlState === '25P02') {
    throw createCodedError(msg, 'AL_DB_SERIALIZATION_FAILURE');
  }

  // MySQL / MariaDB (errno)
  if (errno === 1062) {
    throw createCodedError(msg, 'AL_DB_UNIQUE_VIOLATION');
  }
  if (errno === 1451 || errno === 1452) {
    throw createCodedError(msg, 'AL_DB_FOREIGN_KEY_VIOLATION');
  }
  if (errno === 1048) {
    throw createCodedError(msg, 'AL_DB_NOT_NULL_VIOLATION');
  }
  if (errno === 1213) {
    throw createCodedError(msg, 'AL_DB_DEADLOCK');
  }
  if (errno === 1205) {
    throw createCodedError(msg, 'AL_DB_LOCK_WAIT_TIMEOUT');
  }
  if (errno === 1366 || errno === 1292) {
    throw createCodedError(msg, 'AL_DB_INVALID_TYPE');
  }

  const m = msg.toLowerCase();

  // Cross-driver message heuristics (SQLite, sql.js, edge cases)
  if (
    /unique constraint|duplicate key value|duplicate entry|unique failed|constraint failed.*unique/i.test(
      m
    )
  ) {
    throw createCodedError(msg, 'AL_DB_UNIQUE_VIOLATION');
  }
  if (/foreign key constraint|foreign key mismatch|references.*fails/i.test(m)) {
    throw createCodedError(msg, 'AL_DB_FOREIGN_KEY_VIOLATION');
  }
  if (/not-null constraint|null value in column|cannot be null|not null constraint/i.test(m)) {
    throw createCodedError(msg, 'AL_DB_NOT_NULL_VIOLATION');
  }
  if (/check constraint/i.test(m)) {
    throw createCodedError(msg, 'AL_DB_CHECK_VIOLATION');
  }
  if (/deadlock/i.test(m)) {
    throw createCodedError(msg, 'AL_DB_DEADLOCK');
  }
  if (/lock wait timeout|could not obtain lock/i.test(m)) {
    throw createCodedError(msg, 'AL_DB_LOCK_WAIT_TIMEOUT');
  }
  if (/could not serialize|serialization failure/i.test(m)) {
    throw createCodedError(msg, 'AL_DB_SERIALIZATION_FAILURE');
  }
  if (/invalid input syntax|incorrect .* value|out of range|datatype mismatch/i.test(m)) {
    throw createCodedError(msg, 'AL_DB_INVALID_TYPE');
  }

  if (anyErr instanceof QueryFailedError && /syntax error|parse error/i.test(m)) {
    throw createCodedError(msg, 'AL_DB_SYNTAX_ERROR');
  }

  if (anyErr instanceof QueryFailedError) {
    throw createCodedError(msg, 'AL_DB_QUERY_FAILED');
  }

  if (anyErr instanceof Error) {
    throw createCodedError(msg, 'AL_DB_QUERY_FAILED');
  }

  throw createCodedError(String(err), 'AL_DB_QUERY_FAILED');
}
