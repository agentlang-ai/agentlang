// TODO: AdminUserId must be dynamically set based on auth-service-config and a valid admin-login
export const AdminUserId = '00000000-0000-0000-0000-000000000000';

export const AuthEnabled = true;

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
