import { parseArgs } from '@std/cli/parse-args';

// Parse command line arguments
const args = parseArgs(Deno.args, {
  string: ['app'],
  boolean: ['watch', 'help'],
  alias: {
    w: 'watch',
    h: 'help',
  },
  default: { app: 'example/blog/app.json' },
  unknown: (arg: string) => !arg.startsWith('-'),
});

// Function to read and parse the app JSON file
async function loadApplication(filePath: string) {
  try {
    const fileContent = await Deno.readTextFile(filePath);
    const app = JSON.parse(fileContent);

    // Ensure it has required fields
    if (!app.name || !app.version) {
      throw new Error('Invalid application specification file. Missing name or version.');
    }

    return app;
  } catch (error) {
    console.error('Failed to load application file:', error);
    throw error;
  }
}

// Function to ensure output directory exists
async function ensureOutputDirExists(): Promise<void> {
  try {
    const outDir = new URL('../out', import.meta.url).pathname;
    const stat = await Deno.stat(outDir);
    if (!stat.isDirectory) {
      console.error(`Output directory ${outDir} exists but is not a directory`);
      Deno.exit(1);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error('Output directory not found. Please run these commands first:');
      console.error('npm run langium:generate');
      console.error('npm run build');
      Deno.exit(1);
    }
    throw error;
  }
}

// Helper function to run commands with visible output
async function runWithOutput(command: string, args: string[]): Promise<void> {
  console.log(`Running: ${command} ${args.join(' ')}`);
  const cmd = new Deno.Command(command, {
    args,
    stdout: 'inherit', // Show output directly
    stderr: 'inherit',
  });

  const process = cmd.spawn();
  const status = await process.status;

  if (!status.success) {
    throw new Error(`Command '${command} ${args.join(' ')}' failed with code ${status.code}`);
  }
}

// Function to start the Node CLI command and return the process
function startNodeCliProcess(appFile: string): Deno.ChildProcess {
  const cliPath = new URL('../bin/cli.js', import.meta.url).pathname;
  console.log(`Running: node ${cliPath} run ${appFile}`);

  const cmd = new Deno.Command('node', {
    args: [cliPath, 'run', appFile],
    stdout: 'piped',
    stderr: 'piped',
  });

  const process = cmd.spawn();
  const stdout = process.stdout;
  const stderr = process.stderr;

  // Stream stdout to console
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stdout) {
      console.log(decoder.decode(chunk));
    }
  })();

  // Stream stderr to console
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stderr) {
      console.error(decoder.decode(chunk));
    }
  })();

  // Set up event listener for process exit
  process.status.then(status => {
    if (!status.success) {
      console.error(`CLI process exited with code ${status.code}`);
    }
  });

  return process;
}

// Function to run the Node CLI command and wait for completion
async function runNodeCliCommand(appFile: string): Promise<void> {
  const process = await startNodeCliProcess(appFile);
  const status = await process.status;

  if (!status.success) {
    throw new Error(`CLI process exited with code ${status.code}`);
  }
}

// Set up file watcher if requested
async function setupFileWatcher(appFile: string) {
  console.log('Watching for file changes...');

  // Get the directory containing the app file
  const appDir = appFile.substring(0, appFile.lastIndexOf('/'));

  // First run the CLI to start the application
  console.log('Starting application in watch mode');
  let cliProcess = startNodeCliProcess(appFile);

  // Function to handle restart
  const restartProcess = () => {
    console.log('Restarting application...');

    try {
      // Kill the current process if it's still running
      if (cliProcess && cliProcess.pid) {
        try {
          Deno.kill(cliProcess.pid, 'SIGTERM');
          console.log(`Terminated previous process with PID ${cliProcess.pid}`);
        } catch (e) {
          console.error(`Error during kill process: ${e}`);
          // Process might already be gone, that's fine
        }
      }

      // Start a new process
      cliProcess = startNodeCliProcess(appFile);
    } catch (error) {
      console.error('Error restarting application:', error);
    }
  };

  // Log the directory we're watching
  console.log(`Watching directory: ${appDir}`);

  // Watch only the app directory to avoid permission issues
  const watcher = Deno.watchFs(appDir);
  let debounceTimer: number | undefined;

  // Main watch loop
  for await (const event of watcher) {
    // Filter out events
    const relevantPaths = event.paths.filter(
      path =>
        !path.includes('node_modules') && !path.includes('.git') && !path.includes('.DS_Store')
    );

    if (relevantPaths.length === 0) continue;

    // Log the change
    console.log(`File change detected: ${event.kind} - ${relevantPaths.join(', ')}`);

    // Debounce to prevent multiple rapid restarts
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(restartProcess, 500);
  }
}

// Main function
async function main(): Promise<void> {
  // Display help if requested
  if (args.help) {
    console.log(`
Run AgentLang application

Usage: deno task run [options]

Options:
  -w, --watch       Watch for file changes and restart
  --app <path>      Specify app.json path (default: example/blog/app.json)
  -h, --help        Show this help message
`);
    Deno.exit(0);
  }

  try {
    // Load the application file
    const appFile = args.app;
    console.log(`Loading application from: ${appFile}`);
    const app = await loadApplication(appFile);

    console.log(`Starting ${app.name} v${app.version}...`);

    // Check if the out directory and necessary files exist
    await ensureOutputDirExists();

    // Run npm commands separately to ensure they're run in the right environment
    console.log('Running pre-flight checks to ensure language files are generated and built');

    // First, check if output directory exists - if not, we need to build
    const outDir = new URL('../out', import.meta.url).pathname;
    let needsFullBuild = false;

    try {
      const stat = await Deno.stat(outDir);
      if (!stat.isDirectory) {
        console.error(`Output directory ${outDir} exists but is not a directory`);
        needsFullBuild = true;
      }

      // Check specifically for the module.ts file that was missing
      const modulePath = new URL('../out/language/generated/module.ts', import.meta.url).pathname;
      try {
        await Deno.stat(modulePath);
      } catch {
        needsFullBuild = true;
      }
    } catch {
      // If directory doesn't exist, we need to build
      needsFullBuild = true;
    }

    // Run the generation and build steps if needed
    if (needsFullBuild) {
      // First, run npm langium:generate
      console.log('Generating Langium files...');
      await runWithOutput('npm', ['run', 'langium:generate']);
      console.log('Langium files generated successfully.');

      // Then, run npm build
      console.log('\nBuilding project...');
      await runWithOutput('npm', ['run', 'build']);
      console.log('Build completed successfully.');
    }

    // If watch mode is enabled, set up file watcher, otherwise just run once
    if (args.watch) {
      console.log(`Watch mode enabled. Watching directory for changes...`);
      await setupFileWatcher(appFile);
    } else {
      // Run the application using Node CLI (single run mode)
      await runNodeCliCommand(appFile);
    }
  } catch (error) {
    console.error('Error running application:', error);
    Deno.exit(1);
  }
}

// Run the main function
main().catch((error: unknown) => {
  console.error('Unhandled error:', error instanceof Error ? error.message : String(error));
  Deno.exit(1);
});
