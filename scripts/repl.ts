import { parseArgs } from '@std/cli/parse-args';
import { debounce } from '@std/async/debounce';

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

  // Create a temporary file with the initialization code
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

// Import AgentLang functions
const cliPath = '${new URL('../bin/cli.js', import.meta.url).pathname}';
const modulePath = '${new URL('../src/runtime/module.ts', import.meta.url).pathname}';
const loaderPath = '${new URL('../src/runtime/loader.ts', import.meta.url).pathname}';

const { getEntity, addEntity, removeEntity, getRecord, addRecord, removeRecord, 
        getEntrySchema, getRelationship, addRelationship, removeRelationship,
        getWorkflow, addWorkflow, removeWorkflow, getEvent, addEvent, removeEvent,
        addModule, getActiveModuleName, fetchModule, removeModule, getModuleNames,
        getUserModuleNames } = await import(modulePath);

const { load, ApplicationSpec } = await import(loaderPath);


// Load the application
console.log('Loading application: ${appFile}');
await load(
  '${appPath}',
  (appSpec) => {
    console.log('Application loaded successfully');
    globalThis.appSpec = appSpec;
  }
);

console.log('AgentLang functions loaded. Type help() for available commands.');

const help = () => {
  console.log(\`
AgentLang REPL Commands:

Entity operations:
  addEntity(name, module?)
  getEntity(name, module?)
  removeEntity(name, module?)

Record operations:
  addRecord(name, module?)
  getRecord(name, module?)
  getEntrySchema(name, module?)
  removeRecord(name, module?)

Relationship operations:
  addRelationship(name, module?)
  getRelationship(name, module?)
  removeRelationship(name, module?)

Workflow operations:
  addWorkflow(name, module?)
  getWorkflow(name)
  removeWorkflow(name, module?)

Event operations:
  addEvent(name, module?)
  getEvent(name, module?)
  removeEvent(name, module?)

Module operations:
  addModule(name)
  getActiveModuleName()
  fetchModule(name)
  removeModule(name)
  getModuleNames()
  getUserModuleNames()
\`);
};
`;

  const tempFile = await Deno.makeTempFile({ suffix: '.js' });
  await Deno.writeTextFile(tempFile, initCode);

  // Start Deno REPL with the initialization file
  const cmd = new Deno.Command('deno', {
    args: [
      'repl',
      '--unstable-sloppy-imports',
      '--allow-sys',
      '--allow-env',
      '--allow-read',
      '--eval-file=' + tempFile,
    ],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  const process = cmd.spawn();
  _replProcess = process;

  // Clean up temp file after a delay
  setTimeout(() => {
    Deno.remove(tempFile).catch(() => {});
  }, 1000);

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
  stopAllProcesses();
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
  await new Promise(() => {});
}

// Handle process termination
Deno.addSignalListener('SIGINT', () => {
  console.log('\nReceived interrupt signal');
  stopAllProcesses();
  Deno.exit(0);
});

Deno.addSignalListener('SIGTERM', () => {
  console.log('\nReceived termination signal');
  stopAllProcesses();
  Deno.exit(0);
});

// Run the main function
main().catch(error => {
  console.error(
    'Error running AgentLang REPL:',
    error instanceof Error ? error.message : String(error)
  );
  stopAllProcesses();
  Deno.exit(1);
});
