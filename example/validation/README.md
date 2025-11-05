# Network Provisioning Manager — Validation and Retry Example

This example demonstrates how **Agentlang** supports **automatic validation** and **retry mechanisms** within agent workflows.  
The model implements a **network provisioning system** where requests are analyzed, validated, and processed based on their type — DNS or WLAN — with built-in error handling and retry logic.

---

## Overview

In this module, a network provisioning request can be of two types:
- **DNS** – requires a CNAME and an IP address.
- **WLAN** – requires only an IP address.

An agent named `classifyNetworkProvisioningRequest` first analyzes the request, determines its type, and validates the provided data before dispatching it to the appropriate provisioning workflow.

---

## Key Concepts

### 1. Validation with `validate`

The `validate` attribute allows agents to validate their responses using a predefined workflow.  
In this example, the validation workflow `validateProvisiongRequest` ensures that each request includes both a `requestedBy` and an `IPAddress` field.

```agentlang
validate net.core/validateProvisiongRequest
```

If either of these fields is missing, the validator emits a `ValidationResult` with status `"error"` and an explanatory `reason`.

**Example validation workflow:**

```agentlang
workflow validateProvisiongRequest {
    if (not(validateProvisiongRequest.data.requestedBy)) {
        {agentlang/ValidationResult {status "error", reason "requestedBy is required"}}
    } else if (not(validateProvisiongRequest.data.IPAddress)) {
        {agentlang/ValidationResult {status "error", reason "IPAddress is required"}}
    } else {
        {agentlang/ValidationResult {status "ok"}}
    }
}
```

---

### 2. Retrying on Failure

When validation fails, the agent can **automatically retry** using a configurable retry policy.  
The retry policy is defined using the `agentlang/retry` construct.

```agentlang
agentlang/retry classifyRetry {
    attempts 3,
    backoff {
        strategy linear,
        delay 2,
        magnitude seconds,
        factor 2
    }
}
```

This configuration tells Agentlang to:
- Retry up to **3 times**.
- Wait **2 seconds** between attempts.
- Increase the delay linearly by a factor of 2 with each retry.

The retry policy is attached to the agent as follows:

```agentlang
retry net.core/classifyRetry
```

This ensures that if the agent’s validation fails, it will automatically attempt to re-analyze the request after each backoff interval until successful or until retry limits are reached.

---

### 3. Retry Strategies

Agentlang supports three **retry backoff strategies** for fine-grained control over retry timing:

| Strategy      | Description |
|----------------|-------------|
| **constant**   | Uses a fixed delay between retries. For example, always retry after 3 seconds. |
| **linear**     | Increases delay by a fixed multiple (e.g., 2s, 4s, 6s...). |
| **exponential**| Doubles the delay after each failed attempt (e.g., 2s, 4s, 8s...). |

These strategies help balance reliability and responsiveness depending on the nature of the failure or system load.

---

### 4. Example: Triggering a Retry

If a user sends a provisioning request without the required `requestedBy` field, validation will fail, and the agent will **automatically retry** up to the configured number of attempts.

**Example request:**

```shell
curl -X POST http://localhost:8080/net.core/networkProvisioningRequestManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "provision dns with ip 192.3.3.1 and cname acme.com"}'
```

During the retry process, the agent will make a best effort to correct the error —  
for instance, by assigning a default value such as `"Unknown"` or `"anonymous"` to the missing `requestedBy` field before retrying validation.

---

### 5. Agent Definitions

#### `classifyNetworkProvisioningRequest`
- **Role:** Classifies the incoming request as DNS, WLAN, or Other.
- **Schema:** `NetworkProvisioningRequest`
- **Validation:** `net.core/validateProvisiongRequest`
- **Retry policy:** `net.core/classifyRetry`

```agentlang
agent classifyNetworkProvisioningRequest {
    instruction "Analyse the network provisioning request and return its type and other relevant information.",
    responseSchema NetworkProvisioningRequest,
    validate net.core/validateProvisiongRequest,
    retry net.core/classifyRetry
}
```

#### `provisionDNS`
Executes DNS provisioning based on the classified request.

#### `provisionWLAN`
Executes WLAN provisioning.

#### `reportFailure`
Handles failed or invalid requests by recording a failure event.

#### `markTicketAsDone`
Marks successful provisioning requests as completed.

---

### 6. Workflow Orchestration

The `flow` construct defines the orchestration between agents.  
The flow `networkProvisioningRequestManager` connects classification, provisioning, and completion agents.

```agentlang
flow networkProvisioningRequestManager {
    classifyNetworkProvisioningRequest --> "type is DNS" provisionDNS
    classifyNetworkProvisioningRequest --> "type is WLAN" provisionWLAN
    provisionDNS --> markTicketAsDone
    provisionWLAN --> markTicketAsDone
    classifyNetworkProvisioningRequest --> "type is Other" reportFailure
}
```

This ensures that each type of network request is routed to the right workflow branch, and failures are handled gracefully.

---

### 7. Public Agent Interface

The flow is exposed through the following public agent:

```agentlang
@public agent networkProvisioningRequestManager {
    role "You are a network-provisioning request manager"
}
```

This allows clients to submit provisioning requests through a simple REST API endpoint.

---

## Summary

This example illustrates how Agentlang supports **reliable and resilient agent behavior** through:

- **Structured validation** of agent outputs.  
- **Automated retry logic** with configurable backoff strategies.  
- **Declarative orchestration** of multiple agents through flows.

Together, these capabilities allow developers to build agents that not only act autonomously but also **recover intelligently from validation failures**, ensuring consistency and robustness in real-world automation tasks.
````