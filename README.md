<div align="center">

# AgentLang - Reliable Enterprise AI Agents

## Build AI Agents that actually work!

|         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI/CD   | [![AgentLang CI](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml) [![Integration Tests](https://github.com/agentlang-ai/agentlang/actions/workflows/integration.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/integration.yml) [![Tests](https://img.shields.io/badge/tests-vitest-green)](https://vitest.dev/) [![Linting](https://img.shields.io/badge/linting-ESLint-4B32C3)](https://eslint.org/) [![Code Style](https://img.shields.io/badge/code%20style-prettier-ff69b4)](https://prettier.io/)                                                                              |
| Docs    | [![Documentation](https://img.shields.io/badge/docs-available-brightgreen)](https://github.com/agentlang-ai/agentlang#readme) [![Language Spec](https://img.shields.io/badge/language-spec-blue)](https://github.com/agentlang-ai/agentlang/blob/main/langium-quickstart.md) [![Examples](https://img.shields.io/badge/examples-available-yellow)](https://github.com/agentlang-ai/agentlang/tree/main/example)                                                                                                                                                                                                                                                                                                     |
| Package | [![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?logo=node.js)](https://nodejs.org) [![pnpm](https://img.shields.io/badge/pnpm-10.13.1-blue?logo=pnpm)](https://pnpm.io) [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/) [![Langium](https://img.shields.io/badge/Langium-DSL-orange)](https://langium.org/) [![License](https://img.shields.io/badge/License-Sustainable%20Use%20v1.0-blue.svg)](LICENSE) [![npm version](https://badge.fury.io/js/agentlang.svg)](https://www.npmjs.com/package/agentlang) [![npm downloads](https://img.shields.io/npm/dm/agentlang.svg)](https://www.npmjs.com/package/agentlang) |
| Runtime | [![Runtime](https://img.shields.io/badge/runtime-Node.js-green?logo=node.js)](https://nodejs.org) [![Database Support](https://img.shields.io/badge/database-multiple-blueviolet)](https://github.com/agentlang-ai/agentlang#runtime-support) [![Vector DB](https://img.shields.io/badge/vector%20db-supported-purple)](https://github.com/agentlang-ai/agentlang#runtime-support) [![Auth](https://img.shields.io/badge/auth-Cognito-orange?logo=amazon-aws)](https://aws.amazon.com/cognito/)                                                                                                                                                                                                                     |
| Meta    | [![GitHub Stars](https://img.shields.io/github/stars/agentlang-ai/agentlang?style=social)](https://github.com/agentlang-ai/agentlang) [![GitHub Issues](https://img.shields.io/github/issues/agentlang-ai/agentlang)](https://github.com/agentlang-ai/agentlang/issues) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/agentlang-ai/agentlang/pulls) [![Contributors](https://img.shields.io/github/contributors/agentlang-ai/agentlang)](https://github.com/agentlang-ai/agentlang/graphs/contributors)                                                                                                                                                             |

</div>

AgentLang is the **easiest way** to build the **most reliable** AI agents. Build **teams of AI Agents** that really grok your requirements and follow your organization's processes closely, while adapting to new scenarios. Agents collaborate with each other and humans to handle complex, time-consuming, monotonous tasks and get work done!

<div align="center">

### **Open | Enterprise-grade | Production-ready**

</div>

AgentLang is also the industry's first "no-code programming language" for building anything involving agents - Fractl Studio (coming soon!) allows your to build and manage agents visually with no code, while the language enables the developer in you to build the same in your favorite IDE.

The AgentLang language specification, its compiler and runtime are open source. AgentLang programs can run anywhere - **avoiding the vendor lock-in** of other AI agent/programming platforms.

AgentLang runtime has native integration with multitude of databases, vector databases, auth stores, etc. AgentLang programs run on nodeJS and can make use of any of the thousands of existing Node and other JavaScript libraries out there.

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

### Installation

#### ⚡ Use npm or pnpm

```shell
npm install

OR

# Install pnpm: https://pnpm.io/installation
pnpm install
```
**Note**: If pnpm shows build script warnings, run `pnpm approve-builds` and approve esbuild and sqlite3.

### Build

```shell
# Generate parser and build
npm run langium:generate
npm run build
```

### Test

```shell
# Run all tests
npm test

# Run tests with verbose output
npm run test:verbose
```

## CLI Usage

```shell
# Parse and validate an AgentLang file
node ./bin/cli.js parseAndValidate example/blog/blog.al

# Run a specific app
node ./bin/cli.js run example/blog
```

## Development

### Code Quality

```shell
# Lint code
npm run lint

# Lint and auto-fix issues
npm run lint:fix

# Format code
npm run format

# Check formatting without changes
npm run format:check
```

### Watch Mode

```shell
# Watch for changes and rebuild
npm run watch
```
