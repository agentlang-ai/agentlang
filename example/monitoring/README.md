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

Monitoring data can be fetched using the special `agentlang/fetchMonitor` endpoint.  
It returns the **execution tree** of the agent, showing all nested invocations, entities created, and any encountered errors.

```bash
curl -X POST http://localhost:8080/agentlang/fetchMonitor \
  -H 'Content-Type: application/json' \
  -d '{"eventName": "acme.core/customerProductManager"}' | jq .
```

---

## 6. Sample Monitoring Output

When monitoring is enabled, each agent execution produces a structured JSON object containing detailed **latency metrics**, **timestamps**, **nested subgraphs**, and **execution results**.  
This enables you to trace the complete lifecycle of a request, including every internal agent call and data creation step.

A successful execution of the `customerProductManager` agent might produce monitoring data like the following:

```json
[
  {
    "id": "d4e0ec8e-7ce6-4f5a-ad2e-2a66850b3afe",
    "totalLatencyMs": 3548,
    "flow": [
      {
        "input": "{flowStep classifyUserRequest, message \"Create a customer named Joe with email joe@acme.com and phone 77838838\"}",
        "timestamp": 1762245788012,
        "latencyMs": 667,
        "result": "Customer"
      },
      {
        "input": "{flowStep createCustomer, message \"Create a customer named Joe with email joe@acme.com and phone 77838838\nclassifyUserRequest --> Customer\n\"}",
        "timestamp": 1762245789264,
        "latencyMs": 2881,
        "result": {
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
      },
      {
        "id": "8f6708c5-c3a1-4edf-9034-54b8949636c1",
        "totalLatencyMs": 1521,
        "flow": [
          {
            "input": "{acme.core/createCustomer {message \"Create a customer named Joe with email joe@acme.com and phone 77838838\"}}",
            "timestamp": 1762245790624,
            "latencyMs": 1521,
            "result": {
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
          },
          {
            "id": "66e4e74d-e37b-44be-b1da-93e98dfdaaf7",
            "totalLatencyMs": 0,
            "flow": [
              {
                "id": "3a75f3c2-2ee3-48b6-bcee-2afbbbf28e86",
                "totalLatencyMs": 3,
                "flow": [
                  {
                    "input": "{acme.core/Customer {email \"joe@acme.com\", name \"Joe\", phone \"77838838\"}}",
                    "timestamp": 1762245792142,
                    "latencyMs": 3,
                    "result": {
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
]
```

### Explanation of Fields

| Field | Description |
|--------|--------------|
| **id** | Unique identifier for the monitored agent execution. |
| **totalLatencyMs** | Total time taken by this agent or sub-agent (in milliseconds). |
| **timestamp** | Unix timestamp (in ms) indicating when the step started. |
| **flow** | Array representing the hierarchical flow of sub-steps or nested agents. |
| **input** | The specific statement or agent invocation being monitored. |
| **result** | The outcome of the step — may include entity data (`AL_INSTANCE`) or decision results. |
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