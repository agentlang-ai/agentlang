# AGENTS.md – Agentlang

## Build & Test
- **Install:** `npm install`
- **Build:** `npm run build` (tsc + esbuild)
- **Lint:** `npm run lint` / `npm run lint:fix`
- **Format:** `npm run format` (Prettier: single quotes, 2-space indent, 100 print width, trailing commas es5)
- **Test all:** `npm test` (vitest, runs sequentially due to SQLite locks)
- **Single test:** `npx vitest run test/runtime/basic.test.ts`
- **Verbose tests:** `VITEST_VERBOSE=true npm test`
- **Generate grammar:** `npm run langium:generate`

## Architecture
Langium-based DSL (`*.al` files) for building AI agent systems, doubling as a VS Code extension.
- `src/language/` — Grammar (`agentlang.langium`), parser, validator, generated AST types
- `src/runtime/` — Agent execution engine (TypeORM + SQLite/Postgres, LangChain LLM integration)
- `src/api/` — Express HTTP API layer
- `src/cli/` — Commander-based CLI (`agentlang-cli`)
- `src/extension/` — VS Code language client
- `src/utils/` — Shared utilities (logging via Winston)
- `test/` — Vitest tests mirroring `src/` structure (parsing, validating, runtime, api)

## Code Style
- TypeScript (strict mode, ES modules, `Node16` module resolution, target ES2017)
- Prefix unused params with `_`; `no-explicit-any` is off
- Use single quotes, semicolons, 2-space indentation, arrow parens only when needed
