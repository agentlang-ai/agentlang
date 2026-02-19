import { makeCoreModuleName } from '../util.js';
import { makeEventEvaluator, Environment } from '../interpreter.js';
import { logger } from '../logger.js';
import { ConnectionPolicy, registerConnectionPolicy } from '../resolvers/policy.js';

export const CorePolicyModuleName = makeCoreModuleName('policy');

const evalEvent = makeEventEvaluator(CorePolicyModuleName);

export default `module ${CorePolicyModuleName}

import "./modules/policy.js" @as Policy

entity ConnectionPolicy {
  id String @id,
  resolverName String @unique @indexed,
  policyJson String,
  @meta {"global": true}
}

@public workflow UpsertConnectionPolicy {
  {ConnectionPolicy {id UpsertConnectionPolicy.id,
                     resolverName UpsertConnectionPolicy.resolverName,
                     policyJson UpsertConnectionPolicy.policyJson}, @upsert}
}

@public workflow FindConnectionPolicy {
  {ConnectionPolicy {resolverName? FindConnectionPolicy.resolverName}} @as [p];
  p
}

@public workflow ListConnectionPolicies {
  {ConnectionPolicy? {}}
}
`;

export async function persistConnectionPolicy(
  resolverName: string,
  policy: ConnectionPolicy,
  env?: Environment
): Promise<void> {
  try {
    if (!env) env = new Environment();
    const policyJson = JSON.stringify(policy.toJSON());
    await evalEvent(
      'UpsertConnectionPolicy',
      {
        id: resolverName,
        resolverName: resolverName,
        policyJson: policyJson,
      },
      env
    );
  } catch (reason: any) {
    logger.warn(`Failed to persist connection policy for ${resolverName}: ${reason}`);
  }
}

export async function loadConnectionPolicy(
  resolverName: string,
  env?: Environment
): Promise<ConnectionPolicy | undefined> {
  try {
    if (!env) env = new Environment();
    const result: any = await evalEvent(
      'FindConnectionPolicy',
      { resolverName: resolverName },
      env
    );
    if (result && result.policyJson) {
      const json = JSON.parse(result.policyJson);
      return ConnectionPolicy.fromJSON(resolverName, json);
    }
  } catch (reason: any) {
    logger.warn(`Failed to load connection policy for ${resolverName}: ${reason}`);
  }
  return undefined;
}

let refreshTimer: ReturnType<typeof setInterval> | undefined;

export function startPolicyRefreshTimer(intervalSeconds?: number): void {
  const interval = (intervalSeconds ?? 300) * 1000;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    loadAllConnectionPolicies().catch(err => {
      logger.warn(`Policy refresh failed: ${err}`);
    });
  }, interval);
}

export function stopPolicyRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

export async function loadAllConnectionPolicies(env?: Environment): Promise<void> {
  try {
    if (!env) env = new Environment();
    const results: any = await evalEvent('ListConnectionPolicies', {}, env);
    if (results instanceof Array) {
      results.forEach((inst: any) => {
        const name = inst.resolverName || (inst.lookup && inst.lookup('resolverName'));
        const policyJsonStr = inst.policyJson || (inst.lookup && inst.lookup('policyJson'));
        if (name && policyJsonStr) {
          try {
            const json = JSON.parse(policyJsonStr);
            const policy = ConnectionPolicy.fromJSON(name, json);
            registerConnectionPolicy(name, policy);
          } catch (err: any) {
            logger.warn(`Failed to parse policy for ${name}: ${err}`);
          }
        }
      });
    }
  } catch (reason: any) {
    logger.warn(`Failed to load connection policies: ${reason}`);
  }
}
