# Customer Support Application (Agentlang Example)

The **Customer Support App** demonstrates how **Agentlang** can be used to build an intelligent, autonomous workflow for managing support tickets — from classification to assignment and escalation — with minimal imperative code.

This example shows how entities, workflows, decisions, and agents collaborate to automate what would otherwise be a complex customer support process.

---

## Overview

Every support request in the system begins its life as a **Ticket** created by a **Customer**.
When a ticket is created, a sequence of intelligent actions automatically follows (asynchronously via the Ticket's after-create event):

1. **Classify** the ticket’s urgency and topic.
2. **Adjust priority** if necessary.
3. **Find a suitable support executive** whose skills match the problem.
4. **Assign** the ticket to that executive — or **escalate** it if no match is found.

All of this happens declaratively through **flows**, **decisions**, and **agents**.

---

## Entities

The model is defined under the `support.core` module:

* **Customer** — Represents the person raising a support request.
* **SupportExecutive** — Represents support team members, with indexed searchable `skills`.
* **Ticket** — Captures issue details, such as subject, description, priority, and status.
* **ExecutiveTicketAssignment** — Links a ticket to an assigned executive.
* **EscalationQueueEntry** — Represents tickets that need manual review.

Each `Ticket` automatically triggers the workflow `afterCreateTicket`, which launches the `ticketManager` flow to begin automated handling.

---

## Decision: Ticket Classification

The `classifyTicket` decision agent analyzes the ticket’s **subject** and **description** to infer its **priority**:

```agentlang
decision classifyTicket {
    case ("ticket.subject indicates 'urgent' or ticket.description is about 'payment'") {
        high
    }
    case ("ticket.subject indicates 'error' or ticket.description is abount an 'issue'") {
        medium
    }
    case ("for all other tickets") {
        low
    }
}
```

This declarative rulebase ensures that priority is consistently determined — no ad-hoc conditionals needed.

---

##  Workflows

Several workflows implement the business logic:

* **makeTicketHighPriority / makeTicketMediumPriority** — Automatically adjust ticket priority.
* **lookupSupportExecutive** — Uses full-text search to find an executive matching the ticket subject.
* **assignTicketToExecutive** — Creates a link between a `Ticket` and a `SupportExecutive`.

These workflows serve as reusable building blocks for the agent-driven flow.

---

## Agents

### `findSupportExecutive`

Searches for a support executive based on the ticket’s subject and description, leveraging the `lookupSupportExecutive` workflow as a tool.

```agentlang
agent findSupportExecutive {
    instruction "Lookup a support executive who can handle the ticket based on its subject - {{subject}}",
    tools [support.core/lookupSupportExecutive]
}
```

---

### `ticketAssignment`

An intelligent agent that decides whether to assign or escalate a ticket based on available context.
It uses **directives**, **scenarios**, and a **glossary** to make its decision process transparent and predictable.

```agentlang
agent ticketAssignment {
    role "You are an agent who assigns or escalates support tickets",
    instruction "When a new support ticket arrives, analyze its subject and description. 
If the ticket topic matches one of the support executive’s skills {{SupportExecutive.skills}}, assign it to that executive with email {{SupportExecutive.email}}.
Otherwise, escalate the ticket to the EscalationQueue.",

    directives [
        {"if": "the support executive’s skills match the ticket subject or keywords", 
         "then": "assign the ticket to that executive"},
        {"if": "no matching executive is found", 
         "then": "add the ticket to the EscalationQueue for manual review"}
    ],

    scenarios [
        {"user": "Ticket Id: '714a164e-1ebb-4ca3-97c5-c7a0bccdf8f4', subject: Payment failure reported by customer. Executive email - 'joe@acme.com, executive skills - payments,transactions,billing", 
         "ai": "{assignTicketToExecutive {executiveEmail \"joe@acme.com\", ticketId \"714a164e-1ebb-4ca3-97c5-c7a0bccdf8f4\"}}"},
        {"user": "Ticket Id: '30c2f915-16d6-4300-84e0-1b9041bb69fd', subject: Security alert: SSL certificate expired, Executive email - 'mat@acme.com', executive skills - networking", 
         "ai": "{EscalationQueueEntry {ticketId \"30c2f915-16d6-4300-84e0-1b9041bb69fd\"}}"}
    ],

    glossary [
        {"name": "escalation", "meaning": "the process of forwarding unresolved tickets to higher-level support"},
        {"name": "assignment", "meaning": "linking a support ticket with a responsible executive"},
        {"name": "skills", "meaning": "areas of technical or domain expertise used to route tickets"}
    ],

    tools [support.core/ExecutiveTicketAssignment, support.core/EscalationQueueEntry]
}
```

---

## Flow: The Ticket Manager

This is the orchestrator of the system.
It brings together decisions, workflows, and agents to fully automate the ticket lifecycle.

```agentlang
flow ticketManager {
    classifyTicket --> "high" makeTicketHighPriority
    classifyTicket --> "medium" makeTicketMediumPriority
    classifyTicket --> "low" findSupportExecutive
    makeTicketHighPriority --> findSupportExecutive
    makeTicketMediumPriority --> findSupportExecutive
    findSupportExecutive --> ticketAssignment
}
```

The `ticketManager` agent runs this flow automatically whenever a new ticket is created.

---

## Trigger: Automatic Processing

The `Ticket` entity defines an `@after` hook that triggers the `afterCreateTicket` workflow upon creation.

```agentlang
workflow afterCreateTicket {
    { ticketManager { message this } }
}
```

This means that as soon as a ticket is posted via the REST API, the full AI-driven classification and assignment process begins instantly.

---

## Try It Out

Start the Agentlang runtime:

```bash
$ node ./bin/cli.js run example/customer_support_system
```

Then create some sample data:

```bash
# Add executives
curl -X POST http://localhost:8080/support.core/SupportExecutive \
  -H 'Content-Type: application/json' \
  -d '{"email": "exec01@edgy.com", "name": "Carol", "skills": ["IT", "networking", "internet"]}'

curl -X POST http://localhost:8080/support.core/SupportExecutive \
  -H 'Content-Type: application/json' \
  -d '{"email": "exec02@edgy.com", "name": "Kory", "skills": ["payments", "finance", "billing"]}'

# Add a customer
curl -X POST http://localhost:8080/support.core/Customer \
  -H 'Content-Type: application/json' \
  -d '{"email": "cust01@acme.com", "name": "Joseph"}'
```

Now create a few tickets and watch the agent network in action:

```bash
# High priority - assigned
curl -X POST http://localhost:8080/support.core/Customer/cust01@acme.com/CustomerTicket/Ticket \
  -H 'Content-Type: application/json' \
  -d '{"subject": "Unable to connect to internet, need urgent help", "description": "connection times-out"}'

# Medium priority - assigned
curl -X POST http://localhost:8080/support.core/Customer/cust01@acme.com/CustomerTicket/Ticket \
  -H 'Content-Type: application/json' \
  -d '{"subject": "Need help with payments", "description": "No payment update email received"}'

# Cannot assign - escalated for human intervention
curl -X POST http://localhost:8080/support.core/Customer/cust01@acme.com/CustomerTicket/Ticket \
  -H 'Content-Type: application/json' \
  -d '{"subject": "Unable to select channel", "description": "need help"}'
```

---

## Summary

This example highlights how **Agentlang** unifies **declarative data modeling**, **workflow orchestration**, and **LLM-guided reasoning** into a single language.

It’s a compact, real-world demonstration of:

* **Graph-based entity modeling**
* **Intelligent agents** guided by **directives** and **scenarios**
* **Decision-driven flows**
* **Event-triggered automation**

Together, they form an intelligent customer support system that can:

* Classify tickets automatically
* Adjust priorities
* Assign them intelligently
* Escalate when necessary

All without writing a single `if` statement.

---
