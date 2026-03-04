import { makeCoreModuleName } from '../util.js';
import { Instance } from '../module.js';
import { GenericResolver, Resolver } from '../resolvers/interface.js';
import { registerResolver, setResolver } from '../resolvers/registry.js';
import { logger } from '../logger.js';

export const CoreMessagingModuleName = makeCoreModuleName('messaging');

function getAgentManagerUrl(): string {
  return (
    (globalThis as any).__agentmanager_url ||
    process.env.AGENTMANAGER_URL ||
    'http://localhost:3001'
  );
}

export async function pushNotification(_: Resolver, inst: Instance) {
  const inbox = inst.lookup('inbox');
  const subject = inst.lookup('subject');
  const body = inst.lookup('body');
  const fromKind = inst.lookup('fromKind') || 'employee';
  const fromId = inst.lookup('fromId');

  const url = `${getAgentManagerUrl()}/api/inboxes/${encodeURIComponent(inbox)}/messages`;
  const payload = {
    from: { kind: fromKind, id: fromId },
    subject,
    body,
    kind: 'notification',
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      logger.error(`Failed to push notification to inbox ${inbox}: HTTP ${response.status} — ${text}`);
    }
    return inst;
  } catch (err: any) {
    logger.error(`Failed to push notification to inbox ${inbox}: ${err.message}`);
    return inst;
  }
}

export async function pushAction(_: Resolver, inst: Instance) {
  const inbox = inst.lookup('inbox');
  const subject = inst.lookup('subject');
  const body = inst.lookup('body');
  const fromKind = inst.lookup('fromKind') || 'employee';
  const fromId = inst.lookup('fromId');
  const responses: string[] = inst.lookup('responses') || [];
  const continuationEvents: string[] = inst.lookup('continuationEvents') || [];
  const inputPrompt: string | undefined = inst.lookup('inputPrompt');

  // Zip responses and continuationEvents into a continuations map
  const continuations: Record<string, { event: string }> = {};
  for (let i = 0; i < responses.length; i++) {
    const eventName = i < continuationEvents.length ? continuationEvents[i] : '';
    if (eventName) {
      continuations[responses[i]] = { event: eventName };
    }
  }

  const url = `${getAgentManagerUrl()}/api/inboxes/${encodeURIComponent(inbox)}/messages`;
  const payload: any = {
    from: { kind: fromKind, id: fromId },
    subject,
    body,
    kind: 'action',
    action: {
      responses,
      continuations,
      ...(inputPrompt ? { inputPrompt } : {}),
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      logger.error(`Failed to push action to inbox ${inbox}: HTTP ${response.status} — ${text}`);
    }
    return inst;
  } catch (err: any) {
    logger.error(`Failed to push action to inbox ${inbox}: ${err.message}`);
    return inst;
  }
}

export async function queryInbox(_: Resolver, inst: Instance, _queryAll: boolean) {
  const inbox = inst.lookup('inbox');
  const status: string | undefined = inst.lookup('status');
  const kind: string | undefined = inst.lookup('kind');
  const from: string | undefined = inst.lookup('from');

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (kind) params.set('kind', kind);
  if (from) params.set('from', from);

  const qs = params.toString();
  const url = `${getAgentManagerUrl()}/api/inboxes/${encodeURIComponent(inbox)}/messages${qs ? '?' + qs : ''}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      logger.error(`Failed to query inbox ${inbox}: HTTP ${response.status} — ${text}`);
      return [];
    }
    return await response.json();
  } catch (err: any) {
    logger.error(`Failed to query inbox ${inbox}: ${err.message}`);
    return [];
  }
}

export default `module ${CoreMessagingModuleName}

record Notification {
    inbox String,
    subject String,
    body String,
    fromKind String @default("employee"),
    fromId String
}

record Action {
    inbox String,
    subject String,
    body String,
    fromKind String @default("employee"),
    fromId String,
    responses String[],
    continuationEvents String[] @optional,
    inputPrompt String @optional
}

record InboxQuery {
    inbox String,
    status String @optional,
    kind String @optional,
    from String @optional
}

@public event SendNotification extends Notification {}
workflow SendNotification {
    {Notification {inbox SendNotification.inbox,
                   subject SendNotification.subject,
                   body SendNotification.body,
                   fromKind SendNotification.fromKind,
                   fromId SendNotification.fromId}}
}

@public event SendAction extends Action {}
workflow SendAction {
    {Action {inbox SendAction.inbox,
             subject SendAction.subject,
             body SendAction.body,
             fromKind SendAction.fromKind,
             fromId SendAction.fromId,
             responses SendAction.responses,
             continuationEvents SendAction.continuationEvents,
             inputPrompt SendAction.inputPrompt}}
}

@public event QueryInbox extends InboxQuery {}
workflow QueryInbox {
    {InboxQuery {inbox? QueryInbox.inbox,
                 status? QueryInbox.status,
                 kind? QueryInbox.kind,
                 from? QueryInbox.from}}
}
`;

export function initMessagingModule() {
  const resolverName = 'agentlang.messaging/messagingResolver';
  const resolver = new GenericResolver(resolverName, {
    create: pushNotification,
    upsert: undefined,
    update: undefined,
    query: queryInbox,
    delete: undefined,
    startTransaction: undefined,
    commitTransaction: undefined,
    rollbackTransaction: undefined,
  });
  registerResolver(resolverName, () => resolver);
  setResolver('agentlang.messaging/Notification', resolverName);

  const actionResolverName = 'agentlang.messaging/actionResolver';
  const actionResolver = new GenericResolver(actionResolverName, {
    create: pushAction,
    upsert: undefined,
    update: undefined,
    query: undefined,
    delete: undefined,
    startTransaction: undefined,
    commitTransaction: undefined,
    rollbackTransaction: undefined,
  });
  registerResolver(actionResolverName, () => actionResolver);
  setResolver('agentlang.messaging/Action', actionResolverName);

  const queryResolverName = 'agentlang.messaging/queryResolver';
  const queryResolver = new GenericResolver(queryResolverName, {
    create: undefined,
    upsert: undefined,
    update: undefined,
    query: queryInbox,
    delete: undefined,
    startTransaction: undefined,
    commitTransaction: undefined,
    rollbackTransaction: undefined,
  });
  registerResolver(queryResolverName, () => queryResolver);
  setResolver('agentlang.messaging/InboxQuery', queryResolverName);
}
