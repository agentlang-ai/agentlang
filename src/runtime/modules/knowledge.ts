import { makeCoreModuleName } from '../util.js';

export const CoreKnowledgeModuleName = makeCoreModuleName('knowledge');

export default `module ${CoreKnowledgeModuleName}

entity KnowledgeNode {
    id UUID @id @default(uuid()),
    name String,
    type String,
    description String @optional,
    sourceType @enum("DOCUMENT", "CONVERSATION", "INSTANCE", "DERIVED"),
    sourceId String @optional,
    sourceChunk String @optional,
    instanceId String @optional,
    instanceType String @optional,
    containerTag String,
    userId String,
    agentId String @optional,
    confidence Float @default(1.0),
    isLatest Boolean @default(true),
    @meta {"fullTextSearch": ["name", "type", "description"]}
}

entity KnowledgeEdge {
    id UUID @id @default(uuid()),
    sourceId String,
    targetId String,
    relType String,
    weight Float @default(1.0),
    sourceType @enum("DOCUMENT", "CONVERSATION", "INSTANCE", "DERIVED") @optional,
    containerTag String,
    userId String,
    agentId String @optional,
    createdAt DateTime @default(now())
}

entity KnowledgeSession {
    id UUID @id @default(uuid()),
    userId String,
    agentId String,
    containerTag String,
    messages String,
    contextNodeIds String @optional,
    activeInstances String @optional,
    documentsProcessed Boolean @default(false),
    createdAt DateTime @default(now()),
    lastActivity DateTime @default(now()),
    expiresAt DateTime @optional
}

entity SessionMessage {
    id UUID @id @default(uuid()),
    role @enum("user", "assistant", "system"),
    content String,
    sessionId String @optional,
    extractedNodeIds String @optional,
    timestamp DateTime @default(now())
}
`;
