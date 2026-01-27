# Dynamic Agent Training & Correction in Agentlang

Agentlang supports **incremental, production-safe training of agents at runtime**. This allows agents to start with minimal instructions, perform useful work immediately, and **continuually improve through targeted corrections**—without redeploying code or retraining the base LLM.

This README explains how **agent correction** works using a real-world example: an email qualification agent.

---

## Overview

In many real systems, it is not feasible to encode every business rule upfront. Agentlang is designed so that:

* Agents can start with **simple, high-level instructions**
* Misclassifications can be **corrected after deployment**
* Corrections are **persistent and cumulative**
* Training happens via **explicit, auditable API calls**
* No model fine-tuning or code changes are required

This approach combines the flexibility of LLMs with the reliability of rule-based systems.

---

## Example: Email Qualification Agent

### Agent Model

```agentlang
module sdr.core

record InboundEmailPayload {
    sender String,
    recipients String,
    subject String,
    body String,
    date String,
    threadId String,
    gmailOwnerEmail String,
    hubspotOwnerId String
}

record EmailQualificationResult {
    needsProcessing Boolean,
    reason String,
    category String @enum(
        "business",
        "meeting",
        "sales",
        "automated",
        "newsletter",
        "spam",
        "unknown"
    ) @optional,
    sender String,
    recipients String,
    subject String,
    body String,
    date String,
    threadId String,
    gmailOwnerEmail String,
    hubspotOwnerId String
}

@public agent EmailQualificationAgent {
    llm "sonnet_llm",
    role "You are an intelligent email qualification agent who determines if an email requires sales engagement processing.",
    tools [sdr.core/InboundEmailPayload],
    instruction "You receive an InboundEmailPayload instance as input. Your job is to determine if this email needs sales processing.",
    retry classifyRetry,
    responseSchema sdr.core/EmailQualificationResult
}
```

This agent starts with **minimal domain knowledge** and relies on the LLM’s general reasoning ability.

---

## Initial Behavior

### Sales Inquiry (Correct)

**Request**

```bash
curl -X POST http://localhost:8080/sdr.core/EmailQualificationAgent \
  -H 'Content-Type: application/json' \
  -d '{"message": {
    "sender": "sam@abc.com",
    "recipients": "contact@acme.com",
    "subject": "price query",
    "body": "Please let me know the price for your enterprise plan.",
    "date": "01-Feb-2026",
    "threadId": "123",
    "gmailOwnerEmail": "admin@acme.com",
    "hubspotOwnerId": "ee223233"
  }}'
```

**Result**

```json
{
  "needsProcessing": true,
  "reason": "Email contains a price inquiry about the enterprise plan, which is a sales-related query requiring engagement",
  "category": "sales",
  ...
}
```

---

## Problem: Misclassification

### Meeting Request (Incorrect)

**Request**

```bash
curl -X POST http://localhost:8080/sdr.core/EmailQualificationAgent \
  -H 'Content-Type: application/json' \
  -d '{"message": {
    "sender": "sam@abc.com",
    "recipients": "contact@acme.com",
    "subject": "price query",
    "body": "I would like to see a product walkthrough.",
    "date": "01-Feb-2026",
    "threadId": "123",
    "gmailOwnerEmail": "admin@acme.com",
    "hubspotOwnerId": "ee223233"
  }}'
```

**Observed behavior**

The agent incorrectly classifies this as `sales`, even though it is clearly a **meeting request**.

This is expected for an agent that started with minimal instructions.

---

## Dynamic Agent Training (Correction)

Agentlang allows you to **correct the agent after observing errors**, by providing **targeted domain instructions**.

### Training the Agent

```bash
curl -X POST http://localhost:8080/agentlang.ai/agentCorrection \
  -H 'Content-Type: application/json' \
  -d '{
    "agentName": "EmailQualificationAgent",
    "agentModuleName": "sdr.core",
    "instruction": "If the email contains the keywords: schedule, meet, demo, call, calendar, available, time, appointment then set category to '\''meeting'\''.
Examples of such emails:
  - Can we schedule a demo next week?
  - Are you available for a quick call?
  - Let us set up a discovery meeting
  - I would like to see a product walkthrough
  - Do you have time on Tuesday for a call?"
  }'
```

### What This Does

* Adds **persistent correction rules** to the agent
* Improves future classifications
* Does not affect unrelated behavior
* Does not require restarting the agent or server

The **persistent correction rules** are internally represented as agent-specific *directives*, *scenarios* and *glossary-entries*.
---

## Improved Behavior

After correction, the same request:

```json
"I would like to see a product walkthrough."
```

will now be correctly classified as:

```json
{
  "needsProcessing": true,
  "category": "meeting",
  "reason": "Email requests a product walkthrough, indicating a meeting or demo request",
  ...
}
```

---

## Key Concepts

### 1. Start Simple

Agents can be deployed with:

* Minimal instructions
* Broad intent
* General reasoning

### 2. Observe Real Usage

Misclassifications are expected and useful—they reveal missing domain knowledge.

### 3. Correct, Don’t Rewrite

Corrections:

* Are additive
* Are explicit
* Do not require code changes
* Do not retrain the underlying LLM

### 4. Continuous Learning

Over time, an agent accumulates:

* Business rules
* Edge-case handling
* Organization-specific knowledge

This produces behavior similar to a fine-tuned model—but with **full transparency and control**.

---

## Why This Matters

Traditional approaches require:

* Hard-coded rules upfront **or**
* Costly model fine-tuning cycles

Agentlang enables:

* **Live learning**
* **Fast iteration**
* **Production-safe corrections**
* **Human-in-the-loop refinement**

This makes Agentlang well-suited for:

* Sales & support automation
* Internal tools
* Evolving business workflows
* Long-lived agents in production

---

## Summary

Agentlang agents:

* Start working immediately
* Improve through corrections
* Learn continuously
* Remain auditable and controllable

Dynamic agent training allows you to **treat agents as living systems** that evolve alongside your business—without sacrificing reliability or clarity.