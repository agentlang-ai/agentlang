/** Stable bucket for errors without an explicit code. */
export const AL_RUNTIME_UNHANDLED = 'AL_RUNTIME_UNHANDLED';

export type CodedError = Error & { agentlangCode: string };

export function createCodedError(message: string, code: string): CodedError {
  const e = new Error(message) as CodedError;
  e.agentlangCode = code;
  return e;
}

export function isCodedError(err: unknown): err is CodedError {
  return (
    err instanceof Error &&
    typeof (err as CodedError).agentlangCode === 'string' &&
    (err as CodedError).agentlangCode.length > 0
  );
}
