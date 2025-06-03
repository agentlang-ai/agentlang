#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-net --allow-env

// Use a specific version to avoid uncached URL issue
import { parse } from "https://deno.land/std@0.197.0/flags/mod.ts";

// Parse command line arguments
const args = parse(Deno.args, {
  string: ["app"],
  default: { app: "example/blog/app.json" },
});

// Simple prompt function for Deno
async function prompt(message: string): Promise<string> {
  const buf = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(message));
  const n = await Deno.stdin.read(buf);
  if (n === null) return '';
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

async function runCommand(cmd: string, args: string[], cwd: string = Deno.cwd()): Promise<{ success: boolean; output: string }> {
  console.log(`Running: ${cmd} ${args.join(' ')}`);
  
  const command = new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  
  const { code, stdout, stderr } = await command.output();
  const output = new TextDecoder().decode(code === 0 ? stdout : stderr);
  
  return {
    success: code === 0,
    output,
  };
}

async function prepareEnvironment(): Promise<boolean> {
  console.log("Preparing environment...");
  
  // Run langium:generate
  const langiumResult = await runCommand("npm", ["run", "langium:generate"]);
  if (!langiumResult.success) {
    console.error("Failed to generate Langium parser:", langiumResult.output);
    return false;
  }
  console.log("Langium parser generated successfully.");
  
  // Run build
  const buildResult = await runCommand("npm", ["run", "build"]);
  if (!buildResult.success) {
    console.error("Failed to build project:", buildResult.output);
    return false;
  }
  console.log("Project built successfully.");
  
  return true;
}

// Define an interface for the app structure
interface AgentLangApp {
  name: string;
  version: string;
  [key: string]: unknown;
}

async function loadApp(appPath: string): Promise<AgentLangApp | null> {
  console.log(`Loading app from ${appPath}...`);
  
  try {
    // Check if the file exists
    await Deno.stat(appPath);
  } catch (error) {
    console.error(`Error: App file not found at ${appPath}`);
    return null;
  }
  
  try {
    // Run the CLI command to load the app
    const runResult = await runCommand("node", ["./bin/cli.js", "run", appPath]);
    if (!runResult.success) {
      console.error("Failed to load app:", runResult.output);
      return null;
    }
    
    console.log("App loaded successfully.");
    console.log(runResult.output);
    
    // Try to parse the app JSON file
    const appContent = await Deno.readTextFile(appPath);
    return JSON.parse(appContent);
  } catch (error: unknown) {
    console.error('Error loading app:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// Dynamically import the language server module
async function startRepl(app: AgentLangApp): Promise<void> {
  console.log('Starting AgentLang REPL with loaded app...');
  console.log(`App: ${app.name} v${app.version}`);
  console.log('Type :q to quit, :help for commands');

  try {
    const modulePath = new URL('../out/language/agentlang-module.js', import.meta.url);
    const { createAgentlangServices } = await import(modulePath.href);
    
    // Create language services without LSP connection
    const services = createAgentlangServices({});
    
    // Additional commands for the REPL
    const commands: Record<string, (args: string) => Promise<void>> = {
      ':help': async (): Promise<void> => {
        await Promise.resolve(); // Adding await to satisfy linter
        console.log('Available commands:');
        console.log('  :q, :quit - Exit the REPL');
        console.log('  :help - Show this help message');
        console.log('  :app - Show current app info');
        console.log('  :load <path> - Load a different app');
      },
      ':app': async (): Promise<void> => {
        await Promise.resolve(); // Adding await to satisfy linter
        console.log('Current app:', JSON.stringify(app, null, 2));
      },
      ':load': async (path): Promise<void> => {
        const newAppPath = path.trim();
        if (!newAppPath) {
          console.log('Usage: :load <app-path>');
          return;
        }
        const newApp = await loadApp(newAppPath);
        if (newApp) {
          // Need to cast since TypeScript doesn't track that app can be reassigned here
          Object.assign(app, newApp);
          console.log(`Loaded app: ${app.name} v${app.version}`);
        }
      }
    };

    // Main REPL loop
    while (true) {
      const input = await prompt('> ');
      
      // Handle commands
      if (input.startsWith(':')) {
        const [cmd, ...args] = input.split(' ');
        const handler = commands[cmd];
        
        if (cmd === ':q' || cmd === ':quit') {
          console.log('Goodbye!');
          Deno.exit(0);
        } else if (handler) {
          await handler(args.join(' '));
          continue;
        } else if (cmd !== ':') {
          console.log(`Unknown command: ${cmd}`);
          console.log('Type :help for available commands');
          continue;
        }
      }
      
      // Skip empty input
      if (!input.trim()) continue;
      
      try {
        // Create a document from the input
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
          input,
          'inmemory://input.agent'
        );
        
        // Validate the document
        await services.Agentlang.validation.AgentlangValidator.validateDocument(doc);
        
        // Get diagnostics
        const diagnostics = doc.diagnostics || [];
        
        if (diagnostics.length > 0) {
          console.log('Errors:');
          for (const diagnostic of diagnostics) {
            console.log(`  - ${diagnostic.message}`);
          }
        } else {
          console.log('Valid AgentLang code!');
          console.log('AST:', JSON.stringify(doc.parseResult.value, null, 2));
          
          // Here you could add code to execute the input in the context of the loaded app
        }
      } catch (error: unknown) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error: unknown) {
    console.error('Failed to start REPL:', error instanceof Error ? error.message : String(error));
  }
}

// Main function
async function main() {
  // Prepare the environment
  const prepared = await prepareEnvironment();
  if (!prepared) {
    console.error("Failed to prepare environment. Exiting.");
    Deno.exit(1);
  }
  
  // Load the app
  const appPath = args.app;
  const app = await loadApp(appPath);
  
  if (!app) {
    console.error(`Failed to load app from ${appPath}. Exiting.`);
    Deno.exit(1);
  }
  
  // Start the REPL
  await startRepl(app);
}

// Run the main function
main().catch((error: unknown) => {
  console.error("Unhandled error:", error instanceof Error ? error.message : String(error));
  Deno.exit(1);
});
