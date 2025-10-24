import { setSubscriptionFn } from '../defs.js';
import { Resolver, setSubscriptionEvent } from './interface.js';

type MakeResolver = () => Resolver;
const resolverDb: Map<string, MakeResolver> = new Map<string, MakeResolver>();
const resolverPathMappings: Map<string, string> = new Map<string, string>();

export function registerResolver(name: string, r: MakeResolver): string {
  resolverDb.set(name, r);
  return name;
}

export function setResolver(fqEntryName: string, resolverName: string) {
  if (resolverDb.has(resolverName)) {
    resolverPathMappings.set(fqEntryName, resolverName);
  } else {
    throw new Error(`Resolver not found - ${resolverName}`);
  }
}

export function getResolverNameForPath(fqEntryName: string): string | undefined {
  return resolverPathMappings.get(fqEntryName);
}

export function getResolver(fqEntryName: string): Resolver {
  const resName: string | undefined = resolverPathMappings.get(fqEntryName);
  if (resName !== undefined) {
    const f: MakeResolver | undefined = resolverDb.get(resName);
    if (f) return f();
  }
  throw new Error(`No resolver registered for ${fqEntryName}`);
}

setSubscriptionFn(setSubscriptionEvent);
