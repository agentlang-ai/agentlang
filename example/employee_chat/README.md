# Planner with Chat Mode

This example demonstrates how **Agentlang** enables seamless switching between **planner** and **chat** modes while maintaining independent **chat sessions** with shared application context. It shows how an agent can act both as a structured data manager and as a conversational assistant — without losing state or context.

---

## Overview

The module defines a simple employee management app, where an agent can both create and query employee records. It highlights:

* **Planner mode:** Executes structured data operations (like creating or querying employees).
* **Chat mode:** Enables natural, conversational interaction using the data managed by the planner.
* **Chat history:** Maintains independent histories per session (`chatId`), allowing multiple conversations to run concurrently.

---

## Model Definition

```agentlang
module employee.chat

entity Employee {
    id UUID @id @default(uuid()),
    name String,
    salary Decimal @indexed
}

@public agent employeeManager {
    instruction "You manage employee records creation and queries",
    tools [employee.chat/Employee]
}
```

### Entity: `Employee`

Represents an employee record with:

* `id` — unique identifier (auto-generated)
* `name` — employee name
* `salary` — salary amount (indexed for efficient lookup)

### Agent: `employeeManager`

Acts as both:

* A **planner**, executing precise CRUD operations using the `Employee` entity.
* A **chat companion**, answering questions conversationally about the current employee data.

---

## Example Usage

### Chat Session 1

In this session, the user alternates between planner and chat modes while maintaining the same `chatId`.

```shell
# Run the app
node ./bin/cli.js run example/employee_chat

# Create employees in planner mode
curl -X POST http://localhost:8080/employee.chat/employeeManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "create an employee name Jacob with salary 2500", "chatId": "1", "mode": "planner"}'

curl -X POST http://localhost:8080/employee.chat/employeeManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "create an employee name Matthew with salary 1000", "chatId": "1", "mode": "planner"}'

# Switch to chat mode
curl -X POST http://localhost:8080/employee.chat/employeeManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "what is the total salary of employees created so far?", "chatId": "1", "mode": "chat"}'
```

**Sample response for the last request:**

```
"The total salary of the employees created so far, Jacob and Matthew, is 2500 + 1000 = 3500."
```

---

### Chat Session 2

A new session (`chatId = 2`) starts with its own conversational context.

```shell
# Create an employee in planner mode
curl -X POST http://localhost:8080/employee.chat/employeeManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "create an employee name Joe with salary 2500", "chatId": "2", "mode": "planner"}'

# Switch to chat mode
curl -X POST http://localhost:8080/employee.chat/employeeManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "what is the total salary of employees created so far?", "chatId": "2", "mode": "chat"}'
```

**Example response for the last request:**

```
"The total salary of the employees created so far is 2500."
```

---

### Switching Back to Planner Mode

Even though each chat session maintains its own conversational history, all sessions share the same application data.
Switching back to planner mode allows structured queries across the complete dataset:

```shell
curl -X POST http://localhost:8080/employee.chat/employeeManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "query all employees", "chatId": "2", "mode": "planner"}'
```

**Response:**
A list of all employees created in both sessions (`Jacob`, `Matthew`, and `Joe`).

---

## Key Takeaways

* **Dual-mode interaction:** Agents can operate both as planners (structured logic) and chatbots (conversational logic).
* **Context persistence:** Each chat session preserves its own conversational history through `chatId`.
* **Unified data context:** All planner and chat sessions share a common underlying datastore.

This pattern is ideal for **multi-session assistants** that combine transactional precision with conversational flexibility — such as HR assistants, finance bots, or customer support agents.
