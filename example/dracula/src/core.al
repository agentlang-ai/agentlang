module Dracula

{agentlang.ai/LLM {
  name "llm01",
  service "openai",
  config {"model": "gpt-4o"}
  }, @upsert}

{agentlang.ai/doc {
  title "dracula",
  url "./example/dracula/docs/dracula.txt"}, @upsert}

@public agent dracula {
    instruction `You are an expert on "Dracula" by Bram Stoker.
You have deep knowledge of all the characters, locations, events, and relationships in the novel.

When answering questions:
1. Reference specific characters and their roles (e.g., "Van Helsing leads the group hunting Dracula")
2. Mention specific events and journal entries when relevant
3. Describe character traits, motivations, and transformations accurately
4. Explain the connections between characters and events
5. Be atmospheric and capture the gothic horror tone of the novel`,
    documents ["dracula"],
    llm "llm01"
}

@public workflow ask {
    {dracula {message ask.question}}
}
