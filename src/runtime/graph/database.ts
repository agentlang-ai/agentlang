import type { GraphEdge, GraphNode, GraphTraversalResult } from './types.js';

export interface GraphDatabase {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Node operations (synced from Agentlang KnowledgeEntity)
  createNode(node: GraphNode): Promise<string>;
  upsertNode(node: GraphNode): Promise<string>;
  findNodeById(id: string): Promise<GraphNode | null>;
  findNodesByContainer(__tenant__: string): Promise<GraphNode[]>;
  updateNode(id: string, updates: Partial<GraphNode>): Promise<void>;
  deleteNode(id: string): Promise<void>;

  // Edge operations (stored only in Neo4j)
  createEdge(edge: GraphEdge): Promise<string>;
  upsertEdge(edge: GraphEdge): Promise<string>;
  findOutgoingEdges(nodeId: string): Promise<GraphEdge[]>;
  findIncomingEdges(nodeId: string): Promise<GraphEdge[]>;
  deleteEdgesForNode(nodeId: string): Promise<void>;

  // Traversal
  expandGraph(
    seedIds: string[],
    maxDepth: number,
    __tenant__: string
  ): Promise<GraphTraversalResult>;

  // Bulk operations
  clearAll(): Promise<void>;
  clearContainer(__tenant__: string): Promise<void>;
  getStats(__tenant__?: string): Promise<{ nodeCount: number; edgeCount: number }>;
}
