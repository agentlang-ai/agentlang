import { logger } from '../logger.js';

/**
 * In-memory graph node representing a memory and its relationships
 */
export interface MemoryNode {
  id: string;
  content: string;
  type: 'FACT' | 'PREFERENCE' | 'EPISODE' | 'DERIVED';
  category?: string;
  containerTag: string;
  confidence: number;
  isLatest: boolean;
  createdAt: Date;
  updatesId?: string;
  extendsId?: string;
  derivedFromIds?: string[];
  instanceId?: string;
  instanceType?: string;
}

/**
 * Graph edge types
 */
export type EdgeType = 'UPDATES' | 'EXTENDS' | 'DERIVED_FROM' | 'RELATED';

/**
 * Graph edge representing a relationship between memories
 */
export interface MemoryEdge {
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight: number;
}

/**
 * In-memory graph for memory relationships
 * Provides fast traversal without database queries
 */
export class MemoryGraph {
  private nodes: Map<string, MemoryNode> = new Map();
  private edges: Map<string, MemoryEdge[]> = new Map();
  private reverseEdges: Map<string, MemoryEdge[]> = new Map();
  private containerIndex: Map<string, Set<string>> = new Map();

  /**
   * Add a memory node to the graph
   */
  addNode(node: MemoryNode): void {
    this.nodes.set(node.id, node);

    // Index by container tag for fast scoped lookups
    if (!this.containerIndex.has(node.containerTag)) {
      this.containerIndex.set(node.containerTag, new Set());
    }
    this.containerIndex.get(node.containerTag)!.add(node.id);

    // Log memory addition
    this.logNodeAddition(node);

    // Create edges based on relationships
    if (node.updatesId) {
      this.addEdge({
        sourceId: node.id,
        targetId: node.updatesId,
        type: 'UPDATES',
        weight: 1.0,
      });
    }

    if (node.extendsId) {
      this.addEdge({
        sourceId: node.id,
        targetId: node.extendsId,
        type: 'EXTENDS',
        weight: 0.8,
      });
    }

    if (node.derivedFromIds) {
      for (const derivedId of node.derivedFromIds) {
        this.addEdge({
          sourceId: node.id,
          targetId: derivedId,
          type: 'DERIVED_FROM',
          weight: 0.6,
        });
      }
    }
  }

  /**
   * Log node addition with visual formatting
   */
  private logNodeAddition(node: MemoryNode): void {
    const shortId = node.id.substring(0, 8);
    const contentPreview =
      node.content.length > 60 ? node.content.substring(0, 60) + '...' : node.content;

    logger.info(`[MEMORY GRAPH] + Node Added`);
    logger.info(`  ID: ${shortId}... | Type: ${node.type} | Category: ${node.category || 'N/A'}`);
    logger.info(`  Content: "${contentPreview}"`);
    logger.info(`  Container: ${node.containerTag} | Confidence: ${node.confidence}`);

    // Also log to console for immediate visibility
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│ MEMORY ADDED                                                │');
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log(`│ ID:        ${shortId}...`);
    console.log(`│ Type:      ${node.type}`);
    console.log(`│ Category:  ${node.category || 'N/A'}`);
    console.log(`│ Content:   ${contentPreview}`);
    console.log(`│ Container: ${node.containerTag}`);
    console.log(`│ Confidence: ${node.confidence}`);
    if (node.instanceId) {
      console.log(`│ Instance:  ${node.instanceType}/${node.instanceId}`);
    }
    console.log('└─────────────────────────────────────────────────────────────┘\n');
  }

  /**
   * Add an edge to the graph
   */
  addEdge(edge: MemoryEdge): void {
    // Forward edge
    if (!this.edges.has(edge.sourceId)) {
      this.edges.set(edge.sourceId, []);
    }
    this.edges.get(edge.sourceId)!.push(edge);

    // Reverse edge for bidirectional traversal
    if (!this.reverseEdges.has(edge.targetId)) {
      this.reverseEdges.set(edge.targetId, []);
    }
    this.reverseEdges.get(edge.targetId)!.push(edge);

    // Log edge creation
    this.logEdgeAddition(edge);
  }

  /**
   * Log edge addition
   */
  private logEdgeAddition(edge: MemoryEdge): void {
    const sourceShort = edge.sourceId.substring(0, 8);
    const targetShort = edge.targetId.substring(0, 8);
    logger.info(`[MEMORY GRAPH] + Edge: ${sourceShort}... --[${edge.type}]--> ${targetShort}...`);
    console.log(`  └── Edge: ${sourceShort}... ──[${edge.type}]──> ${targetShort}...`);
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): MemoryNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all nodes for a container tag
   */
  getNodesByContainer(containerTag: string): MemoryNode[] {
    const nodeIds = this.containerIndex.get(containerTag);
    if (!nodeIds) return [];
    return Array.from(nodeIds)
      .map(id => this.nodes.get(id))
      .filter((n): n is MemoryNode => n !== undefined);
  }

  /**
   * Get outgoing edges from a node
   */
  getOutgoingEdges(nodeId: string): MemoryEdge[] {
    return this.edges.get(nodeId) || [];
  }

  /**
   * Get incoming edges to a node
   */
  getIncomingEdges(nodeId: string): MemoryEdge[] {
    return this.reverseEdges.get(nodeId) || [];
  }

  /**
   * Expand relationships from a set of seed nodes (BFS up to maxDepth)
   */
  expandRelationships(
    seedIds: string[],
    maxDepth: number = 2,
    containerTag?: string
  ): Map<string, { node: MemoryNode; depth: number; pathWeight: number }> {
    const result = new Map<string, { node: MemoryNode; depth: number; pathWeight: number }>();
    const visited = new Set<string>();
    const queue: { id: string; depth: number; pathWeight: number }[] = [];

    // Initialize with seed nodes
    for (const id of seedIds) {
      const node = this.nodes.get(id);
      if (node && (!containerTag || node.containerTag === containerTag)) {
        queue.push({ id, depth: 0, pathWeight: 1.0 });
        visited.add(id);
      }
    }

    while (queue.length > 0) {
      const { id, depth, pathWeight } = queue.shift()!;
      const node = this.nodes.get(id);

      if (!node) continue;

      // Add to result if latest
      if (node.isLatest) {
        result.set(id, { node, depth, pathWeight });
      }

      // Don't expand beyond max depth
      if (depth >= maxDepth) continue;

      // Expand outgoing edges
      for (const edge of this.getOutgoingEdges(id)) {
        if (!visited.has(edge.targetId)) {
          const targetNode = this.nodes.get(edge.targetId);
          if (targetNode && (!containerTag || targetNode.containerTag === containerTag)) {
            visited.add(edge.targetId);
            queue.push({
              id: edge.targetId,
              depth: depth + 1,
              pathWeight: pathWeight * edge.weight,
            });
          }
        }
      }

      // Expand incoming edges (for reverse relationships)
      for (const edge of this.getIncomingEdges(id)) {
        if (!visited.has(edge.sourceId)) {
          const sourceNode = this.nodes.get(edge.sourceId);
          if (sourceNode && (!containerTag || sourceNode.containerTag === containerTag)) {
            visited.add(edge.sourceId);
            queue.push({
              id: edge.sourceId,
              depth: depth + 1,
              pathWeight: pathWeight * edge.weight * 0.5, // Lower weight for reverse edges
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Mark a memory as outdated (not latest)
   */
  markOutdated(id: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.isLatest = false;
    }
  }

  /**
   * Remove a node and its edges
   */
  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;

    // Remove from container index
    const containerNodes = this.containerIndex.get(node.containerTag);
    if (containerNodes) {
      containerNodes.delete(id);
    }

    // Remove edges
    this.edges.delete(id);
    this.reverseEdges.delete(id);

    // Remove references from other edges
    for (const [sourceId, edges] of this.edges) {
      this.edges.set(
        sourceId,
        edges.filter(e => e.targetId !== id)
      );
    }
    for (const [targetId, edges] of this.reverseEdges) {
      this.reverseEdges.set(
        targetId,
        edges.filter(e => e.sourceId !== id)
      );
    }

    // Remove node
    this.nodes.delete(id);
  }

  /**
   * Get graph statistics
   */
  getStats(): { nodeCount: number; edgeCount: number; containerCount: number } {
    let edgeCount = 0;
    for (const edges of this.edges.values()) {
      edgeCount += edges.length;
    }
    return {
      nodeCount: this.nodes.size,
      edgeCount,
      containerCount: this.containerIndex.size,
    };
  }

  /**
   * Print graph visualization to console
   */
  printGraph(containerTag?: string): void {
    const stats = this.getStats();

    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    MEMORY GRAPH STATUS                        ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log(
      `║ Total Nodes: ${stats.nodeCount.toString().padEnd(10)} Total Edges: ${stats.edgeCount.toString().padEnd(10)} ║`
    );
    console.log(`║ Containers:  ${stats.containerCount.toString().padEnd(48)} ║`);
    console.log('╠═══════════════════════════════════════════════════════════════╣');

    // Get nodes to display
    const nodesToDisplay = containerTag
      ? this.getNodesByContainer(containerTag)
      : Array.from(this.nodes.values());

    if (nodesToDisplay.length === 0) {
      console.log('║ No memories stored yet.                                       ║');
    } else {
      // Group by type
      const byType = new Map<string, MemoryNode[]>();
      for (const node of nodesToDisplay) {
        const type = node.type;
        if (!byType.has(type)) {
          byType.set(type, []);
        }
        byType.get(type)!.push(node);
      }

      for (const [type, nodes] of byType) {
        console.log(`║ ── ${type} (${nodes.length}) ─────────────────────────────────────────────`);
        for (const node of nodes.slice(0, 5)) {
          // Show max 5 per type
          const shortId = node.id.substring(0, 8);
          const content =
            node.content.length > 40
              ? node.content.substring(0, 40) + '...'
              : node.content.padEnd(43);
          console.log(`║   [${shortId}] ${content} ║`);

          // Show edges for this node
          const outEdges = this.getOutgoingEdges(node.id);
          for (const edge of outEdges) {
            const targetShort = edge.targetId.substring(0, 8);
            console.log(`║      └──[${edge.type}]──> ${targetShort}...`);
          }
        }
        if (nodes.length > 5) {
          console.log(`║   ... and ${nodes.length - 5} more ${type} memories`);
        }
      }
    }

    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    // Also log to file
    logger.info(
      `[MEMORY GRAPH STATUS] Nodes: ${stats.nodeCount}, Edges: ${stats.edgeCount}, Containers: ${stats.containerCount}`
    );
  }

  /**
   * Clear all nodes and edges for a container
   */
  clearContainer(containerTag: string): void {
    const nodeIds = this.containerIndex.get(containerTag);
    if (nodeIds) {
      for (const id of nodeIds) {
        this.removeNode(id);
      }
      this.containerIndex.delete(containerTag);
    }
  }

  /**
   * Export graph state for debugging
   */
  toJSON(): object {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()).flat(),
      stats: this.getStats(),
    };
  }
}

// Global in-memory graph instance (per-process)
let globalGraph: MemoryGraph | null = null;

/**
 * Get the global memory graph instance
 */
export function getMemoryGraph(): MemoryGraph {
  if (!globalGraph) {
    globalGraph = new MemoryGraph();
    logger.debug('Initialized in-memory graph');
  }
  return globalGraph;
}

/**
 * Reset the global memory graph (for testing)
 */
export function resetMemoryGraph(): void {
  globalGraph = null;
}
