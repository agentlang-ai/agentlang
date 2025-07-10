<div align="center">

# AgentLang Programming Language

AgentLang is the **easiest way** to build AI Agents, Chatbots and Apps - build **teams of AI agents** that collaborate (with other AI agents and humans) to handle complex, time-consuming, monotonous tasks. AgentLang is a data-oriented, declarative abstraction for building agents and apps, similar to how Terraform is a declarative abstraction for infrastructure-as-code.

[![AgentLang CI](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/ci.yml)
[![Lint and Format Check](https://github.com/agentlang-ai/agentlang/actions/workflows/lint.yml/badge.svg)](https://github.com/agentlang-ai/agentlang/actions/workflows/lint.yml)

### **Open | Enterprise-grade | Production-ready**

The AgentLang language specification, its compiler and runtime are open source. AgentLang programs can run anywhere - **avoiding the vendor lock-in** of other AI agent/programming platforms.

AgentLang runtime has native integration with databases, vector databases, auth stores, etc. AgentLang programs run on the JVM and can make use of any of the thousands of existing Node and other JavaScript libraries out there.

AgentLang comes with all the modern tooling, dependency management and REPL needed to build production-grade agents and apps.

</div>

## First-class AI Agents

Agents are a built-in language construct - developers can choose from one of the built-in agent-types, or easily add their own agent-types.

## Runtime Support

AgentLang supports both Node.js and Deno runtimes for development and execution.

### Prerequisites

- Node.js 20+ (CI runs on 20.x, local development often uses 24.x)
  - Note: Some functions may behave differently between versions (e.g., array methods on iterators)
- [Deno](https://deno.land/) 1.35.0 or later (optional, for Deno-based workflows)

## Common Development Commands

AgentLang provides npm scripts for common tasks. Here are the most frequently used commands:

```shell
# Install dependencies (90% faster with pnpm)
pnpm install --prefer-offline
# If prompted about build scripts, approve esbuild and sqlite3
# or use npm (slower)
npm install

# Build the project
npm run build

# Generate Agentlang parser
npm run langium:generate

# Run tests
npm test

# Interactive REPL with specific app.json
npm run repl -- --app example/erp/app.json
# To exit REPL: use close() or Ctrl+C or Ctrl+D, then press Ctrl+C again to fully exit

# Run TypeScript files with specific app.json
npm run run -- --app example/blog/app.json path/to/file.ts

# Development server
npm run dev
```

## Using Deno

When working with Deno, use these npm scripts:

```shell
# Build with Deno
npm run build:deno

# Watch mode with Deno
npm run watch:deno

# Run tests with Deno
npm run test:deno
```

## Build instructions

Make sure you have a working Node environment with version 20 or higher (CI runs on 20.x, while local development often uses 24.x).

Install dependencies:

```shell
# Recommended: Use pnpm for 90% faster installation
pnpm install --prefer-offline

# Alternative: Use npm (slower)
npm install
```

> **Performance Tip**: This project has many dependencies including native modules. Using `pnpm` instead of `npm` reduces installation time from ~17 minutes to ~40 seconds. Install pnpm with: `npm install -g pnpm`

### Build Script Approval

When using pnpm for the first time, you may see a warning about build scripts:

```
╭ Warning ─────────────────────────────────────────────────────────────────────╮
│   Ignored build scripts: esbuild, sqlite3.                                   │
│   Run "pnpm approve-builds" to pick which dependencies should be allowed     │
│   to run scripts.                                                            │
╰──────────────────────────────────────────────────────────────────────────────╯
```

To resolve this, approve the build scripts for essential dependencies:

```shell
# Approve build scripts interactively
pnpm approve-builds
# Select both 'esbuild' and 'sqlite3' when prompted
```

**Why these packages need build scripts:**
- **esbuild**: JavaScript bundler that requires native compilation for optimal performance
- **sqlite3**: SQLite database driver with native bindings for database operations

The project is configured to automatically handle this in CI environments, but local development may require manual approval on first install.

Generate the Agentlang parser and build the project:

```shell
npm run langium:generate
npm run build
npm test
```

Test with sample app.json files:

```shell
# Parse and validate an AgentLang file
node ./bin/cli.js parseAndValidate example/blog/blog.al

# Run a specific app
node ./bin/cli.js run example/blog
```

## Linting and Code Style

AgentLang uses ESLint and Prettier to maintain code quality. Run the following commands to check and fix linting issues:

```shell
# Run ESLint
npm run lint

# Fix ESLint issues automatically
npm run lint -- --fix

# Format code with Prettier
npm run format
```

The project is currently in the process of adopting stricter TypeScript standards. The ESLint configuration currently allows the use of `any` types and certain deprecated type constructors, but these will be gradually phased out in future releases.