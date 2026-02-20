import { makeCoreModuleName } from '../util.js';

export const CoreKnowledgeModuleName = makeCoreModuleName('knowledge');

export default `module ${CoreKnowledgeModuleName}

entity KnowledgeEntity {
    id UUID @id @default(uuid()),
    name String,
    entityType String,
    description String @optional,
    sourceType @enum("DOCUMENT", "CONVERSATION", "INSTANCE", "DERIVED"),
    sourceId String @optional,
    sourceChunk String @optional,
    instanceId String @optional,
    instanceType String @optional,
    agentId String,
    confidence Float @default(1.0),
    isLatest Boolean @default(true),
    embedding String @optional,
    @meta {"fullTextSearch": ["name", "entityType", "description"]}
}

entity KnowledgeEdge {
    id UUID @id @default(uuid()),
    sourceId String,
    targetId String,
    relType String,
    weight Float @default(1.0),
    sourceType @enum("DOCUMENT", "CONVERSATION", "INSTANCE", "DERIVED") @optional,
    agentId String,
    createdAt DateTime @default(now())
}

entity KnowledgeSession {
    id UUID @id @default(uuid()),
    agentId String,
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

entity DocumentGroup {
    id UUID @id @default(uuid()),
    name String,
    agentId String,
    createdAt DateTime @default(now())
}

entity Document {
    id UUID @id @default(uuid()),
    title String @optional,
    content String @optional,
    sourceType @enum("FILE", "URL", "TEXT", "CONVERSATION"),
    sourceUrl String @optional,
    documentGroupId String @optional,
    agentId String,
    createdAt DateTime @default(now()),
    @meta {"fullTextSearch": ["title", "content"]}
}

relationship DocumentGroupContains contains(DocumentGroup, Document)
`;
