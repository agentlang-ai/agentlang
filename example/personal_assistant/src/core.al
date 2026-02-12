module PersonalAssistant

{agentlang.ai/LLM {
  name "llm01",
  service "anthropic",
  config {"model": "claude-sonnet-4-5"}
  }, @upsert}

 {agentlang.ai/doc {
   title "company handbook",
   url "./example/personal_assistant/docs/company_handbook.txt"}}

{agentlang.ai/doc {
    title "project guidelines",
    url "./example/personal_assistant/docs/project_guidelines.txt"}}

// ---- The Assistant Agent ----
// This agent has memory AUTOMATICALLY. Every conversation is stored,
// facts are extracted, and context is retrieved for future queries.

@public agent assistant {
    instruction `You are a friendly and helpful personal assistant with a great memory.
    Additionally, refer to the documents provided to answer user's query if it matches things there.

Your key traits:
1. REMEMBER everything the user tells you - their name, preferences, interests, and past conversations
2. Be warm, conversational, and personable
3. Reference past conversations naturally ("As you mentioned before..." or "I remember you said...")
4. Ask follow-up questions to learn more about the user
5. Be helpful with any task - from simple questions to complex planning

When chatting:
- Greet users warmly, especially if you remember their name
- Make connections between current and past conversations
- Show genuine interest in what the user shares
- Be concise but engaging
- If you don't know something, say so honestly

Examples of good responses:
- "Hi Sarah! Great to hear from you again. How did that project deadline go?"
- "I remember you mentioned you love hiking. Have you been on any trails lately?"
- "Based on our conversation yesterday about your Python learning, here are some resources..."

Your memory is automatic - every conversation is stored and relevant context is retrieved.`,
    documents ["company handbook", "project guidelines"],
    llm "llm01"
}

@public workflow chat {
    {assistant {message chat.message}}
}

// =============================================================================
// Personal Assistant with Memory - Usage Guide
// =============================================================================
//
// Start the app:
//   node ./bin/cli.js run example/personal_assistant
//
// Then watch the console output for memory visualization!
//
// Example conversation flow:
//
// 1. Introduce yourself:
//    curl -X POST http://localhost:8080/PersonalAssistant/chat \
//      -H 'Content-Type: application/json' \
//      -d '{"message": "Hi! My name is Alex and I love programming in Python."}'
//
//    Console will show:
//    ┌─────────────────────────────────────────────────────────────┐
//    │ MEMORY ADDED                                                │
//    │ Type: EPISODE                                               │
//    │ Content: User: Hi! My name is Alex...                       │
//    └─────────────────────────────────────────────────────────────┘
//
// 2. Test memory recall:
//    curl -X POST http://localhost:8080/PersonalAssistant/chat \
//      -H 'Content-Type: application/json' \
//      -d '{"message": "What do you remember about me?"}'
//
//    Console will show memory retrieval:
//    ┌─────────────────────────────────────────────────────────────┐
//    │ MEMORY RETRIEVAL                                            │
//    │ Vector search found: 2 memories                             │
//    │ Retrieved memories:                                         │
//    │   [EPISODE] User: Hi! My name is Alex...                    │
//    └─────────────────────────────────────────────────────────────┘
//
// 3. Add more context:
//    curl -X POST http://localhost:8080/PersonalAssistant/chat \
//      -H 'Content-Type: application/json' \
//      -d '{"message": "I work at a startup and our tech stack is Python and React."}'
//
// 4. Ask about your interests later:
//    curl -X POST http://localhost:8080/PersonalAssistant/chat \
//      -H 'Content-Type: application/json' \
//      -d '{"message": "What programming languages have I mentioned?"}'
//
// The graph visualization shows:
// - Node additions when memories are stored
// - Edge connections between related memories
// - Memory retrieval during context building
//
// =============================================================================
