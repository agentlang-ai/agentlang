import { parse } from 'https://deno.land/std@0.197.0/flags/mod.ts';

// Define application interface
interface AgentLangApp {
  name: string;
  version: string;
  // Allow additional properties
  [key: string]: unknown;
}

// Parse command line arguments
const args = parse(Deno.args, {
  string: ['app'],
  default: {},
  unknown: arg => !arg.startsWith('-'),
});

// Extract non-option arguments
const appPath = args._.length > 0 ? String(args._[0]) : 'example/blog/app.json';

// Simple prompt function for Deno
async function prompt(message: string): Promise<string> {
  const buf = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(message));
  const n = await Deno.stdin.read(buf);
  if (n === null) return '';
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

// Function to load an app using Deno APIs only
async function loadApp(appPath: string): Promise<AgentLangApp | null> {
  console.log(`Loading app from ${appPath}...`);

  try {
    // Check if the file exists
    await Deno.stat(appPath);

    // Read the app JSON file
    const appContent = await Deno.readTextFile(appPath);
    const parsed = JSON.parse(appContent);

    // Ensure all properties are properly defined
    return {
      name: parsed.name || 'Unknown App',
      version: parsed.version || '0.0.0',
      ...parsed,
    };
  } catch (error) {
    console.error('Error loading app:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// Try to read the Agentlang file based on the app path
async function getAgentlangFile(appPath: string): Promise<string | null> {
  try {
    // Normalize path to handle both relative and absolute paths
    const normalizedPath = appPath.startsWith('/') ? appPath : Deno.cwd() + '/' + appPath;

    // Extract directory
    const lastSlashIndex = normalizedPath.lastIndexOf('/');
    if (lastSlashIndex === -1) {
      throw new Error(`Invalid path format: ${normalizedPath}`);
    }

    const dir = normalizedPath.substring(0, lastSlashIndex);
    const baseName = normalizedPath.substring(lastSlashIndex + 1);
    const baseFileName = baseName.replace('.json', '.al');

    // First try the direct equivalent .al file
    const directAlPath = `${dir}/${baseFileName}`;

    try {
      await Deno.stat(directAlPath);
      console.log(`Found AgentLang file at: ${directAlPath}`);
      return await Deno.readTextFile(directAlPath);
    } catch (_directError) {
      // If direct file not found, search for any .al files in the directory
      console.log(`Specific .al file not found, searching directory: ${dir}`);

      try {
        // List all files in the directory
        const entries = [];
        for await (const entry of Deno.readDir(dir)) {
          if (entry.isFile && entry.name.endsWith('.al')) {
            entries.push(entry.name);
          }
        }

        if (entries.length > 0) {
          // Use the first .al file found
          const foundAlPath = `${dir}/${entries[0]}`;
          console.log(`Found AgentLang file: ${foundAlPath}`);
          return await Deno.readTextFile(foundAlPath);
        } else {
          throw new Error(`No .al files found in directory: ${dir}`);
        }
      } catch (dirError) {
        throw new Error(
          `Failed to search directory ${dir}: ${dirError instanceof Error ? dirError.message : String(dirError)}`
        );
      }
    }
  } catch (error) {
    console.error(
      'Error reading .al file:',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

// Run environment setup commands (Langium generate and build)
async function prepareEnvironment(): Promise<boolean> {
  console.log('Preparing environment...');

  try {
    // Run Langium generate
    console.log('Running: npm run langium:generate');
    const langiumGenerate = new Deno.Command('npm', {
      args: ['run', 'langium:generate'],
      stdout: 'piped',
      stderr: 'piped',
    });

    const langiumResult = await langiumGenerate.output();
    if (langiumResult.code !== 0) {
      console.error(
        'Failed to generate Langium parser:',
        new TextDecoder().decode(langiumResult.stderr)
      );
      return false;
    }
    console.log('Langium parser generated successfully.');

    // Run build
    console.log('Running: npm run build');
    const buildCmd = new Deno.Command('npm', {
      args: ['run', 'build'],
      stdout: 'piped',
      stderr: 'piped',
    });

    const buildResult = await buildCmd.output();
    if (buildResult.code !== 0) {
      console.error('Failed to build project:', new TextDecoder().decode(buildResult.stderr));
      return false;
    }
    console.log('Project built successfully.');

    return true;
  } catch (error) {
    console.error(
      'Environment preparation error:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

// Detect if input is likely a JS/TS expression vs AgentLang code
function isJavaScriptExpression(code: string): boolean {
  // Skip empty input
  if (!code.trim()) {
    return false;
  }
  
  // Comprehensive list of AgentLang keywords and patterns based on example files
  const agentLangPatterns = [
    // Module declaration
    /^\s*module\s+[A-Za-z0-9_]+/i,
    
    // Entity definitions
    /^\s*entity\s+[A-Za-z0-9_]+\s*\{/i,
    
    // Relationship declarations
    /^\s*relationship\s+[A-Za-z0-9_]+\s+(contains|between)\s*\(/i,
    
    // Workflow definitions
    /^\s*workflow\s+[A-Za-z0-9_]+\s*\{/i,
    
    // Event definitions
    /^\s*event\s+[A-Za-z0-9_]+/i,
    
    // Action definitions
    /^\s*action\s+[A-Za-z0-9_]+/i,
    
    // Model definitions
    /^\s*model\s+[A-Za-z0-9_]+/i,
    
    // Function definitions
    /^\s*function\s+[A-Za-z0-9_]+/i,
    
    // Agent definitions
    /^\s*agent\s+[A-Za-z0-9_]+/i,
    
    // Application definitions
    /^\s*application\s+[A-Za-z0-9_]+/i,
    
    // When clauses
    /^\s*when\s+/i,
    
    // State definitions
    /^\s*state\s+[A-Za-z0-9_]+/i,
    
    // Multi-line check for common AgentLang patterns
    /\s+@(id|auto|unique|indexed|optional|one_one|default)/i,  // Decorators
    /@[A-Za-z0-9_]+\s*\(/i,  // Decorator with arguments
    /[A-Za-z0-9_]+\s+[A-Za-z0-9_]+\s+\(.*\)\s*,/i,  // Type definitions
    /[A-Za-z0-9_]+\s*\{\s*id\?\s+[A-Za-z0-9_]+\.[A-Za-z0-9_]+/i,  // Query patterns
    /\bRef\s*\([A-Za-z0-9_]+\.[A-Za-z0-9_]+\s+as\s+[A-Za-z0-9_]+\)/i,  // References
  ];

  // If it matches any AgentLang pattern, it's probably not a JS expression
  for (const pattern of agentLangPatterns) {
    if (pattern.test(code)) {
      return false;
    }
  }

  // JavaScript-specific patterns
  const jsPatterns = [
    // Operators and syntax
    /[+\-*/%]=?/,  // Math operators
    /[=!]==?/,     // Comparison operators
    /=>|\+=|-=|\*=|\/=|%=/,  // Arrow function and assignment operators
    
    // JS keywords
    /\b(let|const|var|function|class|return|if|else|for|while|do|switch|case|break|continue|try|catch|throw|new|this|import|export|from|as|async|await|yield|typeof|instanceof)\b/,
    
    // Common JS functions and objects
    /\b(console\.|Math\.|JSON\.|Object\.|Array\.|String\.|Number\.|Boolean\.|Date\.|Promise\.|setTimeout|setInterval|clearTimeout|clearInterval)\b/,
    
    // JS built-ins
    /\b(true|false|null|undefined|NaN|Infinity)\b/,
    
    // Common patterns like function calls, array/object literals
    /\w+\(.*\)/,  // Function calls
    /\[.*\]/,     // Array literal
    /\{.*:\s*.*\}/  // Object literal
  ];

  for (const pattern of jsPatterns) {
    if (pattern.test(code)) {
      return true;
    }
  }

  // If code is a simple expression (no AgentLang keywords and contains operators or literals)
  // This handles simple cases like "2 + 2"
  if (/^\s*[0-9"'`]+[\s\+\-\*\/\%\(\)][0-9"'`\s\+\-\*\/\%\(\)]*$/.test(code)) {
    return true;
  }

  // Default to treating it as AgentLang if we're unsure
  return false;
}

// Evaluate JavaScript expression using Deno
async function evaluateJavaScript(
  code: string
): Promise<{ valid: boolean; result?: unknown; errors?: string[] }> {
  try {
    // Create a temporary file with a wrapper to safely evaluate and return the result
    const tempFilename = await Deno.makeTempFile({ suffix: '.js' });
    const wrappedCode = `
      try {
        const result = eval(${JSON.stringify(code)});
        console.log(JSON.stringify({ success: true, result }));
      } catch (error) {
        console.log(JSON.stringify({ success: false, error: error.toString() }));
      }
    `;

    await Deno.writeTextFile(tempFilename, wrappedCode);

    try {
      // Use Deno to evaluate the code
      const command = new Deno.Command('deno', {
        args: ['run', '--allow-all', tempFilename],
        stdout: 'piped',
        stderr: 'piped',
      });

      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout).trim();
      const errorOutput = new TextDecoder().decode(stderr).trim();

      if (errorOutput) {
        return {
          valid: false,
          errors: [errorOutput],
        };
      }

      try {
        const result = JSON.parse(output);
        if (result.success) {
          return {
            valid: true,
            result: result.result,
          };
        } else {
          return {
            valid: false,
            errors: [result.error],
          };
        }
      } catch (_parseError) {
        return {
          valid: false,
          errors: ['Failed to parse evaluation result: ' + output],
        };
      }
    } finally {
      // Clean up the temporary file
      try {
        await Deno.remove(tempFilename);
      } catch (e) {
        console.error(
          'Failed to clean up temporary file:',
          e instanceof Error ? e.message : String(e)
        );
      }
    }
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

// Run the Node.js CLI to validate AgentLang code
async function parseAgentlang(
  code: string
): Promise<{ valid: boolean; ast?: unknown; errors?: string[]; result?: unknown }> {
  // First determine if this looks like a JS/TS expression or AgentLang code
  if (isJavaScriptExpression(code)) {
    console.log('Evaluating as JavaScript/TypeScript...');
    return evaluateJavaScript(code);
  }

  console.log('Parsing as AgentLang code...');
  try {
    // Create a temporary file with the input
    const tempFilename = await Deno.makeTempFile({ suffix: '.al' });
    await Deno.writeTextFile(tempFilename, code);

    try {
      // Use the CLI to validate the code
      const command = new Deno.Command('node', {
        args: ['./bin/cli.js', 'parseAndValidate', tempFilename],
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code: exitCode, stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      if (exitCode === 0 && output.includes('successfully')) {
        return {
          valid: true,
          ast: { content: code },
        };
      } else {
        return {
          valid: false,
          errors: [errorOutput || 'Failed to validate code'],
        };
      }
    } finally {
      // Clean up the temporary file
      try {
        await Deno.remove(tempFilename);
      } catch (e) {
        console.error(
          'Failed to clean up temporary file:',
          e instanceof Error ? e.message : String(e)
        );
      }
    }
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

// Start a Deno REPL for AgentLang
async function startRepl(app: AgentLangApp, alSource?: string | null): Promise<void> {
  console.log('Starting AgentLang Deno REPL...');
  console.log(`App: ${app.name} v${app.version}`);
  console.log('Type :q to quit, :help for commands');

  if (alSource) {
    console.log('Found AgentLang source file:');
    console.log('---------------------------');
    // Display just a preview of the source file
    console.log(alSource.slice(0, 200) + (alSource.length > 200 ? '...' : ''));
    console.log('---------------------------');
  } else {
    console.log('No AgentLang source file found for this app.');
  }

  // Additional commands for the REPL
  const commands: Record<string, (args: string) => Promise<void>> = {
    ':help': async (): Promise<void> => {
      await Promise.resolve(); // To satisfy linter
      console.log('Available commands:');
      console.log('  :q, :quit - Exit the REPL');
      console.log('  :help - Show this help message');
      console.log('  :app - Show current app info');
      console.log('  :load <path> - Load a different app');
      console.log('  :source - Show the AgentLang source file');
    },
    ':app': async (): Promise<void> => {
      await Promise.resolve(); // To satisfy linter
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
        Object.assign(app, newApp);
        console.log(`Loaded app: ${app.name} v${app.version}`);

        // Try to load the Agentlang source
        const newSource = await getAgentlangFile(newAppPath);
        if (newSource) {
          alSource = newSource;
          console.log('Found AgentLang source file. Type :source to view it.');
        } else {
          console.log('No AgentLang source file found for this app.');
        }
      }
    },
    ':source': async (): Promise<void> => {
      await Promise.resolve(); // To satisfy linter
      if (alSource) {
        console.log('AgentLang source file:');
        console.log('---------------------');
        console.log(alSource);
        console.log('---------------------');
      } else {
        console.log('No AgentLang source file available.');
      }
    },
  };

  // Main REPL loop
  while (true) {
    const input = await prompt('> ');

    // Handle quit command
    if (input === ':q' || input === ':quit') {
      console.log('Goodbye!');
      Deno.exit(0);
    }

    // Handle commands
    if (input.startsWith(':')) {
      const [cmd, ...args] = input.split(' ');
      const handler = commands[cmd];

      if (handler) {
        await handler(args.join(' '));
      } else {
        console.log(`Unknown command: ${cmd}`);
        console.log('Type :help for available commands');
      }
      continue;
    }

    // Skip empty input
    if (!input.trim()) continue;

    // Process the input - could be AgentLang code or JavaScript
    const result = await parseAgentlang(input);

    if (result.valid) {
      // Check if we have a JavaScript result
      if (result.result !== undefined) {
        console.log('Result:', result.result);
      } else {
        // This is AgentLang code
        console.log('Valid AgentLang code!');
        console.log('AST:', JSON.stringify(result.ast, null, 2));

        // Here you would ideally process the code in the context of the loaded app
        console.log(
          'Note: In a full implementation, this code would be processed within the app context'
        );
      }
    } else {
      console.log('Errors:');
      for (const error of Array.from(result.errors || [])) {
        console.log(`  - ${error}`);
      }
    }
  }
}

// Main function
async function main(): Promise<void> {
  console.log(`Loading AgentLang app from: ${appPath}`);

  // First prepare the environment
  const prepared = await prepareEnvironment();
  if (!prepared) {
    console.error('Failed to prepare environment. Exiting.');
    Deno.exit(1);
  }

  // Load the app
  const app = await loadApp(appPath);

  if (!app) {
    console.error(`Failed to load app from ${appPath}. Exiting.`);
    Deno.exit(1);
  }

  // Try to load the Agentlang source
  const alSource = await getAgentlangFile(appPath);

  // Start the REPL
  await startRepl(app, alSource);
}

// Run the main function
main().catch((error: unknown) => {
  console.error('Unhandled error:', error instanceof Error ? error.message : String(error));
  Deno.exit(1);
});
