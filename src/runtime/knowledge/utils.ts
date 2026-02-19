import type { GraphNode, SourceType } from '../graph/types.js';
import type { Instance } from '../module.js';

export const TYPE_PRIORITY: Record<string, number> = {
  Person: 6,
  Organization: 5,
  Location: 5,
  Event: 4,
  Role: 3,
  Product: 2,
  Concept: 1,
};

export function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export function instanceToGraphNode(inst: Instance): GraphNode {
  return {
    id: inst.lookup('id') as string,
    name: inst.lookup('name') as string,
    entityType: inst.lookup('entityType') as string,
    description: inst.lookup('description') as string | undefined,
    sourceType: (inst.lookup('sourceType') as SourceType) || 'DERIVED',
    sourceId: inst.lookup('sourceId') as string | undefined,
    sourceChunk: inst.lookup('sourceChunk') as string | undefined,
    instanceId: inst.lookup('instanceId') as string | undefined,
    instanceType: inst.lookup('instanceType') as string | undefined,
    __tenant__: inst.lookup('__tenant__') as string,
    agentId: inst.lookup('agentId') as string | undefined,
    confidence: (inst.lookup('confidence') as number) || 1.0,
    createdAt: new Date(),
    updatedAt: new Date(),
    isLatest: inst.lookup('isLatest') !== false,
  };
}

export function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.95;
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  // Token-subset match: if all tokens from the smaller set appear in the larger,
  // treat as a strong match (e.g., "Bob" ⊂ "Bob Smith", "NASA" ⊂ "NASA Headquarters")
  const smaller = Math.min(tokensA.size, tokensB.size);
  if (intersection === smaller && smaller > 0) {
    return 0.9;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isTypeCompatible(typeA: string, typeB: string): boolean {
  if (typeA === typeB) return true;
  if (typeA === 'Concept' || typeB === 'Concept') return true;
  return false;
}

export function shouldPreferType(candidateType: string, existingType: string): boolean {
  const candidateScore = TYPE_PRIORITY[candidateType] || 0;
  const existingScore = TYPE_PRIORITY[existingType] || 0;
  return candidateScore > existingScore;
}
