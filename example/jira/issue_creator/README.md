# Slack → Jira Issue Automation

This project demonstrates how **resolvers** can be used to integrate external systems and orchestrate real-world automation flows.
In this example:

* A **Slack resolver** polls messages from a Slack channel
* Incoming user messages are **classified** as Bug, Task, or Other
* An AI agent generates structured issue data
* A **Jira resolver** creates an issue in a Jira project
* A Slack message is sent back to the user confirming ticket details

This serves as a complete reference for building multi-agent, multi-resolver integrations with Agentlang.

---

## Features

* Automatically detect and classify Slack messages
* AI-generated description, summary, and issue type
* Create Jira issues using the Jira resolver
* Send confirmation messages back to Slack
* Avoid duplicate processing using a tracking entity
* Declarative agent orchestration via Agentlang flows

---

## Project Structure

### Entities & Records

* **Issue** – Structured issue details
* **ProcessedMessage** – Tracks which Slack messages have already been handled

### Agents

* `analyseUserMessage` – Transforms user text → structured issue
* `issueCreator` – Creates issues in Jira
* `replyToUser` – Sends Slack confirmation messages
* `issueManager` – Main orchestrator

### Workflows

* `createIssue` – Calls Jira resolver
* `notifyUser` – Publishes a Slack message
* `invokeIssueManager` – Entry point for Slack-triggered flows

### Decision Node

* `classifyMessage` – Routes messages as Bug, Task, or Other

---

## System Flow

```
Slack message → classifyMessage → analyseUserMessage → issueCreator → replyToUser → Slack
```

1. **Slack poller** generates a `slack/Message` event.
2. Only user-originated messages (`userMessage = true`) are considered.
3. The system skips already-processed messages (via `ProcessedMessage`).
4. The `issueManager` agent classifies the message:

   * Bug → Analyse
   * Task → Analyse
   * Other → Ignored
5. `analyseUserMessage` creates a detailed Issue record (markdown supported).
6. The Jira resolver creates an issue from this record.
7. The system sends a confirmation back to Slack.

---

## Example Slack Message

```
loading more than 10 employee records causes the UI to freeze
```

The agents may classify this as a Bug and generate:

* **Summary:** UI freezes when loading >10 employee records
* **Description:** Auto-generated in markdown (problem statement, reproduction steps, etc.)
* **Type:** bug

A Jira ticket is then created using this data.

---

## Required Environment Variables

Set the following before running the project:

```
OPENAI_API_KEY

SLACK_CHANNEL_ID
SLACK_API_KEY
SLACK_POLL_INTERVAL_MINUTES

JIRA_CLOUD_ID
JIRA_BASE_URL
JIRA_EMAIL
JIRA_API_TOKEN
JIRA_PROJECT
```

These variables are required by the OpenAI, Slack, and Jira resolvers.

---

##  Running the Example

1. Start the service:

   ```bash
   agent run

   # or

   node ../../../bin/cli.js run .
   ```
2. Post a few messages in the configured Slack channel.
3. When the Slack poller runs, issues will automatically appear in your Jira project.
