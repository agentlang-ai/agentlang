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

{
    "type": "mcp",
    "server_label": "jiraMcp",
    "server_url": "https://backend.composio.dev/v3/mcp/57a5a76d-4cbf-4acf-a01e-13b14adf3bdc/mcp?user_id=pg-test-61166010-51d9-4ca4-b304-27a06028fb1d",
    "require_approval": "never",
    "authorization": process.env.COMPOSIO_TOKEN
} @as jiraMcp

@public agent jiraManager {
    instruction "Manage Jira for the user",
    tools [jiraMcp]
}
