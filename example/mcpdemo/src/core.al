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

@public agent issueManager {
    instruction "Manage issues on Jira for the user.",
    tools [rubeJira]
}

{
    "type": "mcp",
    "server_label": "rube",
    "server_url": "https://rube.app/mcp",
    "require_approval": "never",
    "authorization": process.env.RUBE_MCP_TOKEN
} @as rubeJira
