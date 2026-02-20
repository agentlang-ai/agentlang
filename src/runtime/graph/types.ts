export type SourceType = 'DOCUMENT' | 'CONVERSATION' | 'INSTANCE' | 'DERIVED';

export interface GraphNode {
  id: string;
  name: string;
  entityType: string;
  description?: string;
  embedding?: number[];
  sourceType: SourceType;
  sourceId?: string;
  sourceChunk?: string;
  instanceId?: string;
  instanceType?: string;
  agentId: string;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  isLatest: boolean;
}

export interface GraphEdge {
  id?: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  sourceType?: SourceType;
  properties?: Record<string, unknown>;
}

export interface GraphTraversalResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphData {
  nodes: GraphNodeViz[];
  links: GraphLinkViz[];
}

export interface GraphNodeViz {
  id: string;
  name: string;
  type: string;
  color: string;
  description?: string;
}

export interface GraphLinkViz {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export interface ExtractionResult {
  /** LLM-classified turn intent: QUERY (no graph mutation), UPDATE (new/changed facts), MIXED */
  turn_type?: 'QUERY' | 'UPDATE' | 'MIXED';
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

export interface ExtractedEntity {
  name: string;
  entityType: string;
  description?: string;
  // 1-5 scale where 5 = most central to the text
  salience?: number;
  mentions?: number;
  /** LLM-assigned: how this entity relates to existing knowledge */
  update_type?: 'new' | 'update' | 'supplement';
}

export interface ExtractedRelationship {
  source: string;
  target: string;
  type: string;
}

export interface ProcessingResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodesCreated: number;
  nodesMerged: number;
  edgesCreated: number;
}

export interface KnowledgeContext {
  entities: GraphNode[];
  relationships: GraphEdge[];
  instanceData: InstanceData[];
  contextString: string;
}

export interface InstanceData {
  instanceId: string;
  entityType: string;
  data: Record<string, unknown>;
}

export interface Document {
  content: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}
