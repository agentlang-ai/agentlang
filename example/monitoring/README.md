# Agent Monitoring Example — Customer and Product Manager

This example demonstrates **Agentlang’s built-in monitoring and introspection capabilities**, which allow developers to inspect the execution graph of agents, sub-agents, and workflows.  
Monitoring helps in understanding agent behavior, debugging failures, and auditing workflow execution paths.

---

## Overview

In this example, the **Customer and Product Manager** agent (`customerProductManager`) handles user requests that can refer to:
- **Customers** — such as creating or updating a customer record.
- **Products** — such as adding new products.
- **Others** — requests unrelated to customers or products are treated as failures.

The agent monitors and records each step of execution, including sub-agent invocations, entity creations, and decision outcomes.

---

## 1. Core Model

The following module defines the data model and decision logic.

```agentlang
module acme.core

entity Customer {
    email Email @id,
    name String,
    phone String
}

entity Product {
    id Int @id,
    name String,
    price Number
}

entity Failure {
    message String
}
```

The `decision classifyUserRequest` determines whether a request refers to a **Customer**, **Product**, or **Other** type.

---

## 2. Agents and Flows

Three key agents are involved:

```agentlang
agent createCustomer {
    instruction "Using the data provided by the user, create a new customer.",
    tools [acme.core/Customer]
}

agent createProduct {
    instruction "Using the data provided by the user, create a product.",
    tools [acme.core/Product]
}

agent reportFailure {
    instruction "Report failure if the request is unrelated to customers or products.",
    tools [acme.core/reportFailure]
}
```

### Flow Definition

```agentlang
flow customerProductManager {
    classifyUserRequest --> "Product" createProduct
    classifyUserRequest --> "Customer" createCustomer
    classifyUserRequest --> "Other" reportFailure
}
```

The flow first classifies the request and then routes it to the appropriate agent or workflow.

The top-level public agent exposes the flow:

```agentlang
@public agent customerProductManager {
    role "You are a product and customer manager"
}
```

---

## 3. Enabling Monitoring

Monitoring is configured in the `config.al` file.  
To enable it, include the following configuration:

```json
{
    "service": {"port": "#js parseInt(process.env.SERVICE_PORT || '8080')"},
    "store": {"type": "sqlite", "dbname": "monitoring.db"},
    "monitoring": {"enabled": true}
}
```

This configuration:
- Enables monitoring globally.
- Stores all monitoring data (agent executions, decisions, errors) in a local SQLite database named `monitoring.db`.

---

## 4. Example Request

A sample user request to create a customer:

```bash
curl -X POST http://localhost:8080/acme.core/customerProductManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "Create a customer named Joe with email joe@acme.com and phone 77838838"}'
```

This triggers the `customerProductManager` agent, which classifies the request as **Customer** and invokes `createCustomer`.

---

## 5. Fetching Monitoring Data

Monitoring data can be fetched using the special `agentlang/fetchEventMonitor` endpoint.
It returns the latest **execution tree** of the agent, showing all nested invocations, entities created, and any encountered errors.

```bash
curl -X POST http://localhost:8080/agentlang/fetchEventMonitor \
  -H 'Content-Type: application/json' \
  -d '{"eventName": "acme.core/customerProductManager"}' | jq .
```


To fetch all monitoring data relevant to an event or agent, use the `agentlang/fetchEventMonitors` endpoint, which allows pagination.


```bash
curl -X POST http://localhost:8080/agentlang/fetchEventMonitors \
  -H 'Content-Type: application/json' \
  -d '{"eventName": "acme.core/customerProductManager", "limit": 5, "offset": 0}' | jq .
```

You can also fetch a particular instance of monitoring by `id`:

```bash
curl -X POST http://localhost:8080/agentlang/EventMonitor \
  -H 'Content-Type: application/json' \
  -d '{"id": "0c4d7831-0de5-4341-ab1d-eece7db78018"}' | jq .
```

---

## 6. Sample Monitoring Output

When monitoring is enabled, each agent execution produces a structured JSON object containing detailed **latency metrics**, **timestamps**, **nested subgraphs**, and **execution results**.  
This enables you to trace the complete lifecycle of a request, including every internal agent call and data creation step.

A successful execution of the `customerProductManager` agent might produce monitoring data like the following:

```json
 {
    "id": "22d6f860-a6c1-4c42-b1ae-3a3b88de0745",
    "totalLatencyMs": 3090,
    "timestamp": 1762754631100,
    "flow": [
      {
        "input": "{acme.core/customerProductManager {message \"Create a customer named Joe with email joe@acme.com and phone 77838838}}",
        "timestamp": 1762754631188,
        "latencyMs": 9,
        "finalResult": [
          {
            "AL_INSTANCE": true,
            "name": "Agent",
            "moduleName": "agentlang.ai",
            "attributes": {
              "name": "customerProductManager",
              "moduleName": "acme.core",
              "type": "chat",
              "runWorkflows": true,
              "instruction": null,
              "tools": null,
              "documents": null,
              "channels": null,
              "role": "You are a product and customer manager",
              "flows": null,
              "validate": null,
              "retry": null,
              "llm": "customerProductManager_llm",
              "__path__": "agentlang.ai$Agent/customerProductManager",
              "__parent__": ""
            }
          }
        ],
        "llm": {
          "prompt": "Now consider the following flowchart:\nclassifyUserRequest --> \"Product\" createProduct\n    classifyUserRequest --> \"Customer\" createCustomer\n    classifyUserRequest --> \"Other\" reportFailure\n\n  If you understand from the context that a step with no further possible steps has been evaluated,\n  terminate the flowchart by returning DONE. Never return to the top or root step of the flowchart, instead return DONE.\n\nContext:\nCreate a customer named Joe with email joe@acme.com and phone 77838838",
          "response": "classifyUserRequest",
          "isPlanner": false,
          "isFlowStep": true,
          "isDecision": false
        }
      },
      {
        "input": "classifyUserRequest",
        "timestamp": 1762754636033,
        "latencyMs": 719,
        "finalResult": "Customer",
        "llm": {
          "prompt": "\nContext:\nCreate a customer named Joe with email joe@acme.com and phone 77838838",
          "response": "Customer",
          "isPlanner": false,
          "isFlowStep": true,
          "isDecision": true
        }
      },
      {
        "input": "createCustomer",
        "timestamp": 1762754637451,
        "latencyMs": 2356,
        "finalResult": {
          "AL_INSTANCE": true,
          "name": "Customer",
          "moduleName": "acme.core",
          "attributes": {
            "email": "joe@acme.com",
            "name": "Joe",
            "phone": "77838838",
            "__path__": "acme.core$Customer/joe@acme.com"
          }
        },
        "llm": {
          "prompt": "\nContext:\nCreate a customer named Joe with email joe@acme.com and phone 77838838",
          "response": "{acme.core/createCustomer {message \"Create a customer named Joe with email joe@acme.com and phone 77838838\"}}",
          "isPlanner": false,
          "isFlowStep": true,
          "isDecision": false
        }
      },
      {
        "id": "e4674faf-ee44-4d06-8e67-bb7711d7fae0",
        "totalLatencyMs": 0,
        "flow": [
          {
            "id": "da0fbf4c-e8ec-46de-8555-54d5c0ab6a4b",
            "totalLatencyMs": 9,
            "flow": [
              {
                "input": "{acme.core/createCustomer {message \"Create a customer named Joe with email joe@acme.com and phone 77838838\"}}",
                "timestamp": 1762754638762,
                "latencyMs": 6,
                "finalResult": [
                  {
                    "AL_INSTANCE": true,
                    "name": "Agent",
                    "moduleName": "agentlang.ai",
                    "attributes": {
                      "name": "createCustomer",
                      "moduleName": "acme.core",
                      "type": "chat",
                      "runWorkflows": true,
                      "instruction": "Based on the user request, create a new customer.",
                      "tools": "acme.core/Customer",
                      "documents": null,
                      "channels": null,
                      "role": null,
                      "flows": null,
                      "validate": null,
                      "retry": null,
                      "llm": "createCustomer_llm",
                      "__path__": "agentlang.ai$Agent/createCustomer",
                      "__parent__": ""
                    }
                  }
                ],
                "llm": {
                  "prompt": "Create a customer named Joe with email joe@acme.com and phone 77838838\nContext:\nCreate a customer named Joe with email joe@acme.com and phone 77838838",
                  "response": "[{acme.core/Customer {email \"joe@acme.com\", name \"Joe\", phone \"77838838\"}}]",
                  "isPlanner": true,
                  "isFlowStep": false,
                  "isDecision": false
                }
              },
              {
                "id": "a147e77c-2ccb-4922-a123-6a690bcc7289",
                "totalLatencyMs": 4,
                "flow": [
                  {
                    "input": "{acme.core/Customer {email \"joe@acme.com\", name \"Joe\", phone \"77838838\"}}",
                    "timestamp": 1762754639803,
                    "latencyMs": 4,
                    "finalResult": {
                      "AL_INSTANCE": true,
                      "name": "Customer",
                      "moduleName": "acme.core",
                      "attributes": {
                        "email": "joe@acme.com",
                        "name": "Joe",
                        "phone": "77838838",
                        "__path__": "acme.core$Customer/joe@acme.com"
                      }
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    "agent": "acme.core/customerProductManager",
    "agentInstance": {
      "AL_INSTANCE": true,
      "name": "customerProductManager",
      "moduleName": "acme.core",
      "attributes": {
        "message": "Create a customer named Joe with email joe@acme.com and phone 77838838"
      }
    },
  "user": "c33d2653-5d1f-4c17-b075-01a03d194a2b"
}
```

### Explanation of Fields

| Field | Description |
|--------|--------------|
| **id** | Unique identifier for the monitored agent execution. |
| **totalLatencyMs** | Total time taken by this agent or sub-agent (in milliseconds). |
| **timestamp** | Unix timestamp (in ms) indicating when the step started. |
| **flow** | Array representing the hierarchical flow of sub-steps or nested agents. |
| **input** | The specific statement or agent invocation being monitored. |
| **finalResult** | The final outcome of the step — may include entity data (`AL_INSTANCE`) or decision results. |
| **llm** | If the step was executed by an agent — the prompt, response and `agent-type` flags (planner, flow, decision). |
| **agent** or **event** | Name of the top-level agent or event invoked. |
| **agentInstance** or **eventInstance** | Full instance of top-level agent or event invoked. |
| **user** | Identifier for the user or request source that triggered this workflow. |

### Hierarchical Graph Structure

Monitoring data is **hierarchical**, reflecting the nested nature of Agentlang’s execution graph:
- Each agent or flow is represented as a node with its own `id` and `totalLatencyMs`.
- Sub-agents appear inside the parent’s `graph` array.
- Each node may contain multiple leaf steps — e.g., entity creation, subflow invocation, or decision results.

This hierarchical representation allows developers and tools to visualize performance and trace errors down to the most granular level.

### Visual Summary

```
customerProductManager (totalLatency: 3548 ms)
 ├── classifyUserRequest → "Customer" (667 ms)
 ├── createCustomer (2881 ms)
 │    └── acme.core/createCustomer (1521 ms)
 │         └── acme.core/Customer (3 ms)
```

The visualization clearly shows:
- Each **agent** and **sub-agent** executed.
- The **latency** contribution of each step.
- The **final instance** created (`Customer` with attributes `email`, `name`, and `phone`).

---

## 7. Benefits of Agent Monitoring

With monitoring enabled, you can:
- Trace all sub-agent and workflow executions.
- Identify which part of an agent failed and why.
- Visualize execution paths and data flows.
- Audit historical requests for debugging or compliance.

---

## 8. Summary

| Feature | Description |
|----------|--------------|
| **Monitoring** | Tracks all agent and workflow executions. |
| **Database Storage** | Uses a SQLite-backed store for historical analysis. |
| **fetchMonitor API** | Fetches detailed execution graphs for any agent. |
| **Use Case** | Ideal for debugging, auditing, and analyzing complex agent interactions. |

---

**In short**, Agentlang’s monitoring feature turns every agent execution into an inspectable, structured graph — enabling full transparency, debuggability, and accountability for autonomous workflows.