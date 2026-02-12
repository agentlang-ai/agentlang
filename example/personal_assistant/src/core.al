module PersonalAssistant

// ---- The Assistant Agent ----
// This agent has memory AUTOMATICALLY. Every conversation is stored,
// facts are extracted, and context is retrieved for future queries.

@public agent assistant {
    instruction `You are a helpful personal assistant for employees at ACME Corporation.

Your capabilities:
1. Answer questions about company policies using the handbook and project guidelines
2. Remember user preferences and past interactions
3. Provide personalized assistance based on conversation history

When interacting with users:
- Be concise but helpful
- Remember their name, role, and preferences
- Track their tasks and remind them of upcoming items
- Reference relevant company policies when appropriate

You have access to company documents and can create/query tasks, notes, and reminders.`,
    documents ["company handbook", "project guidelines"]
}

// ---- Public Workflow ----
// This exposes the assistant via HTTP. Each user gets their own memory space
// automatically isolated by the containerTag (agent:userId).

@public workflow chat {
    {assistant {message chat.message}}
}

// =============================================================================
// Usage Examples
// =============================================================================
//
// Start the app:
//   node ./bin/cli.js run example/personal_assistant
//
// First conversation - introduce yourself:
//   curl -X POST http://localhost:8080/PersonalAssistant/chat \
//     -H 'Content-Type: application/json' \
//     -d '{"message": "Hi! My name is Sarah and I work as a software engineer."}'
//
// The assistant will remember this. Ask a follow-up:
//   curl -X POST http://localhost:8080/PersonalAssistant/chat \
//     -H 'Content-Type: application/json' \
//     -d '{"message": "What was my name again?"}'
//
// Ask about company policy:
//   curl -X POST http://localhost:8080/PersonalAssistant/chat \
//     -H 'Content-Type: application/json' \
//     -d '{"message": "How many vacation days do I get per year?"}'
//
// Later, ask about your tasks:
//   curl -X POST http://localhost:8080/PersonalAssistant/chat \
//     -H 'Content-Type: application/json' \
//     -d '{"message": "What tasks do I have?"}'
//
// The assistant remembers context across all these conversations automatically!
// =============================================================================
