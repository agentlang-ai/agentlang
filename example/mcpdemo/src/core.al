module mcpdemo.core

agent chatAgent {
    llm "mcpdemo_llm",
    instruction "Answer user queries",
    tools [deepwiki]
}

{
    "type": "mcp",
    "server_label": "deepwiki",
    "server_url": "https://mcp.deepwiki.com/mcp",
    "require_approval": "never"
} @as deepwiki
