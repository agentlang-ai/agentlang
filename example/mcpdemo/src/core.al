module mcpdemo.core

@public agent chatAgent {
    instruction "Answer user queries",
    tools [deepwiki]
}

{
    "type": "mcp",
    "server_label": "deepwiki",
    "server_url": "https://mcp.deepwiki.com/mcp",
    "require_approval": "never"
} @as deepwiki

{
    agentlang.mcp/createClient {
        name "deepwiki",
        serverUrl "https://mcp.deepwiki.com/mcp"
    }
}

@public workflow askDeepWiki {
    {
        deepwiki.mcp/ask_question {
            repoName: askDeepWiki.repoName,
            question: askDeepWiki.question
        }
    }
}
