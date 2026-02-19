import { logger } from '../logger.js';
import type { GraphDatabase } from '../graph/database.js';
import type { GraphNode, GraphEdge, KnowledgeContext, InstanceData } from '../graph/types.js';
import { CoreKnowledgeModuleName } from '../modules/knowledge.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import type { Instance } from '../module.js';
import { escapeString, instanceToGraphNode, normalizeForMatch } from './utils.js';

const MAX_CONTEXT_NODES = parseInt(process.env.KG_CONTEXT_NODE_LIMIT || '10', 10);
const MAX_GRAPH_DEPTH = parseInt(process.env.KG_MAX_GRAPH_DEPTH || '2', 10);
const MAX_SEED_NODES = parseInt(process.env.KG_MAX_SEED_NODES || '5', 10);
const MAX_CONTEXT_SIZE = parseInt(process.env.KG_MAX_CONTEXT_SIZE || '5000', 10);
const MAX_DESCRIPTION_LENGTH = parseInt(process.env.KG_MAX_DESCRIPTION_LENGTH || '200', 10);

export class ContextBuilder {
  private graphDb: GraphDatabase;

  constructor(graphDb: GraphDatabase, _embeddingConfig?: any) {
    this.graphDb = graphDb;
  }

  async buildContext(
    query: string,
    containerTag: string,
    tenantId: string,
    extraContainerTags?: string[]
  ): Promise<KnowledgeContext> {
    const startTime = Date.now();

    try {
      const tagSet = new Set<string>([containerTag]);
      if (extraContainerTags) {
        for (const tag of extraContainerTags) {
          if (tag) tagSet.add(tag);
        }
      }
      const containerTags = Array.from(tagSet);

      // Step 1: Exact entity matches from query (fast, precise)
      let exactMatches: GraphNode[] = [];
      for (const tag of containerTags) {
        if (exactMatches.length >= MAX_SEED_NODES) break;
        const matches = await this.findExactMatches(query, tag, tenantId);
        exactMatches = mergeNodes(exactMatches, matches, MAX_SEED_NODES);
      }

      // Step 2: Vector search for additional seed nodes via Agentlang
      let seedNodes = exactMatches;
      if (seedNodes.length < MAX_SEED_NODES) {
        for (const tag of containerTags) {
          if (seedNodes.length >= MAX_SEED_NODES) break;
          const vectorSeeds = await this.vectorSearchNodes(query, tag, tenantId);
          seedNodes = mergeNodes(seedNodes, vectorSeeds, MAX_SEED_NODES);
        }
      }

      if (seedNodes.length === 0) {
        return this.emptyContext();
      }

      // Step 3: Graph expansion (BFS via Neo4j or edge lookup from Agentlang store)
      let expandedNodes: GraphNode[] = seedNodes;
      let expandedEdges: GraphEdge[] = [];

      if (this.graphDb.isConnected()) {
        try {
          const groupedSeeds = groupNodesByContainer(seedNodes);
          let mergedNodes: GraphNode[] = [];
          let mergedEdges: GraphEdge[] = [];

          for (const [tag, nodes] of groupedSeeds.entries()) {
            const seedIds = nodes.map(n => n.id);
            const expanded = await this.graphDb.expandGraph(seedIds, MAX_GRAPH_DEPTH, tag);
            mergedNodes = mergeNodes(mergedNodes, expanded.nodes, MAX_CONTEXT_NODES);
            mergedEdges = mergeEdges(mergedEdges, expanded.edges, MAX_CONTEXT_NODES * 2);
          }

          expandedNodes = mergedNodes.slice(0, MAX_CONTEXT_NODES);
          expandedEdges = mergedEdges.slice(0, MAX_CONTEXT_NODES * 2);
        } catch (err) {
          logger.debug(`[KNOWLEDGE] Graph expansion failed, using seed nodes only: ${err}`);
        }
      } else {
        // Fallback: fetch edges from Agentlang KnowledgeEdge store
        try {
          const seedIds = seedNodes.map(n => n.id);
          for (const nodeId of seedIds) {
            const edgeResults: Instance[] = await parseAndEvaluateStatement(
              `{${CoreKnowledgeModuleName}/KnowledgeEdge {sourceId? "${nodeId}"}, @limit 20}`,
              undefined
            );
            if (edgeResults) {
              for (const inst of edgeResults) {
                expandedEdges.push({
                  sourceId: inst.lookup('sourceId') as string,
                  targetId: inst.lookup('targetId') as string,
                  relationship: inst.lookup('relType') as string,
                  weight: (inst.lookup('weight') as number) || 1.0,
                });
              }
            }
          }
        } catch (err) {
          logger.debug(`[KNOWLEDGE] Edge fallback lookup failed: ${err}`);
        }
      }
      // Always limit even if graph DB is not connected
      expandedNodes = expandedNodes.slice(0, MAX_CONTEXT_NODES);

      // Step 4: Limit to max context nodes
      const limitedNodes = expandedNodes.slice(0, MAX_CONTEXT_NODES);

      // Step 5: Fetch instance data for linked nodes
      const instanceData = await this.fetchInstanceData(limitedNodes);

      // Step 6: Format structured context
      const contextString = this.formatContext(limitedNodes, expandedEdges, instanceData);

      const elapsed = Date.now() - startTime;
      logger.info(
        `[KNOWLEDGE] Context built in ${elapsed}ms: ${limitedNodes.length} nodes, ${expandedEdges.length} edges`
      );

      return {
        entities: limitedNodes,
        relationships: expandedEdges,
        instanceData,
        contextString,
      };
    } catch (err) {
      logger.error(`[KNOWLEDGE] Context building failed: ${err}`);
      return this.emptyContext();
    }
  }

  private async vectorSearchNodes(
    query: string,
    containerTag: string,
    tenantId: string
  ): Promise<GraphNode[]> {
    try {
      // Use Agentlang's fullTextSearch via content? query
      // Limit to MAX_SEED_NODES to prevent memory issues
      const result: Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {
          agentId? "${escapeString(tenantId)}",
          name? "${escapeString(query)}"},
          @limit ${MAX_SEED_NODES}}`,
        undefined
      );

      if (!result || result.length === 0) return [];

      return result.map(instanceToGraphNode).slice(0, MAX_SEED_NODES);
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Vector search failed: ${err}`);
      return [];
    }
  }

  private async findExactMatches(
    query: string,
    containerTag: string,
    tenantId: string
  ): Promise<GraphNode[]> {
    const candidates = extractEntityCandidates(query);
    if (candidates.length === 0) return [];

    const results: GraphNode[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      if (results.length >= MAX_SEED_NODES) break;
      try {
        const result: Instance[] = await parseAndEvaluateStatement(
          `{${CoreKnowledgeModuleName}/KnowledgeEntity {` +
            `agentId? "${escapeString(tenantId)}", ` +
            `name? "${escapeString(candidate)}"}, ` +
            `@limit ${MAX_SEED_NODES}}`,
          undefined
        );
        if (!result || result.length === 0) continue;

        for (const inst of result) {
          const node = instanceToGraphNode(inst);
          if (seen.has(node.id)) continue;
          if (normalizeForMatch(node.name) === normalizeForMatch(candidate)) {
            results.push(node);
            seen.add(node.id);
            if (results.length >= MAX_SEED_NODES) break;
          }
        }
      } catch (err) {
        logger.debug(`[KNOWLEDGE] Exact match lookup failed: ${err}`);
      }
    }

    return results;
  }

  private async fetchInstanceData(nodes: GraphNode[]): Promise<InstanceData[]> {
    const instances: InstanceData[] = [];
    const seen = new Set<string>();
    const MAX_INSTANCE_DATA = 10; // Limit instance data fetching

    for (const node of nodes) {
      // Limit total instances fetched
      if (instances.length >= MAX_INSTANCE_DATA) {
        break;
      }
      if (node.instanceId && node.instanceType && !seen.has(node.instanceId)) {
        seen.add(node.instanceId);
        try {
          const fqName = node.instanceType;
          const result = await parseAndEvaluateStatement(
            `{${fqName} {id? "${node.instanceId}"}}`,
            undefined
          );
          if (result && (Array.isArray(result) ? result.length > 0 : true)) {
            const inst = Array.isArray(result) ? result[0] : result;
            const data: Record<string, unknown> = {};
            if (inst.attributes && typeof inst.attributes.forEach === 'function') {
              inst.attributes.forEach((value: unknown, key: string) => {
                if (!key.startsWith('__') && key !== 'path') {
                  data[key] = value;
                }
              });
            }
            instances.push({ instanceId: node.instanceId, entityType: node.instanceType, data });
          }
        } catch (err) {
          logger.debug(
            `[KNOWLEDGE] Failed to fetch instance ${node.instanceType}/${node.instanceId}: ${err}`
          );
        }
      }
    }

    return instances;
  }

  formatContext(nodes: GraphNode[], edges: GraphEdge[], instances: InstanceData[]): string {
    if (nodes.length === 0) return '';

    let context = '## Knowledge Graph Context\n\n';

    // Entities by type
    context += '### Relevant Entities\n';
    const byType = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      if (!byType.has(node.entityType)) byType.set(node.entityType, []);
      byType.get(node.entityType)!.push(node);
    }
    for (const [type, entities] of byType) {
      context += `\n**${type}s:**\n`;
      for (const entity of entities) {
        context += `- ${entity.name}`;
        if (entity.description) {
          // Truncate long descriptions
          const desc =
            entity.description.length > MAX_DESCRIPTION_LENGTH
              ? entity.description.substring(0, MAX_DESCRIPTION_LENGTH) + '...'
              : entity.description;
          context += `: ${desc}`;
        }
        if (entity.instanceId) context += ` [linked to ${entity.instanceType}]`;
        context += '\n';

        // Check context size limit
        if (context.length > MAX_CONTEXT_SIZE) {
          context += '\n...(truncated)\n';
          return context;
        }
      }
    }

    // Relationships
    if (edges.length > 0 && context.length < MAX_CONTEXT_SIZE) {
      context += '\n### Relationships\n';
      for (const edge of edges) {
        const source = nodes.find(n => n.id === edge.sourceId);
        const target = nodes.find(n => n.id === edge.targetId);
        if (source && target) {
          context += `- ${source.name} ${edge.relationship} ${target.name}\n`;
          if (context.length > MAX_CONTEXT_SIZE) {
            context += '\n...(truncated)\n';
            return context;
          }
        }
      }
    }

    // Instance data
    if (instances.length > 0 && context.length < MAX_CONTEXT_SIZE) {
      context += '\n### Instance Data\n';
      for (const inst of instances) {
        context += `- ${inst.entityType} (${inst.instanceId}):\n`;
        for (const [key, value] of Object.entries(inst.data)) {
          if (value != null) {
            context += `  - ${key}: ${formatValue(value)}\n`;
            if (context.length > MAX_CONTEXT_SIZE) {
              context += '  ...(truncated)\n';
              return context;
            }
          }
        }
      }
    }

    return context;
  }

  private emptyContext(): KnowledgeContext {
    return {
      entities: [],
      relationships: [],
      instanceData: [],
      contextString: '',
    };
  }
}

const QUERY_STOPWORDS = new Set([
  'who',
  'what',
  'where',
  'when',
  'why',
  'how',
  'the',
  'a',
  'an',
  'tell',
  'about',
  'is',
  'are',
  'does',
  'do',
  'did',
]);

export function extractEntityCandidates(query: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (value: string) => {
    const cleaned = value
      .trim()
      .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')
      .replace(/\s+/g, ' ');
    if (cleaned.length < 2) return;
    if (QUERY_STOPWORDS.has(cleaned.toLowerCase())) return;
    const key = normalizeForMatch(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.push(cleaned);
  };

  const quotedRegex = /"([^"]+)"|'([^']+)'/g;
  let match: RegExpExecArray | null = null;
  while ((match = quotedRegex.exec(query)) !== null) {
    addCandidate(match[1] || match[2] || '');
  }

  const multiWord = /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  const singleWord = /\b[A-Z][a-z]{2,}\b/g;
  const acronyms = /\b[A-Z]{2,}\b/g;

  let m: RegExpExecArray | null = null;
  while ((m = multiWord.exec(query)) !== null) {
    addCandidate(m[0]);
  }
  while ((m = singleWord.exec(query)) !== null) {
    addCandidate(m[0]);
  }
  while ((m = acronyms.exec(query)) !== null) {
    addCandidate(m[0]);
  }

  return results.slice(0, MAX_SEED_NODES);
}

function mergeNodes(existing: GraphNode[], incoming: GraphNode[], limit: number): GraphNode[] {
  const seen = new Set(existing.map(n => n.id));
  const merged = [...existing];
  for (const node of incoming) {
    if (merged.length >= limit) break;
    if (!seen.has(node.id)) {
      merged.push(node);
      seen.add(node.id);
    }
  }
  return merged;
}

function mergeEdges(existing: GraphEdge[], incoming: GraphEdge[], limit: number): GraphEdge[] {
  const seen = new Set(existing.map(e => `${e.sourceId}|${e.relationship}|${e.targetId}`));
  const merged = [...existing];
  for (const edge of incoming) {
    if (merged.length >= limit) break;
    const key = `${edge.sourceId}|${edge.relationship}|${edge.targetId}`;
    if (!seen.has(key)) {
      merged.push(edge);
      seen.add(key);
    }
  }
  return merged;
}

function groupNodesByContainer(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const grouped = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const tag = node.agentId || '';
    if (!grouped.has(tag)) grouped.set(tag, []);
    grouped.get(tag)!.push(node);
  }
  return grouped;
}

function formatValue(value: unknown): string {
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
