import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { doPreInit, doInternModule } from '../util.js';
import { CoreModules } from '../../src/runtime/modules/core.js';
import { getKnowledgeService, resetKnowledgeService } from '../../src/runtime/knowledge/service.js';
import {
  ContextBuilder,
  extractEntityCandidates,
} from '../../src/runtime/knowledge/context-builder.js';
import type { GraphNode, GraphEdge } from '../../src/runtime/graph/types.js';
import {
  nameSimilarity,
  normalizeForMatch,
  isTypeCompatible,
  shouldPreferType,
} from '../../src/runtime/knowledge/utils.js';

describe('Knowledge Graph Memory System', () => {
  beforeAll(async () => {
    await doPreInit();
  });

  describe('Core Infrastructure', () => {
    test('Knowledge module should be registered in CoreModules', () => {
      expect(CoreModules.length).toBeGreaterThan(0);
      const hasKnowledgeModule = CoreModules.some(m => m.includes('agentlang.knowledge'));
      expect(hasKnowledgeModule).toBe(true);
    });

    test('Knowledge module should contain expected entities', () => {
      const knowledgeDef = CoreModules.find(m => m.includes('agentlang.knowledge'));
      expect(knowledgeDef).toBeDefined();
      expect(knowledgeDef).toContain('KnowledgeEntity');
      expect(knowledgeDef).toContain('KnowledgeEdge');
      expect(knowledgeDef).toContain('KnowledgeSession');
      expect(knowledgeDef).toContain('SessionMessage');
    });

    test('Knowledge module should include fullTextSearch meta', () => {
      const knowledgeDef = CoreModules.find(m => m.includes('agentlang.knowledge'));
      expect(knowledgeDef).toContain('fullTextSearch');
    });
  });

  describe('Context Building', () => {
    test('formatContext returns empty string for empty input', () => {
      const mockDb = { isConnected: () => false } as any;
      const builder = new ContextBuilder(mockDb);

      const result = builder.formatContext([], [], []);
      expect(result).toBe('');
    });

    test('formatContext formats entities by type', () => {
      const mockDb = { isConnected: () => false } as any;
      const builder = new ContextBuilder(mockDb);

      const nodes: GraphNode[] = [
        {
          id: '1',
          name: 'Alice',
          entityType: 'Person',
          description: 'Main character',
          __tenant__: 'test',
          confidence: 1.0,
          sourceType: 'DOCUMENT',
          isLatest: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          name: 'Wonderland',
          entityType: 'Location',
          description: 'Fantasy world',
          __tenant__: 'test',
          confidence: 1.0,
          sourceType: 'DOCUMENT',
          isLatest: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const result = builder.formatContext(nodes, [], []);
      expect(result).toContain('Knowledge Graph Context');
      expect(result).toContain('Alice');
      expect(result).toContain('Person');
      expect(result).toContain('Wonderland');
      expect(result).toContain('Location');
    });

    test('formatContext formats relationships', () => {
      const mockDb = { isConnected: () => false } as any;
      const builder = new ContextBuilder(mockDb);

      const nodes: GraphNode[] = [
        {
          id: '1',
          name: 'Alice',
          entityType: 'Person',
          __tenant__: 'test',
          confidence: 1.0,
          sourceType: 'DOCUMENT',
          isLatest: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          name: 'White Rabbit',
          entityType: 'Person',
          __tenant__: 'test',
          confidence: 1.0,
          sourceType: 'DOCUMENT',
          isLatest: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const edges: GraphEdge[] = [
        { sourceId: '1', targetId: '2', relationship: 'FOLLOWS', weight: 1.0 },
      ];

      const result = builder.formatContext(nodes, edges, []);
      expect(result).toContain('Relationships');
      expect(result).toContain('Alice FOLLOWS White Rabbit');
    });

    test('formatContext formats instance data', () => {
      const mockDb = { isConnected: () => false } as any;
      const builder = new ContextBuilder(mockDb);

      const nodes: GraphNode[] = [
        {
          id: '1',
          name: 'Order',
          entityType: 'Product',
          instanceId: 'order-123',
          instanceType: 'Shop/Order',
          __tenant__: 'test',
          confidence: 1.0,
          sourceType: 'INSTANCE',
          isLatest: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const instances = [
        {
          instanceId: 'order-123',
          entityType: 'Shop/Order',
          data: { status: 'pending', total: 99.99 },
        },
      ];

      const result = builder.formatContext(nodes, [], instances);
      expect(result).toContain('Instance Data');
      expect(result).toContain('Shop/Order');
      expect(result).toContain('status: pending');
      expect(result).toContain('total: 99.99');
    });
  });

  describe('Utility Functions', () => {
    test('normalizeForMatch lowercases and strips articles', () => {
      expect(normalizeForMatch('The White Rabbit')).toBe('white rabbit');
      expect(normalizeForMatch("Alice's")).toBe('alices');
      expect(normalizeForMatch('A Red Queen')).toBe('red queen');
    });

    test('nameSimilarity returns 1 for exact match', () => {
      expect(nameSimilarity('alice', 'alice')).toBe(1);
    });

    test('nameSimilarity returns 0.95 for substring containment', () => {
      expect(nameSimilarity('bob smith', 'bob smith jr')).toBe(0.95);
    });

    test('nameSimilarity returns 0.9 for token-subset match', () => {
      expect(nameSimilarity('smith bob', 'bob smith jones')).toBe(0.9);
    });

    test('nameSimilarity returns 0 for empty strings', () => {
      expect(nameSimilarity('', 'alice')).toBe(0);
      expect(nameSimilarity('alice', '')).toBe(0);
    });

    test('isTypeCompatible matches same types', () => {
      expect(isTypeCompatible('Person', 'Person')).toBe(true);
      expect(isTypeCompatible('Person', 'Organization')).toBe(false);
    });

    test('isTypeCompatible treats Concept as wildcard', () => {
      expect(isTypeCompatible('Person', 'Concept')).toBe(true);
      expect(isTypeCompatible('Concept', 'Location')).toBe(true);
    });

    test('shouldPreferType prefers higher priority types', () => {
      expect(shouldPreferType('Person', 'Concept')).toBe(true);
      expect(shouldPreferType('Concept', 'Person')).toBe(false);
      expect(shouldPreferType('Organization', 'Event')).toBe(true);
    });
  });

  describe('Knowledge Service', () => {
    beforeEach(() => {
      resetKnowledgeService();
    });

    test('getKnowledgeService returns singleton', () => {
      const service1 = getKnowledgeService();
      const service2 = getKnowledgeService();
      expect(service1).toBe(service2);
    });

    test('resetKnowledgeService creates fresh instance', () => {
      const service1 = getKnowledgeService();
      resetKnowledgeService();
      const service2 = getKnowledgeService();
      expect(service1).not.toBe(service2);
    });

    test('KnowledgeService state reflects API key presence', () => {
      const service = getKnowledgeService();
      const hasKey = process.env.AGENTLANG_OPENAI_KEY || process.env.OPENAI_API_KEY;
      expect(service.isEnabled()).toBe(!!hasKey);
    });
  });

  describe('Entity Extraction', () => {
    test('extractEntityCandidates extracts capitalized words', () => {
      const query = 'How does Dracula travel from Transylvania to England?';
      const candidates = extractEntityCandidates(query);

      expect(candidates).toContain('Dracula');
      expect(candidates).toContain('Transylvania');
      expect(candidates).toContain('England');
      expect(candidates).not.toContain('How');
      expect(candidates).not.toContain('does');
    });

    test('extractEntityCandidates extracts quoted strings', () => {
      const query = 'Tell me about "Count Dracula" and his castle';
      const candidates = extractEntityCandidates(query);

      expect(candidates).toContain('Count Dracula');
    });

    test('extractEntityCandidates extracts multi-word phrases', () => {
      const query = 'Jonathan Harker visits Castle Dracula in Transylvania';
      const candidates = extractEntityCandidates(query);

      expect(candidates).toContain('Jonathan Harker');
      expect(candidates).toContain('Castle Dracula');
    });

    test('extractEntityCandidates deduplicates', () => {
      const query = 'Dracula lives in Transylvania. Dracula is from Transylvania.';
      const candidates = extractEntityCandidates(query);

      expect(candidates.filter((c: string) => c === 'Dracula').length).toBe(1);
      expect(candidates.filter((c: string) => c === 'Transylvania').length).toBe(1);
    });

    test('extractEntityCandidates respects MAX_SEED_NODES limit', () => {
      const query = 'Alice Bob Charlie David Eve Frank Grace Henry Ivy Jack Kelly';
      const candidates = extractEntityCandidates(query);

      expect(candidates.length).toBeLessThanOrEqual(5);
    });
  });

  const hasApiKey = process.env.AGENTLANG_OPENAI_KEY || process.env.OPENAI_API_KEY;
  const e2eDescribe = hasApiKey ? describe : describe.skip;

  e2eDescribe('End-to-End Integration', () => {
    beforeEach(() => {
      resetKnowledgeService();
    });

    test('creates session and retrieves context', async () => {
      await doInternModule(
        'KnowledgeTestApp',
        `entity Customer {
          email Email @id,
          name String,
          preferredContact @enum("email", "phone", "sms") @default("email")
        }

        agent supportAgent {
          instruction "You are a helpful customer support agent."
        }
        `
      );

      const knowledgeService = getKnowledgeService();
      const agentFqName = 'KnowledgeTestApp/supportAgent';

      const session = await knowledgeService.getOrCreateSession(
        'supportAgent',
        'test-user-001',
        agentFqName
      );
      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.userId).toBe('test-user-001');
      expect(session.agentId).toBe('supportAgent');
      expect(session.containerTag).toBe(agentFqName);

      const context = await knowledgeService.buildContext('Hello', session.containerTag);
      expect(context).toBeDefined();
      expect(typeof context.contextString).toBe('string');
    });

    test('shares knowledge container across users (agent-level isolation)', async () => {
      await doInternModule('KGSessionIsolation', `entity Data { id Int @id }`);
      const knowledgeService = getKnowledgeService();
      const agentFqName = 'KGSessionIsolation/testAgent';

      const session1 = await knowledgeService.getOrCreateSession(
        'testAgent',
        'user-alpha',
        agentFqName
      );
      const session2 = await knowledgeService.getOrCreateSession(
        'testAgent',
        'user-beta',
        agentFqName
      );

      // Both users share the same agent-level container
      expect(session1.containerTag).toBe(session2.containerTag);
      expect(session1.containerTag).toBe(agentFqName);
      // Sessions are still per-user
      expect(session1.sessionId).not.toBe(session2.sessionId);
    });

    test('formats containerTag as agentFqName (agent-only)', async () => {
      await doInternModule('KGFormatTest', `entity X { id Int @id }`);
      const knowledgeService = getKnowledgeService();
      const agentFqName = 'KGFormatTest/testAgent';

      const session = await knowledgeService.getOrCreateSession(
        'testAgent',
        'test-user',
        agentFqName
      );

      expect(session.containerTag).toBe('KGFormatTest/testAgent');
    });
  });
});
