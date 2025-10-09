<div align="center">

# AgentLang - Reliable Enterprise AI Agents
Build AI Agents that actually work with Agentic Reliability Modeling

### **Open | Enterprise-grade | Production-ready**

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| CI/CD       | [![AgentLang CI](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml) |
| Quick Start | [![Documentation](https://img.shields.io/badge/docs-available-brightgreen)](https://github.com/agentlang-ai/agentlang#readme) [![Examples](https://img.shields.io/badge/examples-available-yellow)](https://github.com/agentlang-ai/agentlang/tree/main/example) |
| Environment | [![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?logo=node.js)](https://nodejs.org) [![pnpm](https://img.shields.io/badge/pnpm-10.13.1-blue?logo=pnpm)](https://pnpm.io) |
| Meta        | [![GitHub Stars](https://img.shields.io/github/stars/agentlang-ai/agentlang?style=social)](https://github.com/agentlang-ai/agentlang) ![License](https://img.shields.io/badge/License-Sustainable%20Use%20v1.0-blue.svg) [![npm downloads](https://img.shields.io/npm/dm/agentlang.svg)](https://www.npmjs.com/package/agentlang) |

</div>

Build **teams of reliable AI Agents** that follow your organization's processes closely, while adapting to new scenarios, with AgentLang. Agents collaborate with each other and humans to handle complex, time-consuming, monotonous tasks and get work done!

* **Agentic:** AgentLang is a programming language specifically designed for building anything involving agents. AgentLang is highly declarative - allowing you to focus on the business logic of your solution.

* **Ecosystem:** AgentLang runtime has native integration with multitude of LLMs, databases, vector databases, auth providers, etc. AgentLang has a novel connector architecture, with prebuilt connectors for many Enterprise tools. In addition, AgentLang programs run on nodeJS (and, soon, in the browser!) and can make use of any existing JavaScript library.

* **Production-grade**: AgentLang is built on top of TypeScript and uses all the modern JS/TS tooling needed to build production-grade agents and apps.

</div>

Coming soon! Fractl Studio is a no-code environment for building and operating AI Agents.

## First-class AI Agents

Agents and many concepts agents use are built-in language constructs.

```
// flows are business process definitions that "guide" (not enforce) the agent's behavior
flow triageFlow {
    ticketTriager --> "DNS" ticketInProgress
    ticketTriager --> "WLAN" ticketInProgress
    ticketTriager --> "NotEnoughInfo" ticketPending
}

agent ticketflow {
    llm "ticketflow_llm",
    role "You are a ticket management application. Your job is to triage any ticket passed to you and update the ticket with appropriate assigned_to, status and triaging comments.",
    flows [triageFlow]
}

```

## Agentic Reliability Modeling

Depending only on instructions to let the agent is a recipe for failure.

### Flows

```
```

### Decisions

```
```

### Directives

```
```

### Scenarios

```
```

### Glossary

```

```

## AgentLang Ontology

Model the data model, workflows and access control constructs of your application in AgentLang
```

```

## Quick Start

```shell
# Install dependencies with pnpm (recommended over npm - 90% faster)
# Get pnpm: https://pnpm.io/installation
pnpm install

# Or use npm
npm install

# Generate parser and build
npm run langium:generate
npm run build

# Run test
npm test
```

> **Note**: If pnpm shows build script warnings, run `pnpm approve-builds` and approve esbuild and sqlite3.

## CLI Usage

```shell
# Parse and validate an AgentLang file
node ./bin/cli.js parseAndValidate example/blog/blog.al

# Run a specific app
node ./bin/cli.js run example/blog
```

## Development

```shell
# Linting and formatting
npm run lint
npm run lint -- --fix
npm run format
```
