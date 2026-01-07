# MCP Integration Example (Agentlang)

This example demonstrates how **Agentlang** can integrate with **MCP (Model Context Protocol) servers** to extend agent capabilities beyond the local application. By wiring agents to MCP-backed tools, Agentlang allows agents to delegate tasks such as knowledge retrieval and issue management to external, specialized systems—without embedding custom integration code.

---

## Overview

In this application:

* Agents are connected to **remote MCP servers**.
* Each MCP server is exposed as a **tool** that agents can invoke.
* The agent focuses on intent and orchestration, while MCP servers handle execution.
* No resolver or workflow code is required for the integration.

The example includes two agents:

* A **chat agent** that queries DeepWiki for factual and analytical responses.
* An **issue manager agent** that creates Jira tickets via an MCP-enabled Jira service.

---

## Module Definition

```agentlang
module mcpdemo.core
```

---

## Chat Agent (DeepWiki MCP)

### Agent Definition

```agentlang
@public agent chatAgent {
    instruction "Answer user queries",
    tools [deepwiki]
}
```

### MCP Server Configuration

```agentlang
{
    "type": "mcp",
    "server_label": "deepwiki",
    "server_url": "https://mcp.deepwiki.com/mcp",
    "require_approval": "never"
} @as deepwiki
```

### What This Does

* Registers an MCP server labeled `deepwiki`
* Makes it available to the agent as a tool
* Allows the agent to fetch insights, forecasts, and explanations from DeepWiki

### Example Request

```bash
curl -X POST http://localhost:8080/mcpdemo.core/chatAgent \
  -H 'Content-Type: application/json' \
  -d '{"message": "What will Indian economy look like in 2040?"}'
```

**Result:**
The agent invokes the DeepWiki MCP server and returns an analysis or forecast of the Indian economy in 2040.


## Summary

With MCP support, Agentlang agents can seamlessly interact with powerful external systems such as knowledge engines, ticketing platforms, and automation tools. This enables rapid composition of intelligent, real-world applications by combining Agentlang’s declarative agent model with MCP’s standardized tool interface.
