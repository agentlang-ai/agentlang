import { AppConfig } from '../state.js';

// TODO: AdminUserId must be dynamically set based on auth-service-config and a valid admin-login
export const AdminUserId = '00000000-0000-0000-0000-000000000000';

export function isAuthEnabled(): boolean {
  if (AppConfig?.auth?.enabled == true) {
    return true;
  } else {
    return false;
  }
}

export let InternalRbacEnabled = false;

export function isRbacEnabled(): boolean {
  return InternalRbacEnabled || (isAuthEnabled() && AppConfig?.rbac?.enabled == true);
}

export async function callWithRbac(f: Function): Promise<void> {
  const old = InternalRbacEnabled;
  InternalRbacEnabled = true;
  try {
    await f();
  } finally {
    InternalRbacEnabled = old;
  }
}

export type ActiveSessionInfo = {
  sessionId: string;
  userId: string;
};

export const AdminSession: ActiveSessionInfo = {
  sessionId: crypto.randomUUID(),
  userId: AdminUserId,
};

export const BypassSession = AdminSession;

export const NoSession: ActiveSessionInfo = {
  sessionId: 'nil',
  userId: 'nil',
};

export function isNoSession(sess: ActiveSessionInfo): boolean {
  return sess == NoSession;
}

const LocalEnv = new Map<string, string>();

export function setLocalEnv(k: string, v: string): string {
  LocalEnv.set(k, v);
  return v;
}

/**
 * Get environment variable with multi-source lookup
 * Priority: 1) LocalEnv Map (explicit overrides), 2) process.env (Node.js), 3) defaultValue
 *
 * @param k - Environment variable key
 * @param defaultValue - Optional default value if key not found
 * @returns The value from highest priority source, or undefined
 */
export function getLocalEnv(k: string, defaultValue?: string): string | undefined {
  // Priority 1: Explicitly set values in LocalEnv Map (highest priority)
  const localValue = LocalEnv.get(k);
  if (localValue !== undefined) {
    return localValue;
  }

  // Priority 2: Node.js process.env (if in Node.js environment)
  if (typeof process !== 'undefined' && process.env) {
    const envValue = process.env[k];
    if (envValue !== undefined) {
      return envValue;
    }
  }

  // Priority 3: Default value (if provided)
  return defaultValue;
}
