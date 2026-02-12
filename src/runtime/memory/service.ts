import { logger } from '../logger.js';
import { CoreMemoryModuleName } from '../modules/memory.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import type { Instance } from '../module.js';

export interface SessionContext {
  sessionId: string;
  userId: string;
  agentId: string;
  containerTag: string;
}

export interface MemoryContext {
  memories: Instance[];
  instances: Instance[];
  userProfile?: string;
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

/**
 * Retrieve relevant memories for the current context
 */
export async function retrieveMemoryContext(
  session: SessionContext,
  message: string
): Promise<MemoryContext> {
  try {
    // For now, return basic structure - semantic search will be implemented later
    // This is a placeholder that returns empty context
    // Full implementation will use vector search

    return {
      memories: [],
      instances: [],
      userProfile: undefined,
    };
  } catch (err) {
    logger.error(`Failed to retrieve memory context: ${err}`);
    return {
      memories: [],
      instances: [],
    };
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
    contextStr += 'Relevant Data:\n';
    context.instances.forEach((instance: Instance) => {
      const entityType = instance.lookup('entityType');
      const instanceId = instance.lookup('instanceId');
      contextStr += `- ${entityType}: ${instanceId}\n`;
    });
  }

  return contextStr;
}

/**
 * Store a conversation episode
 */
export async function storeEpisode(
  sessionId: string,
  userMessage: string,
  assistantResponse: string,
  containerTag: string
): Promise<void> {
  try {
    // Create episode memory
    await parseAndEvaluateStatement(
      `{${CoreMemoryModuleName}/Memory {
        type "EPISODE", 
        content "User: ${escapeString(userMessage)}\\nAssistant: ${escapeString(assistantResponse)}", 
        sourceType "CONVERSATION", 
        sourceId "${sessionId}", 
        containerTag "${containerTag}", 
        sessionId "${sessionId}", 
        isLatest true}}`,
      undefined
    );

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
  } catch (err) {
    logger.error(`Failed to store episode: ${err}`);
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

function escapeString(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
