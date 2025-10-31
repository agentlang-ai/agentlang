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

If all went well, the returned JSON structure might look like:

```json
[
  {
    "statement": "{classifyUserRequest {message Create a customer named Joe with email joe@acme.com and phone 77838838}}",
    "result": "Customer"
  },
  {
    "statement": "{createCustomer {message Create a customer named Joe with email joe@acme.com and phone 77838838\nclassifyUserRequest --> Customer\n}}",
    "result": {
      "id": "44911187-e16b-441d-bf0f-4d11f9448f45",
      "record": {"name": "Customer", "moduleName": "acme.core"},
      "name": "Customer"
    }
  },
  {
    "entries": [
      {
        "statement": "{acme.core/createCustomer {message \"name: Joe, email: joe@acme.com, phone: 77838838\"}}",
        "result": {"name": "Customer"}
      }
    ]
  }
]
```

Each entry represents a **monitored statement**:
- `statement` — the agent or workflow executed.
- `result` — the successful result (if applicable).
- `error` — included if the step failed.

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

