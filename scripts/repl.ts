import { parseArgs } from '@std/cli/parse-args';
import { debounce } from '@std/async/debounce';

// Add a global exitRepl type to allow proper REPL termination
declare global {
  // eslint-disable-next-line no-var
  var exitRepl: (() => void) | null;
  // eslint-disable-next-line no-var
  var appSpec: { [key: string]: unknown };
}

// Initialize globals to avoid TypeScript errors
globalThis.exitRepl = null;
globalThis.appSpec = {};

// Define interfaces
interface CommandResult {
  success: boolean;
  output: string;
}

// Parse command line arguments
const args = parseArgs(Deno.args, {
  string: ['app', 'module'],
  boolean: ['watch', 'langium', 'help'],
  alias: {
    w: 'watch',
    l: 'langium',
    h: 'help',
    m: 'module',
  },
  default: {
    app: 'example/blog/app.json',
    watch: true,
    module: '',
  },
});

// Track current processes
let _cliProcess: Deno.ChildProcess | null = null;
let _replProcess: Deno.ChildProcess | null = null;
let _isRestarting = false;

// Helper function to run shell commands with output capture
async function runCommand(cmd: string, args: string[], cwd = Deno.cwd()): Promise<CommandResult> {
  console.log(`Running: ${cmd} ${args.join(' ')}`);

  const command = new Deno.Command(cmd, {
    args,
    stdout: 'piped',
    stderr: 'piped',
    cwd,
  });

  const { code, stdout, stderr } = await command.output();
  const output = new TextDecoder().decode(code === 0 ? stdout : stderr);

  return {
    success: code === 0,
    output,
  };
}

// Function to ensure output directory exists
async function ensureOutputDirExists(): Promise<boolean> {
  try {
    const outDir = new URL('../out', import.meta.url).pathname;
    const stat = await Deno.stat(outDir);
    if (!stat.isDirectory) {
      console.error(`Output directory ${outDir} exists but is not a directory`);
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error('Output directory not found. Please run these commands first:');
      console.error('npm run langium:generate');
      console.error('npm run build');
      return false;
    }
    console.error('Error checking output directory:', error);
    return false;
  }
}

// Generate language files
async function generateLanguage(): Promise<boolean> {
  console.log('Generating Langium files...');
  try {
    const result = await runCommand('npm', ['run', 'langium:generate']);
    if (result.success) {
      console.log('Langium files generated successfully.');
      return true;
    } else {
      console.error('Failed to generate Langium files:', result.output);
      return false;
    }
  } catch (error) {
    console.error(
      'Error generating Langium files:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

// Build the project
async function buildProject(): Promise<boolean> {
  console.log('Building project...');
  try {
    const result = await runCommand('npm', ['run', 'build']);
    if (result.success) {
      console.log('Build completed successfully.');
      return true;
    } else {
      console.error('Failed to build project:', result.output);
      return false;
    }
  } catch (error) {
    console.error(
      'Error building project:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

// Prepare environment by generating Langium files and building the project if needed
async function prepareEnvironment(): Promise<boolean> {
  // Check if output directory exists first
  const outputExists = await ensureOutputDirExists();
  if (!outputExists) {
    // Need to generate and build
    const langiumSuccess = await generateLanguage();
    if (!langiumSuccess) return false;

    return await buildProject();
  }

  if (args.langium) {
    const langiumSuccess = await generateLanguage();
    if (!langiumSuccess) return false;
  }

  return true;
}

// Function to start the CLI process
async function startCLIProcess(appFile: string): Promise<Deno.ChildProcess | null> {
  const cliPath = new URL('../bin/cli.js', import.meta.url).pathname;
  console.log(`Starting AgentLang CLI: node ${cliPath} run ${appFile}`);

  const cmd = new Deno.Command('node', {
    args: [cliPath, 'run', appFile],
    stdout: 'piped',
    stderr: 'piped',
    stdin: 'null', // Don't attach stdin
  });

  const process = cmd.spawn();
  _cliProcess = process;

  // Stream CLI output in the background
  (async () => {
    const decoder = new TextDecoder();
    if (process.stdout) {
      for await (const chunk of process.stdout) {
        console.log('[CLI]', decoder.decode(chunk).trim());
      }
    }
  })();

  (async () => {
    const decoder = new TextDecoder();
    if (process.stderr) {
      for await (const chunk of process.stderr) {
        console.error('[CLI Error]', decoder.decode(chunk).trim());
      }
    }
  })();

  // Wait a moment for the CLI to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));

  return process;
}

// Function to start Deno REPL with AgentLang context
async function startDenoRepl(appFile: string): Promise<Deno.ChildProcess | null> {
  console.log('Starting Deno REPL with AgentLang context...');

  // Get the absolute path for the app file
  const appPath = new URL(appFile, `file://${Deno.cwd()}/`).pathname;

  // Define paths to required modules
  const modulePath = new URL('../src/runtime/module.ts', import.meta.url).pathname;
  const loaderPath = new URL('../src/runtime/loader.ts', import.meta.url).pathname;

  // Create a temporary file with the initialization code
  const tempFile = await Deno.makeTempFile({ suffix: '.ts' });

  // Create initialization code with proper template literals
  const initCode = `
// Add shims for Node.js built-in modules
globalThis.require = (modulePath) => {
  if (modulePath === 'path' || modulePath === 'fs' || 
      modulePath === 'url' || modulePath === 'util' || 
      modulePath === 'os' || modulePath === 'crypto') {
    return import('node:' + modulePath);
  }
  return import(modulePath);
};

// Create necessary globals that may be referenced
globalThis.global = globalThis;

// Create a minimal process object with common properties
globalThis.process = {
  env: Deno.env.toObject(),
  cwd: () => Deno.cwd(),
  stdout: Deno.stdout,
  stderr: Deno.stderr,
  platform: Deno.build.os
};

// Import AgentLang runtime functions from module path
const { addModule, getActiveModuleName, fetchModule, getModuleNames,
        getUserModuleNames, parseAndIntern } = await import("${modulePath}");

// Add close function to properly exit the REPL with a single command
const close = () => {
  console.log('Exiting REPL...');
  if (typeof globalThis.exitRepl === 'function') {
    globalThis.exitRepl();
    return 'Shutting down REPL and cleaning up resources...';
  } else {
    console.log('Using fallback exit method');
    Deno.exit(0);
    return 'Exiting...'; // This won't actually execute due to Deno.exit(0)
  }
};

// Import loader functions
const { load, ApplicationSpec } = await import("${loaderPath}");

function isJavaScriptCode(input) {
  const trimmed = input.trim();
  
  // Check for common JS patterns
  const jsPatterns = [
    /^(const|let|var|function|class|import|export)\\s/,
    /^\\s*(console\\.|window\\.|document\\.|globalThis\\.)/,
    /^\\s*[a-zA-Z_$][a-zA-Z0-9_$]*\\s*=/,
    /^\\s*[a-zA-Z_$][a-zA-Z0-9_$]*\\s*\\(/,
    /^\\s*\\{.*\\}\\s*$/,
    /^\\s*\\[.*\\]\\s*$/,
    /^\\s*["'\`].*["'\`]\\s*$/,
    /^\\s*\\d+(\\.\\d+)?\\s*$/,
    /^\\s*(true|false|null|undefined)\\s*$/,
    /^\\s*\\/\\//,
    /^\\s*\\/\\*/
  ];
  
  return jsPatterns.some(pattern => pattern.test(trimmed));
}

function isAgentlangCode(input) {
  const trimmed = input.trim();
  
  // Check for Agentlang patterns
  const agentlangPatterns = [
    /^\\s*(entity|record|event|relationship|workflow)\\s+/i,
    /^\\s*[a-zA-Z_][a-zA-Z0-9_]*\\s*\\{[^}]*\\}\\s*$/,
    /\\s+@(id|indexed|optional|default|unique|autoincrement|array|object|ref)\\b/
  ];
  
  return agentlangPatterns.some(pattern => pattern.test(trimmed));
}

async function processAgentlang(code) {
  try {
    const currentModule = getActiveModuleName();
    console.log("The code is: ", code);
    console.log("The currentModule is: ", currentModule);
    await parseAndIntern(code, currentModule);
    console.log('✓ Agentlang code processed successfully');
    return 'OK';
  } catch (error) {
    console.error('✗ Error processing Agentlang code:', error.message);
    throw error;
  }
}

// Override the default eval to handle Agentlang syntax
const originalEval = globalThis.eval;
globalThis.eval = function(input) {
  const trimmed = input.trim();
  
  // Skip empty input
  if (!trimmed) return;
  
  // If it looks like JavaScript, use normal eval
  if (isJavaScriptCode(trimmed)) {
    return originalEval(input);
  }
  
  // If it looks like Agentlang, use parseAndIntern
  if (isAgentlangCode(trimmed)) {
    // Return a promise for async handling
    return processAgentlang(trimmed);
  }
  
  // Default to JavaScript eval
  return originalEval(input);
};

// Load the application
console.log(\`Loading application: ${appPath}\`);

// Load the application with the specified path
await load(
  "${appPath}",
  (appSpec) => {
    console.log('Application loaded successfully');
    globalThis.appSpec = appSpec;
  }
);

console.log('AgentLang REPL ready! You can now type Agentlang syntax directly.');
console.log('Type help() for available commands.');

// Helper functions for the REPL
globalThis.ag = processAgentlang; // Shortcut: ag\`entity User { name String }\`
globalThis.current = () => getActiveModuleName();
globalThis.modules = () => getModuleNames();
globalThis.userModules = () => getUserModuleNames();
globalThis.module = (name) => fetchModule(name);
globalThis.newModule = (name) => addModule(name);

// Helper function to display available commands
const help = () => {
  console.log(\`
AgentLang REPL - Direct Language Support

DIRECT AGENTLANG SYNTAX:
Type Agentlang code directly in the REPL:

  entity Employee {
    email Email @id,
    firstName String @indexed,
    lastName String @optional,
    salary Number @default(4500.0) @indexed
  }

  record UserProfile {
    name String,
    age Int @optional
  }

  event UserCreated {
    userId String @id,
    timestamp DateTime @default(now())
  }

  relationship EmployeeCompany contains (Employee, Company)

HELPER FUNCTIONS:
  ag(code)          - Process Agentlang code programmatically
  current()         - Get current active module name
  modules()         - List all modules
  userModules()     - List user-defined modules
  module(name)      - Get module by name
  newModule(name)   - Create new module

JAVASCRIPT/TYPESCRIPT:
You can also execute JavaScript/TypeScript code normally.
The REPL automatically detects the input type and processes accordingly.

Use help() to see this message again.

REPL operations:
  close() - Exit the REPL cleanly
\`);
};

// Export the necessary functions and variables as global bindings
globalThis.close = close;
globalThis.help = help;
globalThis.getEntity = getEntity;
globalThis.addEntity = addEntity;
globalThis.removeEntity = removeEntity;
globalThis.getRecord = getRecord;
globalThis.addRecord = addRecord;
globalThis.removeRecord = removeRecord;
globalThis.getEntrySchema = getEntrySchema;
globalThis.getRelationship = getRelationship;
globalThis.addRelationship = addRelationship;
globalThis.removeRelationship = removeRelationship;
globalThis.getWorkflow = getWorkflow;
globalThis.addWorkflow = addWorkflow;
globalThis.removeWorkflow = removeWorkflow;
globalThis.getEvent = getEvent;
globalThis.addEvent = addEvent;
globalThis.removeEvent = removeEvent;
globalThis.addModule = addModule;
globalThis.getActiveModuleName = getActiveModuleName;
globalThis.fetchModule = fetchModule;
globalThis.removeModule = removeModule;
globalThis.getModuleNames = getModuleNames;
globalThis.getUserModuleNames = getUserModuleNames;
globalThis.ApplicationSpec = ApplicationSpec;
`;

  // Write initialization code to the temporary file
  await Deno.writeTextFile(tempFile, initCode);

  const cmd = new Deno.Command('deno', {
    args: [
      'repl',
      '--quiet',
      `--eval-file=${tempFile}`,
      '--allow-all',
      '--unstable-sloppy-imports',
    ],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit', // Inherit stdin to allow user input
  });

  const process = cmd.spawn();
  _replProcess = process;

  // Register the file for cleanup on exit
  // Track cleanup status to avoid multiple attempts
  let fileCleanupComplete = false;

  const cleanupTempFile = () => {
    if (fileCleanupComplete) {
      return; // Skip if already cleaned up
    }

    try {
      Deno.removeSync(tempFile);
      console.log('Temporary REPL file cleaned up');
      fileCleanupComplete = true;
    } catch (err) {
      // Only show error if file should exist but removal failed
      if (!(err instanceof Deno.errors.NotFound)) {
        console.debug(
          'Failed to clean up temp file:',
          err instanceof Error ? err.message : String(err)
        );
      }
      fileCleanupComplete = true;
    }
  };

  // Add signal listeners for cleanup but remove them after cleanup
  const cleanupHandler = () => {
    cleanupTempFile();
  };

  // Use one-time signal listeners to prevent recursion
  const onSignalInt = () => {
    cleanupHandler();
    // After cleanup, remove this listener to prevent repeated handling
    Deno.removeSignalListener('SIGINT', onSignalInt);
  };

  const onSignalTerm = () => {
    cleanupHandler();
    // After cleanup, remove this listener to prevent repeated handling
    Deno.removeSignalListener('SIGTERM', onSignalTerm);
  };

  // Add individual signal listeners to avoid type issues
  Deno.addSignalListener('SIGINT', onSignalInt);
  Deno.addSignalListener('SIGTERM', onSignalTerm);

  // Ensure temp file is cleaned up when REPL exits
  process.status
    .then(() => {
      cleanupTempFile();
    })
    .catch(() => {
      cleanupTempFile();
    });

  return process;
}

// Function to stop all processes
function stopAllProcesses(): void {
  console.log('\nStopping processes...');

  if (_replProcess) {
    try {
      _replProcess.kill('SIGTERM');
      _replProcess = null;
    } catch {
      // Ignore error if process already terminated
    }
  }

  if (_cliProcess) {
    try {
      _cliProcess.kill('SIGTERM');
      _cliProcess = null;
    } catch {
      // Ignore error if process already terminated
    }
  }
}

// Function to start both processes
async function startProcesses(appFile: string): Promise<void> {
  if (_isRestarting) {
    console.log('Already restarting, skipping...');
    return;
  }

  _isRestarting = true;
  stopAllProcesses();

  // Start CLI process first
  const cliProcess = await startCLIProcess(appFile);
  if (!cliProcess) {
    console.error('Failed to start CLI process');
    _isRestarting = false;
    return;
  }

  // Then start Deno REPL
  const replProcess = await startDenoRepl(appFile);
  if (!replProcess) {
    console.error('Failed to start Deno REPL');
    stopAllProcesses();
    _isRestarting = false;
    return;
  }

  _isRestarting = false;

  // Wait for REPL to exit
  await replProcess.status;
  console.log('REPL exited');

  // If exitRepl function exists, call it to resolve the main promise
  if (typeof globalThis.exitRepl === 'function') {
    globalThis.exitRepl();
  } else {
    stopAllProcesses();
  }
}

// Set up file watcher for watch mode
function setupFileWatcher(appFile: string): void {
  if (!args.watch) {
    return;
  }

  // Get the app directory to watch for changes
  const lastSlashIndex = appFile.lastIndexOf('/');
  const appDir = lastSlashIndex >= 0 ? appFile.substring(0, lastSlashIndex) : '.';

  console.log(`Setting up file watcher for ${appDir}`);

  // Debounced restart function to prevent multiple rapid restarts
  const debouncedRestart = debounce(async () => {
    console.log('\nRestarting due to file changes...');
    await startProcesses(appFile);
  }, 500);

  // Watch for file changes in the app directory
  (async () => {
    try {
      const watcher = Deno.watchFs([appDir, 'src']);

      // Skip watching node_modules and hidden directories
      const skipPatterns = [/node_modules/, /\.git/, /\.vscode/, /\.idea/, /dist/, /\.DS_Store/];

      for await (const event of watcher) {
        // Skip files and directories that match the skip patterns
        const eventPaths = Array.from(event.paths);
        if (eventPaths.some(path => skipPatterns.some(pattern => pattern.test(path)))) {
          continue;
        }

        // Skip if not a modify or create event
        if (!['modify', 'create'].includes(event.kind)) {
          continue;
        }

        // Filter for relevant file extensions
        const relevantExtensions = ['.al', '.json', '.ts', '.js'];

        if (eventPaths.some(path => relevantExtensions.some(ext => path.endsWith(ext)))) {
          console.log(`File change detected: ${eventPaths.join(', ')}`);
          debouncedRestart();
        }
      }
    } catch (error) {
      console.error('File watcher error:', error instanceof Error ? error.message : String(error));
    }
  })();
}

// Display help if requested
function showHelp(): void {
  console.log(`
AgentLang REPL - Interactive AgentLang environment

Usage: deno run --allow-read --allow-write --allow-run --allow-env scripts/repl.ts [options]

Options:
  --app <path>       Specify app.json path (default: example/blog/app.json)
  -l, --langium      Enable Langium parsing and validation
  -w, --watch        Watch for file changes (default: true)
  --no-watch         Disable file watching
  -m, --module <name>   Default module name for operations
  -h, --help         Show this help message
`);
  Deno.exit(0);
}

// Main function to run the REPL
async function main(): Promise<void> {
  // exitRepl already initialized to null at the module level

  // Show help if requested
  if (args.help) {
    showHelp();
    return;
  }

  console.log('AgentLang REPL');
  console.log(`App file: ${args.app}`);
  console.log(`Watch mode: ${args.watch ? 'enabled' : 'disabled'}`);
  if (args.module) console.log(`Default module: ${args.module}`);

  // Prepare the environment (generate langium files and build if needed)
  const envReady = await prepareEnvironment();
  if (!envReady) {
    console.error('Failed to prepare environment. Exiting...');
    Deno.exit(1);
  }

  // Setup file watcher FIRST if watch mode is enabled
  if (args.watch) {
    setupFileWatcher(args.app);
  }

  // Start both processes
  await startProcesses(args.app);

  // Keep the main process running
  await new Promise<void>(resolve => {
    // The exitRepl function that will be exported to the global context
    // Using non-async function to fix lint warning (479555a3-0fa2-4c24-8365-5bede31a1e96)
    globalThis.exitRepl = (): void => {
      console.log('Cleaning up and exiting REPL...');
      stopAllProcesses();
      resolve();
    };
  });
}

// Handle process termination
// Use a module-level variable for tracking exit state
let isExitingRepl = false;

function handleSignal(signal: string) {
  if (isExitingRepl) {
    // If already in exit process, force quit after a short delay
    console.log('Force exit initiated...');
    setTimeout(() => {
      Deno.exit(0);
    }, 500);
    return;
  }

  console.log(`\nReceived ${signal} signal`);
  isExitingRepl = true;

  if (typeof globalThis.exitRepl === 'function') {
    globalThis.exitRepl();
  } else {
    console.log('Cleaning up and exiting...');
    stopAllProcesses();
    Deno.exit(0);
  }
}

// Use the same handler for both signals
Deno.addSignalListener('SIGINT', () => handleSignal('interrupt'));
Deno.addSignalListener('SIGTERM', () => handleSignal('termination'));

// Run the main function
main().catch(error => {
  console.error(
    'Error running AgentLang REPL:',
    error instanceof Error ? error.message : String(error)
  );
  stopAllProcesses();
  Deno.exit(1);
});
