import type { GraphDatabase } from './database.js';
import type { GraphEdge, GraphNode, GraphTraversalResult } from './types.js';
import { logger } from '../logger.js';

// neo4j-driver is dynamically imported to avoid hard dependency
let neo4jDriver: any = null;

async function loadNeo4jDriver() {
  if (!neo4jDriver) {
    try {
      const moduleName = 'neo4j-driver';
      neo4jDriver = await import(moduleName);
    } catch {
      logger.warn('[GRAPH] neo4j-driver not installed. Run: npm install neo4j-driver');
      throw new Error('neo4j-driver not available');
    }
  }
  return neo4jDriver;
}

export class Neo4jDatabase implements GraphDatabase {
  private driver: any = null;
  private connected = false;
  private uri: string;
  private user: string;
  private password: string;

  constructor(
    uri: string = process.env.GRAPH_DB_URI || 'bolt://localhost:7687',
    user: string = process.env.GRAPH_DB_USER || 'neo4j',
    password: string = process.env.GRAPH_DB_PASSWORD || 'password'
  ) {
    this.uri = uri;
    this.user = user;
    this.password = password;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      const neo4j = await loadNeo4jDriver();
      this.driver = neo4j.default.driver(
        this.uri,
        neo4j.default.auth.basic(this.user, this.password)
      );
      await this.driver.verifyConnectivity();
      this.connected = true;
      logger.info(`[GRAPH] Connected to Neo4j at ${this.uri}`);
    } catch (err) {
      logger.error(`[GRAPH] Failed to connect to Neo4j: ${err}`);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.connected = false;
      logger.info('[GRAPH] Disconnected from Neo4j');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async createNode(node: GraphNode): Promise<string> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `CREATE (n:KnowledgeNode {
          id: $id, name: $name, type: $type, description: $description,
          sourceType: $sourceType, sourceId: $sourceId, sourceChunk: $sourceChunk,
          instanceId: $instanceId, instanceType: $instanceType,
          containerTag: $containerTag, userId: $userId, agentId: $agentId,
          confidence: $confidence, isLatest: $isLatest,
          createdAt: datetime(), updatedAt: datetime()
        }) RETURN n.id AS id`,
        {
          id: node.id,
          name: node.name,
          type: node.type,
          description: node.description || null,
          sourceType: node.sourceType,
          sourceId: node.sourceId || null,
          sourceChunk: node.sourceChunk || null,
          instanceId: node.instanceId || null,
          instanceType: node.instanceType || null,
          containerTag: node.containerTag,
          userId: node.userId,
          agentId: node.agentId || null,
          confidence: node.confidence,
          isLatest: node.isLatest,
        }
      );
      return result.records[0].get('id');
    } finally {
      await session.close();
    }
  }

  async upsertNode(node: GraphNode): Promise<string> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MERGE (n:KnowledgeNode {id: $id})
         SET n.name = $name, n.type = $type, n.description = $description,
             n.sourceType = $sourceType, n.sourceId = $sourceId, n.sourceChunk = $sourceChunk,
             n.instanceId = $instanceId, n.instanceType = $instanceType,
             n.containerTag = $containerTag, n.userId = $userId, n.agentId = $agentId,
             n.confidence = $confidence, n.isLatest = $isLatest,
             n.updatedAt = datetime(),
             n.createdAt = coalesce(n.createdAt, datetime())
         RETURN n.id AS id`,
        {
          id: node.id,
          name: node.name,
          type: node.type,
          description: node.description || null,
          sourceType: node.sourceType,
          sourceId: node.sourceId || null,
          sourceChunk: node.sourceChunk || null,
          instanceId: node.instanceId || null,
          instanceType: node.instanceType || null,
          containerTag: node.containerTag,
          userId: node.userId,
          agentId: node.agentId || null,
          confidence: node.confidence,
          isLatest: node.isLatest,
        }
      );
      return result.records[0].get('id');
    } finally {
      await session.close();
    }
  }

  async findNodeById(id: string): Promise<GraphNode | null> {
    const session = this.driver.session();
    try {
      const result = await session.run('MATCH (n:KnowledgeNode {id: $id}) RETURN n', { id });
      if (result.records.length === 0) return null;
      return this.recordToNode(result.records[0].get('n'));
    } finally {
      await session.close();
    }
  }

  async findNodesByContainer(containerTag: string): Promise<GraphNode[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        'MATCH (n:KnowledgeNode {containerTag: $containerTag}) RETURN n',
        { containerTag }
      );
      return result.records.map((r: any) => this.recordToNode(r.get('n')));
    } finally {
      await session.close();
    }
  }

  async updateNode(id: string, updates: Partial<GraphNode>): Promise<void> {
    const session = this.driver.session();
    try {
      const setClause = Object.keys(updates)
        .filter(k => k !== 'id')
        .map(k => `n.${k} = $${k}`)
        .join(', ');
      if (!setClause) return;

      await session.run(
        `MATCH (n:KnowledgeNode {id: $id}) SET ${setClause}, n.updatedAt = datetime()`,
        { id, ...updates }
      );
    } finally {
      await session.close();
    }
  }

  async deleteNode(id: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run('MATCH (n:KnowledgeNode {id: $id}) DETACH DELETE n', { id });
    } finally {
      await session.close();
    }
  }

  async createEdge(edge: GraphEdge): Promise<string> {
    const session = this.driver.session();
    try {
      const edgeId = edge.id || crypto.randomUUID();
      await session.run(
        `MATCH (a:KnowledgeNode {id: $sourceId}), (b:KnowledgeNode {id: $targetId})
         CREATE (a)-[r:${sanitizeCypherLabel(edge.relationship)} {
           id: $edgeId, weight: $weight, sourceType: $sourceType
         }]->(b)
         RETURN r`,
        {
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          edgeId,
          weight: edge.weight,
          sourceType: edge.sourceType || null,
        }
      );
      return edgeId;
    } finally {
      await session.close();
    }
  }

  async upsertEdge(edge: GraphEdge): Promise<string> {
    const session = this.driver.session();
    try {
      const edgeId = edge.id || crypto.randomUUID();
      await session.run(
        `MATCH (a:KnowledgeNode {id: $sourceId}), (b:KnowledgeNode {id: $targetId})
         MERGE (a)-[r:${sanitizeCypherLabel(edge.relationship)}]->(b)
         SET r.id = $edgeId, r.weight = $weight, r.sourceType = $sourceType
         RETURN r`,
        {
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          edgeId,
          weight: edge.weight,
          sourceType: edge.sourceType || null,
        }
      );
      return edgeId;
    } finally {
      await session.close();
    }
  }

  async findOutgoingEdges(nodeId: string): Promise<GraphEdge[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (a:KnowledgeNode {id: $nodeId})-[r]->(b:KnowledgeNode)
         RETURN a.id AS sourceId, b.id AS targetId, type(r) AS relationship,
                r.weight AS weight, r.sourceType AS sourceType, r.id AS id`,
        { nodeId }
      );
      return result.records.map((rec: any) => ({
        id: rec.get('id'),
        sourceId: rec.get('sourceId'),
        targetId: rec.get('targetId'),
        relationship: rec.get('relationship'),
        weight: rec.get('weight') ?? 1.0,
        sourceType: rec.get('sourceType'),
      }));
    } finally {
      await session.close();
    }
  }

  async findIncomingEdges(nodeId: string): Promise<GraphEdge[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (a:KnowledgeNode)-[r]->(b:KnowledgeNode {id: $nodeId})
         RETURN a.id AS sourceId, b.id AS targetId, type(r) AS relationship,
                r.weight AS weight, r.sourceType AS sourceType, r.id AS id`,
        { nodeId }
      );
      return result.records.map((rec: any) => ({
        id: rec.get('id'),
        sourceId: rec.get('sourceId'),
        targetId: rec.get('targetId'),
        relationship: rec.get('relationship'),
        weight: rec.get('weight') ?? 1.0,
        sourceType: rec.get('sourceType'),
      }));
    } finally {
      await session.close();
    }
  }

  async deleteEdgesForNode(nodeId: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run('MATCH (n:KnowledgeNode {id: $nodeId})-[r]-() DELETE r', { nodeId });
    } finally {
      await session.close();
    }
  }

  async expandGraph(
    seedIds: string[],
    maxDepth: number,
    containerTag: string
  ): Promise<GraphTraversalResult> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (seed:KnowledgeNode)
         WHERE seed.id IN $seedIds AND seed.containerTag = $containerTag
         CALL apoc.path.subgraphAll(seed, {maxLevel: $maxDepth, labelFilter: 'KnowledgeNode'})
         YIELD nodes, relationships
         UNWIND nodes AS n
         UNWIND relationships AS r
         RETURN DISTINCT n, startNode(r).id AS srcId, endNode(r).id AS tgtId,
                type(r) AS relType, r.weight AS weight`,
        { seedIds, maxDepth, containerTag }
      );

      const nodeMap = new Map<string, GraphNode>();
      const edges: GraphEdge[] = [];

      for (const record of result.records) {
        const n = record.get('n');
        if (n) {
          const node = this.recordToNode(n);
          nodeMap.set(node.id, node);
        }
        const srcId = record.get('srcId');
        const tgtId = record.get('tgtId');
        if (srcId && tgtId) {
          edges.push({
            sourceId: srcId,
            targetId: tgtId,
            relationship: record.get('relType'),
            weight: record.get('weight') ?? 1.0,
          });
        }
      }

      return { nodes: Array.from(nodeMap.values()), edges };
    } catch {
      // Fallback to manual BFS if APOC is not available
      return await this.expandGraphBFS(seedIds, maxDepth, containerTag, session);
    } finally {
      await session.close();
    }
  }

  private async expandGraphBFS(
    seedIds: string[],
    maxDepth: number,
    containerTag: string,
    session: any
  ): Promise<GraphTraversalResult> {
    const visited = new Set<string>();
    const nodeMap = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    let currentIds = [...seedIds];

    for (let depth = 0; depth <= maxDepth && currentIds.length > 0; depth++) {
      const result = await session.run(
        `MATCH (n:KnowledgeNode)
         WHERE n.id IN $ids AND n.containerTag = $containerTag
         OPTIONAL MATCH (n)-[r]->(m:KnowledgeNode {containerTag: $containerTag})
         RETURN n, m, r, type(r) AS relType, r.weight AS weight`,
        { ids: currentIds, containerTag }
      );

      const nextIds: string[] = [];
      for (const record of result.records) {
        const n = record.get('n');
        if (n) {
          const node = this.recordToNode(n);
          if (!visited.has(node.id)) {
            visited.add(node.id);
            nodeMap.set(node.id, node);
          }
        }
        const m = record.get('m');
        if (m) {
          const targetNode = this.recordToNode(m);
          if (!visited.has(targetNode.id)) {
            nextIds.push(targetNode.id);
          }
          edges.push({
            sourceId: n.properties.id,
            targetId: targetNode.id,
            relationship: record.get('relType'),
            weight: record.get('weight') ?? 1.0,
          });
        }
      }
      currentIds = nextIds;
    }

    return { nodes: Array.from(nodeMap.values()), edges };
  }

  async clearContainer(containerTag: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run('MATCH (n:KnowledgeNode {containerTag: $containerTag}) DETACH DELETE n', {
        containerTag,
      });
    } finally {
      await session.close();
    }
  }

  async getStats(containerTag?: string): Promise<{ nodeCount: number; edgeCount: number }> {
    const session = this.driver.session();
    try {
      const whereClause = containerTag ? 'WHERE n.containerTag = $containerTag' : '';
      const nodeResult = await session.run(
        `MATCH (n:KnowledgeNode) ${whereClause} RETURN count(n) AS cnt`,
        containerTag ? { containerTag } : {}
      );
      const edgeResult = await session.run(
        `MATCH (n:KnowledgeNode)${whereClause ? ' ' + whereClause : ''}-[r]->() RETURN count(r) AS cnt`,
        containerTag ? { containerTag } : {}
      );
      return {
        nodeCount: nodeResult.records[0]?.get('cnt')?.toNumber?.() ?? 0,
        edgeCount: edgeResult.records[0]?.get('cnt')?.toNumber?.() ?? 0,
      };
    } finally {
      await session.close();
    }
  }

  private recordToNode(record: any): GraphNode {
    const props = record.properties;
    return {
      id: props.id,
      name: props.name,
      type: props.type,
      description: props.description,
      sourceType: props.sourceType,
      sourceId: props.sourceId,
      sourceChunk: props.sourceChunk,
      instanceId: props.instanceId,
      instanceType: props.instanceType,
      containerTag: props.containerTag,
      userId: props.userId,
      agentId: props.agentId,
      confidence: props.confidence ?? 1.0,
      createdAt: props.createdAt ? new Date(props.createdAt) : new Date(),
      updatedAt: props.updatedAt ? new Date(props.updatedAt) : new Date(),
      isLatest: props.isLatest ?? true,
    };
  }
}

function sanitizeCypherLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
}
