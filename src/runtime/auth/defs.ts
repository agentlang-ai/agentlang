import { AppConfig } from '../state.js';

// TODO: AdminUserId must be dynamically set based on auth-service-config and a valid admin-login
export const AdminUserId = '00000000-0000-0000-0000-000000000000';

export function isAuthEnabled(): boolean {
  if (AppConfig && AppConfig.authEnabled == true) {
    return true;
  } else {
    return false;
  }
}

export let InternalRbacEnabled = false;

export function isRbacEnabled(): boolean {
  return InternalRbacEnabled || (isAuthEnabled() && AppConfig?.rbacEnabled == true);
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
