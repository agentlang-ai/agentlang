import { Result } from '../runtime/interpreter.js';
import { Instance } from '../runtime/module.js';
import { requireAuth, verifySession } from '../runtime/modules/auth.js';
import { ActiveSessionInfo, BypassSession, NoSession } from '../runtime/auth/defs.js';

export async function verifyAuth(
  moduleName: string,
  eventName: string,
  authValue: string | undefined
): Promise<ActiveSessionInfo> {
  if (requireAuth(moduleName, eventName)) {
    if (authValue) {
      const token = authValue.substring(authValue.indexOf(' ')).trim();
      return await verifySession(token);
    } else {
      return NoSession;
    }
  }
  return BypassSession;
}

export function normalizedResult(r: Result): Result {
  if (r instanceof Array) {
    return r.map((x: Result) => {
      return normalizedResult(x);
    });
  } else if (Instance.IsInstance(r)) {
    r.mergeRelatedInstances();
    Array.from(r.attributes.keys()).forEach(k => {
      const v: Result = r.attributes.get(k);
      if (v instanceof Array || Instance.IsInstance(v)) {
        r.attributes.set(k, normalizedResult(v));
      }
    });
    return r.asObject();
  } else {
    if (r instanceof Map) {
      return Object.fromEntries(r.entries());
    }
    return r;
  }
}
