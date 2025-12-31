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

@public agent findExistingContact {
  llm "llm01",
  role "Search for contact in HubSpot."
  instruction "You have available: {{contactEmail}}

Call agenticcrm.core/FindContactByEmail with email={{contactEmail}}

Return the ContactSearchResult that the tool provides.",
  responseSchema agenticcrm.core/ContactSearchResult,
  retry agenticcrm.core/classifyRetry,
  tools [agenticcrm.core/FindContactByEmail]
}

decision contactExistsCheck {
  case (contactFound == true) {
    ContactExists
  }
  case (contactFound == false) {
    ContactNotFound
  }
}

@public agent createChatAgent {
  llm "llm01",
  role "You are a chat-manager"
  instruction "Based on the user instruction, create chat messages",
  retry classifyRetry,
  tools [custom_config.core/ChatMessage]
}
