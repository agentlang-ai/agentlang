import { logger } from '../logger.js';
import { EntityExtractor } from './extractor.js';
import { SemanticDeduplicator } from './deduplicator.js';
import { escapeString } from './utils.js';
import { CoreKnowledgeModuleName } from '../modules/knowledge.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import type {
  GraphNode,
  GraphEdge,
  ProcessingResult,
  ExtractedRelationship,
} from '../graph/types.js';
import type { Environment } from '../interpreter.js';

export class ConversationProcessor {
  private extractor: EntityExtractor;
  private deduplicator: SemanticDeduplicator;

  constructor(deduplicator: SemanticDeduplicator) {
    this.extractor = new EntityExtractor();
    this.deduplicator = deduplicator;
  }

  /**
   * Build a lightweight summary of existing nodes for the LLM extraction prompt.
   * Fetches recent nodes and formats as a compact list — no extra LLM call.
   */
  private async buildExistingContext(containerTag: string): Promise<string> {
    try {
      const result: import('../module.js').Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEntity {containerTag? "${escapeString(containerTag)}", isLatest? true}, @limit 20}`,
        undefined
      );

      if (!result || result.length === 0) return '';

      const lines: string[] = [];
      for (const inst of result) {
        const name = inst.lookup('name') as string;
        const entityType = inst.lookup('entityType') as string;
        const desc = inst.lookup('description') as string | undefined;
        lines.push(`- ${name} (${entityType})${desc ? ': ' + desc.substring(0, 100) : ''}`);
      }
      return lines.join('\n');
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Failed to fetch existing context: ${err}`);
      return '';
    }
  }

  async processMessage(
    userMessage: string,
    assistantResponse: string,
    containerTag: string,
    sessionId: string,
    agentId?: string,
    env?: Environment,
    llmName?: string
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    let nodesCreated = 0;
    let nodesMerged = 0;
    let edgesCreated = 0;

    try {
      const existingContext = await this.buildExistingContext(containerTag);
      const extraction = await this.extractor.extractFromConversation(
        userMessage,
        assistantResponse,
        env,
        llmName,
        existingContext
      );

      // Gate: skip graph mutations for pure queries
      if (extraction.turn_type === 'QUERY' || extraction.entities.length === 0) {
        logger.debug(
          `[KNOWLEDGE] Turn classified as ${extraction.turn_type || 'empty'}, skipping graph updates`
        );
        return { nodes: [], edges: [], nodesCreated: 0, nodesMerged: 0, edgesCreated: 0 };
      }

      const nodeMap = new Map<string, GraphNode>();
      for (const entity of extraction.entities) {
        const beforeCount = allNodes.length;
        const node = await this.deduplicator.findOrCreateNode(
          entity,
          containerTag,
          'CONVERSATION',
          sessionId,
          `User: ${userMessage}\nAssistant: ${assistantResponse}`
        );
        const canonicalKey = entity.name.toLowerCase();
        nodeMap.set(canonicalKey, node);

        if (!allNodes.some(n => n.id === node.id)) {
          allNodes.push(node);
          if (allNodes.length > beforeCount) nodesCreated++;
        } else {
          nodesMerged++;
        }
      }

      for (const rel of extraction.relationships) {
        const edge = await this.createEdgeFromRelationship(
          rel,
          nodeMap,
          containerTag,
          sessionId,
          agentId
        );
        if (edge) {
          allEdges.push(edge);
          edgesCreated++;
        }
      }
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Conversation processing failed: ${err}`);
    }

    const elapsed = Date.now() - startTime;
    logger.debug(
      `[KNOWLEDGE] Conversation processed in ${elapsed}ms: ` +
        `${nodesCreated} nodes, ${edgesCreated} edges`
    );

    return { nodes: allNodes, edges: allEdges, nodesCreated, nodesMerged, edgesCreated };
  }

  private async createEdgeFromRelationship(
    rel: ExtractedRelationship,
    nodeMap: Map<string, GraphNode>,
    containerTag: string,
    sessionId: string,
    agentId?: string
  ): Promise<GraphEdge | null> {
    const sourceNode = nodeMap.get(rel.source.toLowerCase());
    const targetNode = nodeMap.get(rel.target.toLowerCase());
    if (!sourceNode || !targetNode) return null;
    if (sourceNode.id === targetNode.id) return null;

    // Check for existing edge and bump weight instead of creating a duplicate
    try {
      const existing: import('../module.js').Instance[] = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEdge {` +
          `sourceId? "${sourceNode.id}", ` +
          `targetId? "${targetNode.id}", ` +
          `relType? "${escapeString(rel.type)}"}, ` +
          `@limit 1}`,
        undefined
      );

      if (existing && existing.length > 0) {
        const inst = existing[0];
        const currentWeight = (inst.lookup('weight') as number) || 1.0;
        const newWeight = Math.min(currentWeight + 1, 10);
        await parseAndEvaluateStatement(
          `{${CoreKnowledgeModuleName}/KnowledgeEdge {` +
            `id "${inst.lookup('id')}", ` +
            `weight ${newWeight}}, @upsert}`,
          undefined
        );
        return {
          id: inst.lookup('id') as string,
          sourceId: sourceNode.id,
          targetId: targetNode.id,
          relationship: rel.type,
          weight: newWeight,
          sourceType: 'CONVERSATION',
        };
      }
    } catch (err) {
      logger.debug(`[KNOWLEDGE] Edge dedup lookup failed, creating new: ${err}`);
    }

    const edge: GraphEdge = {
      sourceId: sourceNode.id,
      targetId: targetNode.id,
      relationship: rel.type,
      weight: 1.0,
      sourceType: 'CONVERSATION',
    };

    try {
      const result = await parseAndEvaluateStatement(
        `{${CoreKnowledgeModuleName}/KnowledgeEdge {` +
          `sourceId "${edge.sourceId}", ` +
          `targetId "${edge.targetId}", ` +
          `relType "${escapeString(edge.relationship)}", ` +
          `weight ${edge.weight}, ` +
          `sourceType "CONVERSATION", ` +
          `agentId "${escapeString(containerTag)}"` +
          (agentId ? `, agentId "${escapeString(agentId)}"` : '') +
          `}}`,
        undefined
      );
      const inst = Array.isArray(result) ? result[0] : result;
      if (inst) {
        edge.id = inst.lookup('id') as string;
      }
    } catch (err) {
      logger.warn(`[KNOWLEDGE] Failed to store conversation edge: ${err}`);
    }

    return edge;
  }
}
