import { Resolver } from './interface.js';

const resolverDb: Map<string, Resolver> = new Map<string, Resolver>();
const resolverPathMappings: Map<string, string> = new Map<string, string>();

export function registerResolver(name: string, r: Resolver) {
  resolverDb.set(name, r);
}

export function setResolver(fqEntryName: string, resolverName: string) {
  if (resolverDb.has(resolverName)) {
    resolverPathMappings.set(fqEntryName, resolverName);
  } else {
    throw new Error(`Resolver not found - ${resolverName}`);
  }
}

export function getResolver(fqEntryName: string): Resolver | undefined {
  const resName: string | undefined = resolverPathMappings.get(fqEntryName);
  if (resName != undefined) {
    return resolverDb.get(resName);
  }
  return undefined;
}
