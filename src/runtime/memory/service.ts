import { logger } from '../logger.js';
import { CoreMemoryModuleName } from '../modules/memory.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import type { Instance } from '../module.js';
import { getMemoryGraph, type MemoryNode } from './graph.js';

export interface SessionContext {
  sessionId: string;
  userId: string;
  agentId: string;
  containerTag: string;
}

export interface MemoryContext {
  memories: Instance[];
  instances: InstanceReference[];
  userProfile?: string;
  timing?: number;
}

/**
 * Get or create a memory session for an agent-user pair
 */
export async function getOrCreateSession(
  agentId: string,
  userId: string,
  agentFqName: string
): Promise<SessionContext> {
  const containerTag = `${agentFqName}:${userId}`;

  try {
    // Check for the existing active session
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/AgentSession {
        agentId? "${agentId}",
        userId? "${userId}",
        containerTag? "${containerTag}"}}`,
      undefined
    );

    if (result && result.length > 0) {
      // Return an existing session
      const session = result[0];
      return {
        sessionId: session.lookup('id'),
        userId: session.lookup('userId'),
        agentId: session.lookup('agentId'),
        containerTag: session.lookup('containerTag'),
      };
    }

    // Create a new session
    const newSessionResult = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/AgentSession {
        agentId "${agentId}", 
        userId "${userId}", 
        containerTag "${containerTag}", 
        messages "[]", 
        createdAt now(), 
        lastActivity now()}}`,
      undefined
    );

    if (newSessionResult && newSessionResult.length > 0) {
      const session = newSessionResult[0];
      return {
        sessionId: session.lookup('id'),
        userId: session.lookup('userId'),
        agentId: session.lookup('agentId'),
        containerTag: session.lookup('containerTag'),
      };
    }

    throw new Error('Failed to create a memory session');
  } catch (err) {
    logger.error(`Failed to get or create memory session: ${err}`);
    throw err;
  }
}

// Track which containers have been loaded into the graph
const loadedContainers = new Set<string>();

/**
 * Retrieve relevant memories for the current context using vector search + in-memory graph
 *
 * Architecture:
 * 1. Vector Search (pgvector/sqlitevec): Find semantically similar memories
 * 2. In-Memory Graph: Expand relationships from vector search results (2-hop BFS)
 * 3. Merge & Rank: Combine results, prioritizing vector search hits
 *
 * The in-memory graph provides fast relationship traversal without database queries,
 * while the vector store handles semantic similarity. This hybrid approach gives us:
 * - Semantic relevance (from vector search)
 * - Relationship context (from graph expansion)
 * - Fast performance (in-memory graph traversal)
 */
export async function retrieveMemoryContext(
  session: SessionContext,
  message: string
): Promise<MemoryContext> {
  const startTime = Date.now();

  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ MEMORY RETRIEVAL                                            │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log(`│ Container: ${session.containerTag}`);
  console.log(`│ Query: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
  logger.info(`[MEMORY] Retrieving context for: "${message.substring(0, 50)}..."`);

  try {
    // Step 0: Ensure memories for this container are loaded into the graph
    // This handles cold-start: on first access, we load all memories for the container
    await ensureGraphLoaded(session.containerTag);

    // Step 1: Vector search for semantically similar memories
    // This uses pgvector (Postgres) or sqlitevec (SQLite) for similarity search
    const vectorResults = await searchMemoriesByVector(session.containerTag, message);

    console.log(`│ Vector search found: ${vectorResults.length} memories`);
    logger.info(`[MEMORY] Vector search returned ${vectorResults.length} results`);

    if (vectorResults.length === 0) {
      console.log('│ No relevant memories found.');
      console.log('└─────────────────────────────────────────────────────────────┘\n');
      return {
        memories: [],
        instances: [],
        userProfile: undefined,
        timing: Date.now() - startTime,
      };
    }

    // Step 2: Add vector results to graph (in case they weren't already)
    // This ensures newly created memories are available for graph expansion
    for (const mem of vectorResults) {
      const graph = getMemoryGraph();
      if (!graph.getNode(mem.lookup('id') as string)) {
        addMemoryToGraph(mem);
      }
    }

    // Step 3: Get seed IDs from vector results
    const seedIds = vectorResults.map(m => m.lookup('id') as string);

    // Step 4: Expand relationships using in-memory graph (2-hop BFS)
    // This finds related memories: updates, extensions, derived facts
    const graph = getMemoryGraph();
    const expandedMemories = graph.expandRelationships(seedIds, 2, session.containerTag);

    // Step 5: Merge vector results with graph-expanded results
    const memoryMap = new Map<string, { instance: Instance; score: number }>();

    // Add vector results first (they have highest relevance, score = 1.0)
    vectorResults.forEach((mem, index) => {
      const id = mem.lookup('id') as string;
      // Score decreases with rank in vector results
      const score = 1.0 - index * 0.05;
      memoryMap.set(id, { instance: mem, score });
    });

    // Add graph-expanded memories if not already present
    // Their score is based on path weight from BFS
    for (const [id, { node, pathWeight }] of expandedMemories) {
      if (!memoryMap.has(id) && node.isLatest && node.confidence >= 0.6) {
        // Fetch the full instance from database
        const instance = await fetchMemoryById(id);
        if (instance) {
          // Graph expansion score is lower than direct vector hits
          memoryMap.set(id, { instance, score: pathWeight * 0.5 });
        }
      }
    }

    // Step 6: Sort by score and filter
    const memories = Array.from(memoryMap.values())
      .filter(({ instance }) => instance.lookup('isLatest') !== false)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ instance }) => instance);

    // Step 7: Extract instance data from memories
    const instances = await extractInstanceData(memories);

    // Step 8: Build user profile from PREFERENCE memories
    const userProfile = await buildUserProfile(session.containerTag);

    // Log retrieval results
    const timing = Date.now() - startTime;
    console.log(`│ Graph expanded to: ${expandedMemories.size} total memories`);
    console.log(`│ Final context: ${memories.length} memories, ${instances.length} instances`);
    console.log(`│ User profile: ${userProfile ? 'Found' : 'Not found'}`);
    console.log(`│ Timing: ${timing}ms`);
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log('│ Retrieved memories:');
    for (const mem of memories.slice(0, 5)) {
      const type = mem.lookup('type');
      const content = (mem.lookup('content') as string).substring(0, 45);
      console.log(`│   [${type}] ${content}...`);
    }
    if (memories.length > 5) {
      console.log(`│   ... and ${memories.length - 5} more`);
    }
    console.log('└─────────────────────────────────────────────────────────────┘\n');

    logger.info(`[MEMORY] Retrieved ${memories.length} memories in ${timing}ms`);

    return {
      memories,
      instances,
      userProfile,
      timing,
    };
  } catch (err) {
    logger.error(`Failed to retrieve memory context: ${err}`);
    console.log('│ ERROR: Failed to retrieve memory context');
    console.log('└─────────────────────────────────────────────────────────────┘\n');
    return {
      memories: [],
      instances: [],
      timing: Date.now() - startTime,
    };
  }
}

/**
 * Ensure memories for a container are loaded into the in-memory graph.
 * This handles cold-start: on first access after app restart, we load from DB.
 */
async function ensureGraphLoaded(containerTag: string): Promise<void> {
  if (loadedContainers.has(containerTag)) {
    return; // Already loaded
  }

  try {
    await loadMemoriesIntoGraph(containerTag);
    loadedContainers.add(containerTag);
  } catch (err) {
    logger.warn(`Failed to load memories into graph for ${containerTag}: ${err}`);
    // Continue anyway - vector search will still work
  }
}

/**
 * Search memories using vector similarity (via existing vector store)
 *
 * How this works with pgvector/sqlitevec:
 * 1. The Memory entity has @meta {"fullTextSearch": "*"} annotation
 * 2. When we query with `content? "search query"`, the SqlDbResolver:
 *    - Embeds the search query using the configured embedding provider
 *    - Performs vector similarity search against the _vec table
 *    - Returns matching Memory instances ordered by similarity
 * 3. We filter by the content and containerTag
 *
 */
async function searchMemoriesByVector(containerTag: string, query: string): Promise<Instance[]> {
  try {
    // Both containerTag? and content? to query (not update)
    // containerTag? filters by exact match, content? triggers semantic search
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        containerTag? "${containerTag}",
        content? "${escapeString(query)}"}}`,
      undefined
    );

    if (result && result.length > 0) {
      return result;
    }
    return [];
  } catch (err) {
    logger.debug(`Vector search failed, falling back to empty results: ${err}`);
    return [];
  }
}

/**
 * Fetch a single memory by ID
 */
async function fetchMemoryById(id: string): Promise<Instance | null> {
  try {
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {id? "${id}"}}`,
      undefined
    );

    if (result && result.length > 0) {
      return result[0];
    }
    return null;
  } catch (err) {
    logger.debug(`Failed to fetch memory by ID: ${err}`);
    return null;
  }
}

/**
 * Instance reference extracted from memories
 */
export interface InstanceReference {
  instanceId: string;
  entityType: string;
  data?: Record<string, unknown>;
}

/**
 * Extract instance data from memories that reference instances.
 * Attempts to fetch the full instance data from the database.
 */
async function extractInstanceData(memories: Instance[]): Promise<InstanceReference[]> {
  const instances: InstanceReference[] = [];
  const seenInstances = new Set<string>();

  for (const memory of memories) {
    const instanceId = memory.lookup('instanceId') as string | undefined;
    const instanceType = memory.lookup('instanceType') as string | undefined;

    if (instanceId && instanceType && !seenInstances.has(instanceId)) {
      seenInstances.add(instanceId);

      // Try to fetch the actual instance data
      const instanceData = await fetchInstanceData(instanceType, instanceId);

      instances.push({
        instanceId,
        entityType: instanceType,
        data: instanceData,
      });
    }
  }

  return instances;
}

/**
 * Fetch actual instance data from the database
 */
async function fetchInstanceData(
  entityType: string,
  instanceId: string
): Promise<Record<string, unknown> | undefined> {
  try {
    // entityType should be in format "ModuleName/EntityName" or just "EntityName"
    const fqName = entityType.includes('/') ? entityType : entityType;

    const result = await parseAndEvaluateStatement(`{${fqName} {id? "${instanceId}"}}`, undefined);

    if (result && result.length > 0) {
      const inst = result[0];
      // Convert instance attributes to a plain object
      const data: Record<string, unknown> = {};
      if (inst.attributes && typeof inst.attributes.forEach === 'function') {
        inst.attributes.forEach((value: unknown, key: string) => {
          // Skip internal attributes
          if (!key.startsWith('__') && key !== 'path') {
            data[key] = value;
          }
        });
      }
      return data;
    }
    return undefined;
  } catch (err) {
    logger.debug(`Failed to fetch instance data for ${entityType}/${instanceId}: ${err}`);
    return undefined;
  }
}

/**
 * Build user profile from PREFERENCE type memories
 * Uses standard equality queries (no vector search needed here)
 *
 */
async function buildUserProfile(containerTag: string): Promise<string | undefined> {
  try {
    // All attributes with ? suffix for pure query (no updates)
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        containerTag? "${containerTag}",
        type? "PREFERENCE",
        isLatest? true}}`,
      undefined
    );

    if (result && result.length > 0) {
      const preferences = result
        .map((m: Instance) => m.lookup('content'))
        .filter((c: string) => c)
        .slice(0, 5);

      if (preferences.length > 0) {
        return `User preferences: ${preferences.join('; ')}`;
      }
    }
    return undefined;
  } catch (err) {
    logger.debug(`Failed to build user profile: ${err}`);
    return undefined;
  }
}

/**
 * Build a prompt context string from memory
 */
export function buildMemoryContextString(context: MemoryContext): string {
  if (context.memories.length === 0 && context.instances.length === 0 && !context.userProfile) {
    return '';
  }

  let contextStr = '\n\n## Context from Previous Conversations\n\n';

  if (context.userProfile) {
    contextStr += `User Profile: ${context.userProfile}\n\n`;
  }

  if (context.memories.length > 0) {
    contextStr += 'Relevant Information:\n';
    context.memories.forEach((memory: Instance) => {
      const content = memory.lookup('content');
      const type = memory.lookup('type');
      contextStr += `- [${type}] ${content}\n`;
    });
    contextStr += '\n';
  }

  if (context.instances.length > 0) {
    contextStr += 'Relevant Instance Data:\n';
    context.instances.forEach((inst: InstanceReference) => {
      contextStr += `- ${inst.entityType} (${inst.instanceId}):\n`;
      if (inst.data) {
        Object.entries(inst.data).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            contextStr += `    ${key}: ${formatValue(value)}\n`;
          }
        });
      }
    });
    contextStr += '\n';
  }

  return contextStr;
}

/**
 * Format a value for display in context string
 */
function formatValue(value: unknown): string {
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Store a conversation episode
 */
export async function storeEpisode(
  sessionId: string,
  userMessage: string,
  assistantResponse: string,
  containerTag: string,
  userId?: string
): Promise<void> {
  // Extract userId from containerTag if not provided (format: "agent:userId")
  const effectiveUserId = userId || containerTag.split(':')[1] || 'unknown';

  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│ STORING EPISODE                                             │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log(`│ Session: ${sessionId.substring(0, 8)}...`);
  console.log(`│ Container: ${containerTag}`);
  console.log(`│ User: ${effectiveUserId.substring(0, 20)}...`);
  logger.info(`[MEMORY] Storing episode for session ${sessionId.substring(0, 8)}...`);

  try {
    // Create episode memory
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        type "EPISODE", 
        content "User: ${escapeString(userMessage)}\\nAssistant: ${escapeString(assistantResponse)}", 
        sourceType "CONVERSATION", 
        sourceId "${sessionId}", 
        containerTag "${containerTag}", 
        userId "${effectiveUserId}",
        sessionId "${sessionId}", 
        isLatest true}}`,
      undefined
    );

    // Add to in-memory graph for fast retrieval
    // Note: parseAndEvaluateStatement returns a single Instance for creates, not an array
    const memory = Array.isArray(result) ? result[0] : result;
    if (memory && typeof memory.lookup === 'function') {
      const memId = memory.lookup('id');
      const memContent = memory.lookup('content');
      console.log(`│ Memory ID: ${memId?.substring(0, 8)}...`);
      console.log(`│ Content preview: ${(memContent as string)?.substring(0, 40)}...`);
      addMemoryToGraph(memory);
      console.log('│ Episode added to graph');
    } else {
      console.log('│ WARNING: No memory returned from DB insert');
    }

    // Store individual messages as SessionMessage entities
    await storeSessionMessage(sessionId, 'user', userMessage);
    await storeSessionMessage(sessionId, 'assistant', assistantResponse);

    // Update session last activity
    await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/AgentSession {
        id "${sessionId}", 
        lastActivity now()
        }, @upsert}`,
      undefined
    );

    // Print current graph status
    const graph = getMemoryGraph();
    const stats = graph.getStats();
    console.log(`│ Graph now has: ${stats.nodeCount} nodes, ${stats.edgeCount} edges`);
    console.log('└─────────────────────────────────────────────────────────────┘\n');
    logger.info(
      `[MEMORY] Episode stored. Graph: ${stats.nodeCount} nodes, ${stats.edgeCount} edges`
    );
  } catch (err) {
    logger.error(`Failed to store episode: ${err}`);
    console.log('│ ERROR: Failed to store episode');
    console.log('└─────────────────────────────────────────────────────────────┘\n');
    // Don't throw - this is background work
  }
}

/**
 * Store a single session message
 */
async function storeSessionMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<void> {
  try {
    await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/SessionMessage {
        role "${role}", 
        content "${escapeString(content)}"}}`,
      undefined
    );
  } catch (err) {
    logger.error(`Failed to store session message: ${err}`);
    // Don't throw - this is background work
  }
}

/**
 * Extract and store facts from a message
 */
export async function extractAndStoreFacts(
  _session: SessionContext,
  _message: string,
  _response: string
): Promise<void> {
  // Placeholder - will be implemented later
  // This will use LLM to extract facts and store them as Memory entities
}

/**
 * Track an instance interaction and create a memory for it.
 * Call this when an agent reads, creates, or updates an instance.
 */
export async function trackInstanceInteraction(
  session: SessionContext,
  operation: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE',
  entityType: string,
  instanceId: string,
  instanceData?: Record<string, unknown>
): Promise<void> {
  try {
    // Generate a descriptive content for the memory
    const content = generateInstanceMemoryContent(operation, entityType, instanceId, instanceData);

    // Create a FACT memory linked to this instance
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        type "FACT",
        category "instance_interaction",
        content "${escapeString(content)}",
        sourceType "INSTANCE",
        sourceId "${instanceId}",
        containerTag "${session.containerTag}",
        userId "${session.userId}",
        agentId "${session.agentId}",
        sessionId "${session.sessionId}",
        instanceId "${instanceId}",
        instanceType "${entityType}",
        isLatest true,
        confidence 1.0}}`,
      undefined
    );

    // Add to in-memory graph
    if (result && result.length > 0) {
      addMemoryToGraph(result[0]);
    }

    // Track as active instance in session
    await trackActiveInstance(session.sessionId, entityType, instanceId);
  } catch (err) {
    logger.warn(`Failed to track instance interaction: ${err}`);
    // Don't throw - this is supplementary functionality
  }
}

/**
 * Generate descriptive content for an instance memory
 */
function generateInstanceMemoryContent(
  operation: string,
  entityType: string,
  instanceId: string,
  data?: Record<string, unknown>
): string {
  const entityName = entityType.includes('/') ? entityType.split('/').pop() : entityType;

  let content = `${operation} ${entityName} with ID ${instanceId}`;

  if (data && Object.keys(data).length > 0) {
    const attrs = Object.entries(data)
      .filter(([key, val]) => val !== null && val !== undefined && !key.startsWith('__'))
      .slice(0, 5) // Limit to 5 attributes to keep content concise
      .map(([key, val]) => `${key}: ${formatValue(val)}`)
      .join(', ');

    if (attrs) {
      content += ` (${attrs})`;
    }
  }

  return content;
}

/**
 * Track an instance as active in the current session
 */
async function trackActiveInstance(
  sessionId: string,
  entityType: string,
  instanceId: string
): Promise<void> {
  try {
    // Check if this active instance already exists
    const existing = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/ActiveInstance {
        instanceId? "${instanceId}",
        entityType? "${entityType}"}}`,
      undefined
    );

    if (existing && existing.length > 0) {
      // Update lastAccessed
      await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/ActiveInstance {
          instanceId "${instanceId}",
          entityType "${entityType}",
          relevance 1.0,
          lastAccessed now()}, @upsert}`,
        undefined
      );
    } else {
      // Create new active instance tracking
      await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/ActiveInstance {
          instanceId "${instanceId}",
          entityType "${entityType}",
          relevance 1.0,
          lastAccessed now()}}`,
        undefined
      );
    }
  } catch (err) {
    logger.debug(`Failed to track active instance: ${err}`);
  }
}

/**
 * Get memories related to a specific instance
 */
export async function getMemoriesForInstance(
  containerTag: string,
  entityType: string,
  instanceId: string
): Promise<Instance[]> {
  try {
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        containerTag? "${containerTag}",
        instanceId? "${instanceId}",
        instanceType? "${entityType}",
        isLatest? true}}`,
      undefined
    );

    return result || [];
  } catch (err) {
    logger.debug(`Failed to get memories for instance: ${err}`);
    return [];
  }
}

/**
 * Create a memory linked to an instance with custom content
 */
export async function createInstanceMemory(
  session: SessionContext,
  entityType: string,
  instanceId: string,
  content: string,
  category: string = 'instance_data'
): Promise<void> {
  try {
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        type "FACT",
        category "${category}",
        content "${escapeString(content)}",
        sourceType "INSTANCE",
        sourceId "${instanceId}",
        containerTag "${session.containerTag}",
        userId "${session.userId}",
        agentId "${session.agentId}",
        sessionId "${session.sessionId}",
        instanceId "${instanceId}",
        instanceType "${entityType}",
        isLatest true,
        confidence 1.0}}`,
      undefined
    );

    if (result && result.length > 0) {
      addMemoryToGraph(result[0]);
    }
  } catch (err) {
    logger.warn(`Failed to create instance memory: ${err}`);
  }
}

/**
 * Add a memory instance to the in-memory graph
 */
export function addMemoryToGraph(memory: Instance): void {
  const graph = getMemoryGraph();

  const id = memory.lookup('id') as string;
  const content = memory.lookup('content') as string;
  const type = memory.lookup('type') as 'FACT' | 'PREFERENCE' | 'EPISODE' | 'DERIVED';
  const containerTag = memory.lookup('containerTag') as string;
  
  // Debug: check if we have required fields
  if (!id || !content || !containerTag) {
    logger.warn(`[MEMORY] Cannot add to graph - missing fields: id=${!!id}, content=${!!content}, containerTag=${!!containerTag}`);
    console.log(`│ WARNING: Missing required fields for graph node`);
    return;
  }

  const node: MemoryNode = {
    id,
    content,
    type,
    category: memory.lookup('category') as string | undefined,
    containerTag,
    confidence: (memory.lookup('confidence') as number) || 1.0,
    isLatest: memory.lookup('isLatest') !== false,
    createdAt: new Date(),
    updatesId: memory.lookup('updatesId') as string | undefined,
    extendsId: memory.lookup('extendsId') as string | undefined,
    derivedFromIds: parseStringArray(memory.lookup('derivedFromIds')),
    instanceId: memory.lookup('instanceId') as string | undefined,
    instanceType: memory.lookup('instanceType') as string | undefined,
  };

  graph.addNode(node);
  logger.debug(`[MEMORY] Added node to graph: ${id.substring(0, 8)}... (${type})`);
}

/**
 * Mark a memory as outdated in the graph
 */
export function markMemoryOutdated(memoryId: string): void {
  const graph = getMemoryGraph();
  graph.markOutdated(memoryId);
}

/**
 * Load existing memories into the in-memory graph for a container
 */
export async function loadMemoriesIntoGraph(containerTag: string): Promise<void> {
  try {
    // Query with ? suffix for pure query (not update)
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {containerTag? "${containerTag}"}}`,
      undefined
    );

    // Handle both array and single instance results
    const memories = Array.isArray(result) ? result : (result ? [result] : []);
    if (memories.length > 0) {
      for (const memory of memories) {
        if (memory && typeof memory.lookup === 'function') {
          addMemoryToGraph(memory);
        }
      }
      logger.debug(`Loaded ${memories.length} memories into graph for ${containerTag}`);
      console.log(`│ Loaded ${memories.length} existing memories from DB`);
    }
  } catch (err) {
    logger.warn(`Failed to load memories into graph: ${err}`);
  }
}

/**
 * Reset the loaded containers tracking (for testing)
 */
export function resetLoadedContainers(): void {
  loadedContainers.clear();
}

function escapeString(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function parseStringArray(value: any): string[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // If it's a comma-separated string
      return value
        .split(',')
        .map(s => s.trim())
        .filter(s => s);
    }
  }
  return undefined;
}

/**
 * Print the current memory graph status to console
 */
export function printMemoryGraph(containerTag?: string): void {
  const graph = getMemoryGraph();
  graph.printGraph(containerTag);
}

/**
 * Get memory graph statistics
 */
export function getMemoryGraphStats(): {
  nodeCount: number;
  edgeCount: number;
  containerCount: number;
} {
  const graph = getMemoryGraph();
  return graph.getStats();
}
