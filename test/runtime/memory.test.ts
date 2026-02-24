import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { doPreInit } from '../util.js';
import { CoreModules } from '../../src/runtime/modules/core.js';
import { getKnowledgeService, resetKnowledgeService } from '../../src/runtime/knowledge/service.js';

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
});
