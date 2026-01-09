# Agentlang MCP Integration Example

This example demonstrates **two supported ways to interact with MCP (Model Context Protocol) servers in Agentlang**:

1. **Attaching an MCP server as a tool to an agent**
2. **Explicitly creating an MCP client and invoking MCP tools from workflows**

Both approaches connect Agentlang applications to external MCP servers, such as **DeepWiki**, but they differ in how much control you want over tool invocation.

---

## Overview

* **Module**: `mcpdemo.core`
* **MCP Server Used**: DeepWiki (`https://mcp.deepwiki.com/mcp`)
* **Capabilities Demonstrated**:

  * Agent-driven MCP tool usage
  * Workflow-driven MCP tool invocation
  * Dynamic creation of MCP clients
  * Exposure of MCP tools as Agentlang events

---

## Example Code

```agentlang
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
            repoName: askDeepWiki.repName,
            question: askDeepWiki.question
        }
    }
}
```

---

## Approach 1: Using an MCP Server as an Agent Tool

In this approach, the MCP server is declared as a **tool** and attached directly to an agent.

```agentlang
@public agent chatAgent {
    instruction "Answer user queries",
    tools [deepwiki]
}
```

### How it works

* Agentlang automatically creates and manages the MCP client.
* All tools exposed by the MCP server become available to the agent.
* The agent decides *when* and *how* to invoke those tools during reasoning.
* No explicit workflow calls are required.

### When to use this

* Conversational agents
* Assistants and copilots
* Scenarios where the agent should autonomously choose MCP tools

---

## Approach 2: Explicit MCP Client Creation for Workflow Use

This approach explicitly creates an MCP client using the built-in `agentlang.mcp/createClient` event.

```agentlang
{
    agentlang.mcp/createClient {
        name "deepwiki",
        serverUrl "https://mcp.deepwiki.com/mcp"
    }
}
```

### What this does

* Creates an MCP client named `deepwiki`
* Connects it to the specified MCP server
* Dynamically exposes all MCP tools as **Agentlang events**
* These events appear under a new module named:

```
<client-name>.mcp
```

In this example, tools are exposed under:

```
deepwiki.mcp
```

---

## Calling MCP Tools from a Workflow

Once the client is created, MCP tools can be invoked deterministically from workflows.

```agentlang
@public workflow askDeepWiki {
    {
        deepwiki.mcp/ask_question {
            repoName: askDeepWiki.repName,
            question: askDeepWiki.question
        }
    }
}
```

### Characteristics

* MCP tools behave like native Agentlang events
* Fully deterministic and programmable
* Suitable for pipelines, APIs, and backend integrations

---

## Invoking the Workflow

You can invoke the workflow using a standard HTTP request:

```bash
curl -X POST http://localhost:8080/mcpdemo.core/askDeepWiki \
  -H 'Content-Type: application/json' \
  -d '{"repoName": "python/cpython", "question": "what is GIL?"}'
```

### Expected Behavior

* The workflow calls the DeepWiki MCP server
* The `ask_question` tool is executed
* The response contains DeepWiki’s explanation of the Global Interpreter Lock (GIL)

---

## Choosing the Right Approach

| Use Case             | Recommended Approach |
| -------------------- | -------------------- |
| Conversational AI    | Agent + MCP tool     |
| Deterministic APIs   | Explicit MCP client  |
| Data pipelines       | Explicit MCP client  |
| Autonomous reasoning | Agent + MCP tool     |
| Fine-grained control | Explicit MCP client  |

---

## Summary

This example highlights Agentlang’s flexible MCP integration model:

* **Agents** can use MCP tools autonomously
* **Workflows** can call MCP tools explicitly
* MCP clients can be dynamically created at runtime
* MCP tools seamlessly map to Agentlang events

Together, these features make Agentlang a powerful platform for building applications that integrate LLMs, external knowledge systems, and enterprise tools via MCP.
