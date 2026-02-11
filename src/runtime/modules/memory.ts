import { makeCoreModuleName } from '../util.js';

export const CoreMemoryModuleName = makeCoreModuleName('memory');

export default `module ${CoreMemoryModuleName}

import "./modules/memory.js" @as memory

entity Memory {
    id UUID @id @default(uuid()),
    content String,
    type @enum("FACT", "PREFERENCE", "EPISODE", "DERIVED") @default("FACT"),
    category String @optional,
    updatesId UUID @optional,
    extendsId UUID @optional,
    derivedFromIds String @optional,
    instanceId String @optional,
    instanceType String @optional,
    isLatest Boolean @default(true),
    validFrom DateTime @default(now()),
    validUntil DateTime @optional,
    sourceType @enum("DOCUMENT", "CONVERSATION", "INSTANCE", "INFERENCE"),
    sourceId String @optional,
    sourceChunk String @optional,
    containerTag String,
    userId String,
    agentId String @optional,
    sessionId String @optional,
    confidence Float @default(1.0),
    metadata Map @optional,
    embeddingConfig Map @optional,
    @meta {"fullTextSearch": "*"}
}

event addMemory {
    content String,
    type @enum("FACT", "PREFERENCE", "EPISODE", "DERIVED") @default("FACT"),
    category String @optional,
    sourceType @enum("DOCUMENT", "CONVERSATION", "INSTANCE", "INFERENCE"),
    sourceId String @optional,
    containerTag String,
    userId String,
    agentId String @optional,
    sessionId String @optional,
    embeddingConfig Map @optional
}

workflow addMemory {
    await memory.embedAndStore(
        addMemory.content,
        addMemory.type,
        addMemory.category,
        addMemory.sourceType,
        addMemory.sourceId,
        addMemory.containerTag,
        addMemory.userId,
        addMemory.agentId,
        addMemory.sessionId,
        addMemory.embeddingConfig)
}

entity AgentSession {
    id UUID @id @default(uuid()),
    userId String,
    agentId String,
    containerTag String,
    messages String,
    contextMemoryIds String @optional,
    activeInstances String @optional,
    createdAt DateTime @default(now()),
    lastActivity DateTime @default(now()),
    expiresAt DateTime @optional
}

entity SessionMessage {
    id UUID @id @default(uuid()),
    role @enum("user", "assistant", "system"),
    content String,
    extractedMemoryIds String @optional,
    timestamp DateTime @default(now())
}

entity ActiveInstance {
    instanceId String,
    entityType String,
    relevance Float,
    lastAccessed DateTime @default(now())
}
`;
