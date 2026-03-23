# Using a Locally Built Runtime with the Global `agent` Command

The global `agent` command is provided by the `@agentlang/cli` package, which depends on
`agentlang` (the runtime) as an npm dependency. To make it use your locally built runtime
instead of the published version, use one of the approaches below.

## Option 1: `npm link` (recommended)

```bash
# In your local agentlang runtime directory
cd /home/vijay/Projects/agentlang
npm run build
npm link

# Then in the globally installed CLI, link to your local runtime
cd /home/vijay/.nvm/versions/node/v24.13.0/lib/node_modules/@agentlang/cli
npm link agentlang
```

This creates a symlink so the CLI's `node_modules/agentlang` points to your local build.
Any time you rebuild locally (`npm run build`), the `agent` command picks up the changes
immediately.

## Option 2: Direct symlink

```bash
rm -rf /home/vijay/.nvm/versions/node/v24.13.0/lib/node_modules/@agentlang/cli/node_modules/agentlang
ln -s /home/vijay/Projects/agentlang \
  /home/vijay/.nvm/versions/node/v24.13.0/lib/node_modules/@agentlang/cli/node_modules/agentlang
```

## Reverting

To go back to the published runtime version:

```bash
cd /home/vijay/.nvm/versions/node/v24.13.0/lib/node_modules/@agentlang/cli
npm unlink agentlang
npm install agentlang
```
