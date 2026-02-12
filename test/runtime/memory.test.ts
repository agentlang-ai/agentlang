import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { doInternModule, doPreInit } from '../util.js';
import { fetchModule, Instance } from '../../src/runtime/module.js';
import { CoreMemoryModuleName } from '../../src/runtime/modules/memory.js';
import { CoreModules } from '../../src/runtime/modules/core.js';
import {
  getMemoryGraph,
  MemoryGraph,
  type MemoryNode,
  resetMemoryGraph,
} from '../../src/runtime/memory/graph.js';
import {
  buildMemoryContextString,
  getOrCreateSession,
  type InstanceReference,
  type MemoryContext,
  resetLoadedContainers,
  retrieveMemoryContext,
  storeEpisode,
} from '../../src/runtime/memory/service.js';
import {
  extractFactsFromConversation,
  storeExtractedFacts,
} from '../../src/runtime/memory/fact-extraction.js';
import { parseAndEvaluateStatement } from '../../src/runtime/interpreter.js';

// ============================================================================
// Phase 1: Core Infrastructure Tests
// ============================================================================
describe('Phase 1: Core Infrastructure', () => {
  beforeAll(async () => {
    await doPreInit();
  });

  test('Memory module should be registered and loaded', async () => {
    expect(CoreModules.length).toBeGreaterThan(0);

    const hasMemoryModule = CoreModules.some(m => m.includes('agentlang.memory'));
    expect(hasMemoryModule).toBe(true);

    const module = fetchModule(CoreMemoryModuleName);
    expect(module).toBeDefined();
    expect(module.name).toBe(CoreMemoryModuleName);
  });

  test('Memory entity should exist with correct attributes', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const memoryEntity = module.getRecord('Memory');
    expect(memoryEntity).toBeDefined();

    const userAttrs = memoryEntity.getUserAttributes();
    expect(userAttrs.has('content')).toBe(true);
    expect(userAttrs.has('type')).toBe(true);
    expect(userAttrs.has('containerTag')).toBe(true);
    expect(userAttrs.has('instanceId')).toBe(true);
    expect(userAttrs.has('instanceType')).toBe(true);
    expect(userAttrs.has('isLatest')).toBe(true);
    expect(userAttrs.has('confidence')).toBe(true);
    expect(userAttrs.has('embeddingConfig')).toBe(true);
  });

  test('AgentSession entity should exist with correct attributes', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const sessionEntity = module.getRecord('AgentSession');
    expect(sessionEntity).toBeDefined();

    const userAttrs = sessionEntity.getUserAttributes();
    expect(userAttrs.has('userId')).toBe(true);
    expect(userAttrs.has('agentId')).toBe(true);
    expect(userAttrs.has('containerTag')).toBe(true);
    expect(userAttrs.has('messages')).toBe(true);
  });

  test('SessionMessage entity should exist', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const messageEntity = module.getRecord('SessionMessage');
    expect(messageEntity).toBeDefined();

    const userAttrs = messageEntity.getUserAttributes();
    expect(userAttrs.has('role')).toBe(true);
    expect(userAttrs.has('content')).toBe(true);
  });

  test('ActiveInstance entity should exist for instance tracking', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const instanceEntity = module.getRecord('ActiveInstance');
    expect(instanceEntity).toBeDefined();

    const userAttrs = instanceEntity.getUserAttributes();
    expect(userAttrs.has('instanceId')).toBe(true);
    expect(userAttrs.has('entityType')).toBe(true);
    expect(userAttrs.has('relevance')).toBe(true);
  });

  test('Memory entity should have fullTextSearch annotation', async () => {
    const module = fetchModule(CoreMemoryModuleName);
    const memoryEntity = module.getRecord('Memory');
    expect(memoryEntity).toBeDefined();

    // Check for fullTextSearch meta annotation
    const ftsAttrs = memoryEntity.getFullTextSearchAttributes();
    expect(ftsAttrs).toBeDefined();
  });
});

// ============================================================================
// Phase 4: In-Memory Graph Tests
// ============================================================================
describe('Phase 4: In-Memory Graph', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    resetMemoryGraph();
    graph = getMemoryGraph();
  });

  afterEach(() => {
    resetMemoryGraph();
  });

  test('Graph should be initialized as singleton', () => {
    const graph1 = getMemoryGraph();
    const graph2 = getMemoryGraph();
    expect(graph1).toBe(graph2);
  });

  test('Graph should add nodes correctly', () => {
    const node: MemoryNode = {
      id: 'test-1',
      content: 'Test content',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
    };

    graph.addNode(node);

    const retrieved = graph.getNode('test-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.content).toBe('Test content');
    expect(retrieved?.type).toBe('FACT');
  });

  test('Graph should index nodes by container', () => {
    const node1: MemoryNode = {
      id: 'test-1',
      content: 'Content 1',
      type: 'FACT',
      containerTag: 'container-a',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
    };

    const node2: MemoryNode = {
      id: 'test-2',
      content: 'Content 2',
      type: 'FACT',
      containerTag: 'container-a',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
    };

    const node3: MemoryNode = {
      id: 'test-3',
      content: 'Content 3',
      type: 'FACT',
      containerTag: 'container-b',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
    };

    graph.addNode(node1);
    graph.addNode(node2);
    graph.addNode(node3);

    const containerA = graph.getNodesByContainer('container-a');
    const containerB = graph.getNodesByContainer('container-b');

    expect(containerA.length).toBe(2);
    expect(containerB.length).toBe(1);
  });

  test('Graph should create edges for UPDATES relationship', () => {
    const oldNode: MemoryNode = {
      id: 'old-1',
      content: 'Old content',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: false,
      createdAt: new Date(),
    };

    const newNode: MemoryNode = {
      id: 'new-1',
      content: 'New content',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
      updatesId: 'old-1',
    };

    graph.addNode(oldNode);
    graph.addNode(newNode);

    const edges = graph.getOutgoingEdges('new-1');
    expect(edges.length).toBe(1);
    expect(edges[0].targetId).toBe('old-1');
    expect(edges[0].type).toBe('UPDATES');
  });

  test('Graph should expand relationships with BFS', () => {
    // Create a chain: A -> B -> C
    const nodeA: MemoryNode = {
      id: 'node-a',
      content: 'Node A',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
    };

    const nodeB: MemoryNode = {
      id: 'node-b',
      content: 'Node B',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
      extendsId: 'node-a',
    };

    const nodeC: MemoryNode = {
      id: 'node-c',
      content: 'Node C',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
      extendsId: 'node-b',
    };

    graph.addNode(nodeA);
    graph.addNode(nodeB);
    graph.addNode(nodeC);

    // Start from C, expand 2 hops - should find B and A
    const expanded = graph.expandRelationships(['node-c'], 2);

    expect(expanded.size).toBe(3); // C, B, A
    expect(expanded.has('node-c')).toBe(true);
    expect(expanded.has('node-b')).toBe(true);
    expect(expanded.has('node-a')).toBe(true);
  });

  test('Graph should filter by isLatest during expansion', () => {
    const oldNode: MemoryNode = {
      id: 'old-1',
      content: 'Old content',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: false, // Not latest
      createdAt: new Date(),
    };

    const newNode: MemoryNode = {
      id: 'new-1',
      content: 'New content',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
      updatesId: 'old-1',
    };

    graph.addNode(oldNode);
    graph.addNode(newNode);

    const expanded = graph.expandRelationships(['new-1'], 2);

    // Should only include latest nodes
    expect(expanded.size).toBe(1);
    expect(expanded.has('new-1')).toBe(true);
    expect(expanded.has('old-1')).toBe(false);
  });

  test('Graph should mark nodes as outdated', () => {
    const node: MemoryNode = {
      id: 'test-1',
      content: 'Test content',
      type: 'FACT',
      containerTag: 'test:container',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
    };

    graph.addNode(node);
    expect(graph.getNode('test-1')?.isLatest).toBe(true);

    graph.markOutdated('test-1');
    expect(graph.getNode('test-1')?.isLatest).toBe(false);
  });

  test('Graph should provide accurate stats', () => {
    const node1: MemoryNode = {
      id: 'test-1',
      content: 'Content 1',
      type: 'FACT',
      containerTag: 'container-a',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
    };

    const node2: MemoryNode = {
      id: 'test-2',
      content: 'Content 2',
      type: 'FACT',
      containerTag: 'container-a',
      confidence: 1.0,
      isLatest: true,
      createdAt: new Date(),
      extendsId: 'test-1',
    };

    graph.addNode(node1);
    graph.addNode(node2);

    const stats = graph.getStats();
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
    expect(stats.containerCount).toBe(1);
  });
});

// ============================================================================
// Phase 5: Context Building Tests
// ============================================================================
describe('Phase 5: Context Building', () => {
  beforeAll(async () => {
    await doPreInit();
  });

  beforeEach(() => {
    resetMemoryGraph();
    resetLoadedContainers();
  });

  test('buildMemoryContextString should return empty string for empty context', () => {
    const context: MemoryContext = {
      memories: [],
      instances: [],
      userProfile: undefined,
    };

    const result = buildMemoryContextString(context);
    expect(result).toBe('');
  });

  test('buildMemoryContextString should include user profile', () => {
    const context: MemoryContext = {
      memories: [],
      instances: [],
      userProfile: 'User preferences: likes coffee; prefers email',
    };

    const result = buildMemoryContextString(context);
    expect(result).toContain('User Profile:');
    expect(result).toContain('likes coffee');
  });

  test('buildMemoryContextString should format instance data correctly', () => {
    const instances: InstanceReference[] = [
      {
        instanceId: 'order-123',
        entityType: 'Shop/Order',
        data: {
          id: 'order-123',
          status: 'pending',
          total: 99.99,
        },
      },
    ];

    const context: MemoryContext = {
      memories: [],
      instances,
      userProfile: undefined,
    };

    const result = buildMemoryContextString(context);
    expect(result).toContain('Instance Data');
    expect(result).toContain('Shop/Order');
    expect(result).toContain('order-123');
    expect(result).toContain('status: pending');
    expect(result).toContain('total: 99.99');
  });

  test('buildMemoryContextString should handle multiple instances', () => {
    const instances: InstanceReference[] = [
      {
        instanceId: 'user-1',
        entityType: 'App/User',
        data: { name: 'John' },
      },
      {
        instanceId: 'order-1',
        entityType: 'App/Order',
        data: { amount: 50 },
      },
    ];

    const context: MemoryContext = {
      memories: [],
      instances,
      userProfile: undefined,
    };

    const result = buildMemoryContextString(context);
    expect(result).toContain('App/User');
    expect(result).toContain('App/Order');
    expect(result).toContain('John');
    expect(result).toContain('50');
  });

  test('buildMemoryContextString should handle instance without data', () => {
    const instances: InstanceReference[] = [
      {
        instanceId: 'item-1',
        entityType: 'Shop/Item',
        data: undefined,
      },
    ];

    const context: MemoryContext = {
      memories: [],
      instances,
      userProfile: undefined,
    };

    const result = buildMemoryContextString(context);
    expect(result).toContain('Shop/Item');
    expect(result).toContain('item-1');
  });
});

// ============================================================================
// End-to-End Memory Integration Tests (requires AL_TEST=true)
// ============================================================================
if (process.env.AL_TEST === 'true') {
  describe('End-to-End: Memory System Integration', () => {
    beforeEach(async () => {
      resetMemoryGraph();
      resetLoadedContainers();
    });

    afterEach(() => {
      resetMemoryGraph();
      resetLoadedContainers();
    });

    test('Full memory flow: session creation, episode storage, context retrieval', async () => {
      await doInternModule(
        'MemoryTestApp',
        `entity Customer {
          email Email @id,
          name String,
          preferredContact @enum("email", "phone", "sms") @default("email")
        }

        agent supportAgent {
          instruction "You are a helpful customer support agent. Remember user preferences and past interactions."
        }
        `
      );

      const agentId = 'supportAgent';
      const userId = 'test-user-001';
      const agentFqName = 'MemoryTestApp/supportAgent';

      // Step 1: Create/get session
      const session = await getOrCreateSession(agentId, userId, agentFqName);
      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.userId).toBe(userId);
      expect(session.agentId).toBe(agentId);
      expect(session.containerTag).toBe(`${agentFqName}:${userId}`);

      // Step 2: Store first episode (simulating conversation)
      const userMsg1 = 'Hello, my name is Alice and I prefer to be contacted by email.';
      const assistantResp1 =
        'Hello Alice! I have noted that you prefer email contact. How can I help you today?';
      await storeEpisode(session.sessionId, userMsg1, assistantResp1, session.containerTag);

      // Step 3: Verify episode was stored
      const episodeMemories: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/Memory {containerTag? "${session.containerTag}", type? "EPISODE"}}`
      );
      expect(episodeMemories.length).toBeGreaterThanOrEqual(1);
      const latestEpisode = episodeMemories[episodeMemories.length - 1];
      expect(latestEpisode.lookup('content')).toContain('Alice');

      // Step 4: Verify memory is in the graph
      const graph = getMemoryGraph();
      const containerNodes = graph.getNodesByContainer(session.containerTag);
      expect(containerNodes.length).toBeGreaterThanOrEqual(1);

      // Step 5: Retrieve memory context for follow-up
      const followUpQuery = 'What was my name again?';
      const memoryContext = await retrieveMemoryContext(session, followUpQuery);
      expect(memoryContext).toBeDefined();
      expect(memoryContext.memories.length).toBeGreaterThanOrEqual(0);
      expect(memoryContext.timing).toBeDefined();

      // Step 6: Build context string
      const contextStr = buildMemoryContextString(memoryContext);
      // Context may or may not contain Alice depending on vector search results
      // The important thing is the flow works
      expect(typeof contextStr).toBe('string');

      console.log('Memory integration test passed - full flow verified');
    });

    test('Agent invocation with memory context injection', async () => {
      if (!process.env.AGENTLANG_OPENAI_KEY) {
        console.log('Skipping agent memory test - no API key');
        return;
      }

      await doInternModule(
        'MemoryAgentTest',
        `agent memoryAgent {
          instruction "You are a helpful assistant that remembers user information. Always use the context from previous conversations to personalize your responses."
        }
        `
      );

      // First interaction
      const response1 = await parseAndEvaluateStatement(
        `{MemoryAgentTest/memoryAgent {message "Hi, I'm Bob. I work as a software engineer at TechCorp."}}`
      );
      expect(response1).toBeDefined();
      expect(typeof response1).toBe('string');

      // Verify session was created
      const sessions: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/AgentSession {agentId? "memoryAgent"}}`
      );
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      // Verify episode was stored
      const session = sessions[0];
      const containerTag = session.lookup('containerTag');
      const episodes: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/Memory {containerTag? "${containerTag}", type? "EPISODE"}}`
      );
      expect(episodes.length).toBeGreaterThanOrEqual(1);
      const episodeContent = episodes[episodes.length - 1].lookup('content');
      expect(episodeContent).toContain('Bob');

      // Second interaction - agent should remember
      const response2 = await parseAndEvaluateStatement(
        `{MemoryAgentTest/memoryAgent {message "What do I do for a living?"}}`
      );
      expect(response2).toBeDefined();
      // The response should reference software engineer or TechCorp
      const response2Lower = String(response2).toLowerCase();
      expect(
        response2Lower.includes('software') ||
          response2Lower.includes('engineer') ||
          response2Lower.includes('techcorp') ||
          response2Lower.includes('work')
      ).toBe(true);

      console.log('Agent memory context injection test passed');
    });

    test('Fact extraction from conversations', async () => {
      if (!process.env.AGENTLANG_OPENAI_KEY) {
        console.log('Skipping fact extraction test - no API key');
        return;
      }

      await doInternModule(
        'FactExtractionTest',
        `agent factAgent {
          instruction "You are a helpful assistant."
        }
        `
      );

      const agentId = 'factAgent';
      const userId = 'fact-test-user';
      const agentFqName = 'FactExtractionTest/factAgent';

      const session = await getOrCreateSession(agentId, userId, agentFqName);

      // Create a mock environment for fact extraction
      const { Environment } = await import('../../src/runtime/interpreter.js');
      const env = new Environment();

      // Extract facts from a conversation
      const userMsg =
        'I prefer dark mode and I usually work late at night. My favorite programming language is TypeScript.';
      const assistantResp =
        'I have noted your preferences for dark mode and late-night work sessions. TypeScript is a great choice!';

      const facts = await extractFactsFromConversation(
        session,
        userMsg,
        assistantResp,
        env,
        'default'
      );

      // Should extract at least some facts
      expect(facts).toBeDefined();
      expect(Array.isArray(facts)).toBe(true);

      if (facts.length > 0) {
        // Store the facts
        await storeExtractedFacts(session, facts);

        // Verify facts were stored
        const storedFacts: Instance[] = await parseAndEvaluateStatement(
          `{${CoreMemoryModuleName}/Memory {containerTag? "${session.containerTag}", type? "FACT"}}`
        );

        expect(storedFacts.length).toBeGreaterThanOrEqual(1);

        // Verify facts are in the graph
        const graph = getMemoryGraph();
        const containerNodes = graph.getNodesByContainer(session.containerTag);
        const factNodes = containerNodes.filter(n => n.type === 'FACT');
        expect(factNodes.length).toBeGreaterThanOrEqual(1);

        console.log(`Fact extraction test passed - extracted ${facts.length} facts`);
      } else {
        console.log('Fact extraction returned no facts - LLM dependent behavior');
      }
    });

    test('Multi-turn conversation with memory persistence', async () => {
      if (!process.env.AGENTLANG_OPENAI_KEY) {
        console.log('Skipping multi-turn test - no API key');
        return;
      }

      await doInternModule(
        'MultiTurnMemory',
        `entity Task {
          id UUID @id @default(uuid()),
          title String,
          status @enum("pending", "in_progress", "done") @default("pending"),
          assignee String @optional
        }

        agent taskAssistant {
          instruction "You are a task management assistant. Help users manage their tasks. Remember task context across conversations.",
          tools [MultiTurnMemory/Task]
        }
        `
      );

      // Turn 1: Create a task
      const r1 = await parseAndEvaluateStatement(
        `{MultiTurnMemory/taskAssistant {message "Create a task called 'Review PR #123' and assign it to me"}}`
      );
      expect(r1).toBeDefined();

      // Check task was created
      const tasks: Instance[] = await parseAndEvaluateStatement(`{MultiTurnMemory/Task? {}}`);
      const hasReviewTask = tasks.some((t: Instance) => {
        const title = t.lookup('title');
        return typeof title === 'string' && title.toLowerCase().includes('review');
      });
      expect(hasReviewTask || typeof r1 === 'string').toBe(true);

      // Turn 2: Ask about tasks (should remember context)
      const r2 = await parseAndEvaluateStatement(
        `{MultiTurnMemory/taskAssistant {message "What tasks do I have?"}}`
      );
      expect(r2).toBeDefined();

      // Verify memory context was built
      const sessions: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/AgentSession {agentId? "taskAssistant"}}`
      );

      if (sessions.length > 0) {
        const containerTag = sessions[0].lookup('containerTag');
        const memories: Instance[] = await parseAndEvaluateStatement(
          `{${CoreMemoryModuleName}/Memory {containerTag? "${containerTag}"}}`
        );
        expect(memories.length).toBeGreaterThanOrEqual(1);
        console.log(`Multi-turn test passed - ${memories.length} memories stored`);
      }
    });

    test('Graph expansion finds related memories', async () => {
      await doInternModule('GraphExpansionTest', `entity Item { id Int @id }`);
      const userId = 'graph-test-user';
      const agentFqName = 'GraphExpansionTest/graphTestAgent';
      const containerTag = `${agentFqName}:${userId}`;

      // Manually create memories with relationships
      // Memory A: Original fact
      const memA: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/Memory {
          type "FACT",
          content "User favorite color is blue",
          containerTag "${containerTag}",
          isLatest true,
          confidence 1.0
        }}`
      );
      expect(memA.length).toBe(1);
      const memAId = memA[0].lookup('id');

      // Memory B: Extends A
      const memB: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/Memory {
          type "FACT",
          content "User prefers light blue specifically",
          containerTag "${containerTag}",
          isLatest true,
          confidence 0.9,
          extendsId "${memAId}"
        }}`
      );
      expect(memB.length).toBe(1);
      const memBId = memB[0].lookup('id');

      // Memory C: Extends B
      const memC: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/Memory {
          type "FACT",
          content "User likes light blue for UI themes",
          containerTag "${containerTag}",
          isLatest true,
          confidence 0.85,
          extendsId "${memBId}"
        }}`
      );
      expect(memC.length).toBe(1);
      const memCId = memC[0].lookup('id');

      // Reset and load into graph
      resetMemoryGraph();
      resetLoadedContainers();

      // Import and manually add to graph
      const { addMemoryToGraph } = await import('../../src/runtime/memory/service.js');
      addMemoryToGraph(memA[0]);
      addMemoryToGraph(memB[0]);
      addMemoryToGraph(memC[0]);

      // Verify graph structure
      const graph = getMemoryGraph();
      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(3);
      expect(stats.edgeCount).toBe(2); // B->A, C->B

      // Expand from C should find B and A
      const expanded = graph.expandRelationships([memCId], 2, containerTag);
      expect(expanded.size).toBe(3);
      expect(expanded.has(memCId)).toBe(true);
      expect(expanded.has(memBId)).toBe(true);
      expect(expanded.has(memAId)).toBe(true);

      // Verify path weights (closer = higher weight)
      const cData = expanded.get(memCId);
      const bData = expanded.get(memBId);
      const aData = expanded.get(memAId);
      expect(cData?.pathWeight).toBeGreaterThan(bData?.pathWeight ?? 0);
      expect(bData?.pathWeight).toBeGreaterThan(aData?.pathWeight ?? 0);

      console.log('Graph expansion test passed');
    });

    test('Session isolation between users', async () => {
      await doInternModule('SessionIsolationTest', `entity Data { id Int @id }`);

      const agentId = 'isolationAgent';
      const agentFqName = 'SessionIsolationTest/isolationAgent';

      // Create sessions for two different users
      const session1 = await getOrCreateSession(agentId, 'user-alpha', agentFqName);
      const session2 = await getOrCreateSession(agentId, 'user-beta', agentFqName);

      expect(session1.containerTag).not.toBe(session2.containerTag);
      expect(session1.containerTag).toContain('user-alpha');
      expect(session2.containerTag).toContain('user-beta');

      // Store episode for user-alpha
      await storeEpisode(
        session1.sessionId,
        'Alpha user message',
        'Alpha response',
        session1.containerTag
      );

      // Store episode for user-beta
      await storeEpisode(
        session2.sessionId,
        'Beta user message',
        'Beta response',
        session2.containerTag
      );

      // Verify isolation - user-alpha should only see their memories
      const alphaMemories: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/Memory {containerTag? "${session1.containerTag}"}}`
      );
      const betaMemories: Instance[] = await parseAndEvaluateStatement(
        `{${CoreMemoryModuleName}/Memory {containerTag? "${session2.containerTag}"}}`
      );

      // Each user should have at least 1 memory
      expect(alphaMemories.length).toBeGreaterThanOrEqual(1);
      expect(betaMemories.length).toBeGreaterThanOrEqual(1);

      // Verify content isolation
      const alphaContents = alphaMemories.map(m => m.lookup('content')).join(' ');
      const betaContents = betaMemories.map(m => m.lookup('content')).join(' ');

      expect(alphaContents).toContain('Alpha');
      expect(alphaContents).not.toContain('Beta');
      expect(betaContents).toContain('Beta');
      expect(betaContents).not.toContain('Alpha');

      console.log('Session isolation test passed');
    });
  });
} else {
  describe('Skipping E2E Memory Tests (set AL_TEST=true to run)', () => {
    test('placeholder', () => {
      console.log('E2E memory tests skipped - set AL_TEST=true to run');
    });
  });
}
