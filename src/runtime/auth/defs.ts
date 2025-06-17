export const AdminUserId = '00000000-0000-0000-0000-000000000000';

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
