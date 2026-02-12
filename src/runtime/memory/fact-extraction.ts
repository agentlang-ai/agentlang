import { logger } from '../logger.js';
import { CoreMemoryModuleName } from '../modules/memory.js';
import { Environment, parseAndEvaluateStatement } from '../interpreter.js';
import { findProviderForLLM } from '../modules/ai.js';
import { humanMessage, systemMessage } from '../agents/provider.js';
import type { SessionContext } from './service.js';
import type { Instance } from '../module.js';

export interface ExtractedFact {
  content: string;
  type: 'FACT' | 'PREFERENCE' | 'DERIVED';
  category: string;
  confidence: number;
  instanceId?: string;
  instanceType?: string;
}

const FACT_EXTRACTION_PROMPT = `You are a fact extraction system. Analyze the conversation and extract important facts about the user.

Extract facts in these categories:
- user_preference: User preferences, likes, dislikes
- user_fact: Facts about the user (name, role, company, etc.)
- instance_reference: References to specific instances/entities mentioned
- inferred: Derived insights from the conversation

Rules:
1. Only extract explicit or strongly implied facts
2. Use clear, concise statements
3. Assign confidence scores (0.0-1.0)
4. Link to instance IDs if mentioned

Respond in this JSON format:
{
  "facts": [
    {
      "content": "User works at Acme Corp",
      "type": "FACT",
      "category": "user_fact",
      "confidence": 0.9,
      "instanceId": null,
      "instanceType": null
    }
  ]
}

If no facts can be extracted, return: {"facts": []}`;

/**
 * Extract facts from a conversation using LLM
 */
export async function extractFactsFromConversation(
  session: SessionContext,
  userMessage: string,
  assistantResponse: string,
  env: Environment,
  llmName: string = 'default'
): Promise<ExtractedFact[]> {
  try {
    const provider = await findProviderForLLM(llmName, env);

    const conversation = `User: ${userMessage}\nAssistant: ${assistantResponse}`;

    const messages = [
      systemMessage(FACT_EXTRACTION_PROMPT),
      humanMessage(`Extract facts from this conversation:\n\n${conversation}`),
    ];

    const response = await provider.invoke(messages, undefined);

    // Parse the JSON response
    const parsed = parseFactExtractionResponse(response.content);
    return parsed.facts || [];
  } catch (err) {
    logger.error(`Failed to extract facts: ${err}`);
    return [];
  }
}

/**
 * Store extracted facts as Memory entities
 */
export async function storeExtractedFacts(
  session: SessionContext,
  facts: ExtractedFact[]
): Promise<void> {
  for (const fact of facts) {
    try {
      // Check if a similar fact already exists
      const existingMemory = await findSimilarMemory(session, fact.content);

      if (existingMemory) {
        // Update existing memory if confidence is higher
        const existingConfidence = existingMemory.lookup('confidence') || 0;
        if (fact.confidence > existingConfidence) {
          await updateMemory(existingMemory.lookup('id'), fact);
        }
      } else {
        // Create new memory
        await createMemoryFromFact(session, fact);
      }
    } catch (err) {
      logger.error(`Failed to store fact: ${err}`);
      // Continue with other facts
    }
  }
}

/**
 * Parse the LLM response for fact extraction
 */
function parseFactExtractionResponse(content: string): { facts: ExtractedFact[] } {
  try {
    // Try to find JSON in the response (it might be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { facts: parsed.facts || [] };
    }
    return { facts: [] };
  } catch (err) {
    logger.warn(`Failed to parse fact extraction response: ${err}`);
    return { facts: [] };
  }
}

/**
 * Find a similar existing memory
 */
async function findSimilarMemory(
  session: SessionContext,
  content: string
): Promise<Instance | null> {
  try {
    // Simple text-based similarity check for now
    // later we will use vector similarity search
    const result = await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        containerTag? "${session.containerTag}", 
        content? "${content.substring(0, 50)}*"}}`,
      undefined
    );

    if (result && result.length > 0) {
      return result[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Update an existing memory
 */
async function updateMemory(memoryId: string, fact: ExtractedFact): Promise<void> {
  try {
    await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        id "${memoryId}", 
        content "${escapeString(fact.content)}", 
        confidence ${fact.confidence}, 
        isLatest true
        }, @upsert}`,
      undefined
    );
  } catch (err) {
    logger.error(`Failed to update memory: ${err}`);
    throw err;
  }
}

/**
 * Create a new memory from a fact
 */
async function createMemoryFromFact(session: SessionContext, fact: ExtractedFact): Promise<void> {
  try {
    let query =
      `{${CoreMemoryModuleName}/Memory {` +
      `type "${fact.type}", ` +
      `content "${escapeString(fact.content)}", ` +
      `category "${fact.category}", ` +
      `sourceType "CONVERSATION", ` +
      `sourceId "${session.sessionId}", ` +
      `containerTag "${session.containerTag}", ` +
      `userId "${session.userId}", ` +
      `agentId "${session.agentId}", ` +
      `sessionId "${session.sessionId}", ` +
      `confidence ${fact.confidence}, ` +
      `isLatest true`;

    if (fact.instanceId) {
      query += `, instanceId "${fact.instanceId}"`;
    }
    if (fact.instanceType) {
      query += `, instanceType "${fact.instanceType}"`;
    }

    query += `}}`;

    await parseAndEvaluateStatement(query, undefined);
  } catch (err) {
    logger.error(`Failed to create memory from fact: ${err}`);
    throw err;
  }
}

function escapeString(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
