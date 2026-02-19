import { ActiveSessionInfo } from '../auth/defs.js';

export type SubscriptionEnvelope<T = any> = {
  tenantId: string;
  userId: string;
  data: T;
};

export function createSubscriptionEnvelope<T>(
  tenantId: string,
  userId: string,
  data: T
): SubscriptionEnvelope<T> {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('SubscriptionEnvelope requires a non-empty tenantId');
  }
  if (!userId || userId.trim().length === 0) {
    throw new Error('SubscriptionEnvelope requires a non-empty userId');
  }
  return { tenantId, userId, data };
}

export function isSubscriptionEnvelope(obj: any): obj is SubscriptionEnvelope {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === 'object' &&
    typeof obj.tenantId === 'string' &&
    typeof obj.userId === 'string' &&
    'data' in obj
  );
}

export function envelopeToSessionInfo(envelope: SubscriptionEnvelope): ActiveSessionInfo {
  return {
    sessionId: crypto.randomUUID(),
    userId: envelope.userId,
  };
}
