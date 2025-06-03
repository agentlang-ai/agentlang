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

## Deno Support

AgentLang provides first-class support for [Deno](https://deno.land/), a modern JavaScript/TypeScript runtime. You can use Deno for building and running the AgentLang language server and REPL.

### Prerequisites

- [Deno](https://deno.land/) 1.35.0 or later
- Node.js 20+ (for some build steps)

### Available Deno Commands

#### Build with Deno

Build the project using Deno:

```bash
# Build the project
deno run -A scripts/build.ts

# Or using the npm script
npm run build:deno

# Watch for changes and rebuild
deno run --watch -A scripts/build.ts

# Or using the npm script
npm run watch:deno
```

#### Linting and Formatting

Lint and format your code with Deno:

```bash
# Lint the code
deno lint scripts/

# Or using the npm script
npm run lint:deno

# Format the code
deno fmt scripts/

# Or using the npm script
npm run format:deno
```

#### Testing

Run tests with Deno:

```bash
# Run tests
deno test -A scripts/

# Or using the npm script
npm run test:deno
```

### Development Workflow

For a smooth development experience, you can use the following workflow:

1. Start the watcher in one terminal:
   ```bash
   npm run watch:deno
   ```

2. In another terminal, run tests:
   ```bash
   npm run test:deno -- --watch
   ```

## Build instructions

Make sure you have a working Node environment with version 22 or higher.

Install dependencies:

```shell
npm install
```

Generate the Agentlang parser and build the project:

```shell
npm run langium:generate
npm run build
npm test
```

Test with a sample .al file:

```shell
node ./bin/cli.js parseAndValidate example/blog/blog.al
node ./bin/cli.js run example/blog/app.json
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