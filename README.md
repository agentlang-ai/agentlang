<div align="center">

# AgentLang Programming Language

AgentLang is the **easiest way** to build AI Agents, Chatbots and Apps - build **teams of AI agents** that collaborate (with other AI agents and humans) to handle complex, time-consuming, monotonous tasks. AgentLang is a data-oriented, declarative abstraction for building agents and apps, similar to how Terraform is a declarative abstraction for infrastructure-as-code.

[![AgentLang CI](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml)
[![Lint and Format Check](https://github.com/agentlang-ai/agentlang/actions/workflows/lint.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/lint.yml)

### **Open | Enterprise-grade | Production-ready**

The AgentLang language specification, its compiler and runtime are open source. AgentLang programs can run anywhere - **avoiding the vendor lock-in** of other AI agent/programming platforms.

AgentLang runtime has native integration with databases, vector databases, auth stores, etc. AgentLang programs run on the JVM and can make use of any of the thousands of existing Node and other JavaScript libraries out there.

AgentLang comes with all the modern tooling and dependency management needed to build production-grade agents and apps.

</div>

## First-class AI Agents

Agents are a built-in language construct - developers can choose from one of the built-in agent-types, or easily add their own agent-types.

## Runtime Support

AgentLang runs on Node.js for development and execution.

### Prerequisites

- Node.js 20+ (CI runs on 20.x, local development often uses 24.x)
  - Note: Some functions may behave differently between versions (e.g., array methods on iterators)

## Quick Start

```shell
# Install dependencies (recommended - 90% faster)
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
