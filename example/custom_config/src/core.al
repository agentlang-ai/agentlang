module custom_config.core

import "resolver.js" @as r

entity Config {
    id UUID @id @default(uuid()),
    server String,
    key String
}

entity ChatMessage {
    id Int @id,
    message String,
    to String
}

resolver ChatResolver ["custom_config.core/ChatMessage"] {
    create r.createChatMessage
}