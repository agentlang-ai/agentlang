#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

// Simple prompt function for Deno
async function prompt(message: string): Promise<string> {
  const buf = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(message));
  const n = await Deno.stdin.read(buf);
  if (n === null) return '';
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

// Dynamically import the language server module
const modulePath = new URL('../out/language/agentlang-module.js', import.meta.url);
const { createAgentlangServices } = await import(modulePath.href);

// Create language services without LSP connection
const services = createAgentlangServices({});

// Start the REPL
console.log('AgentLang REPL (type :q to quit)');

// Main REPL loop
while (true) {
  const input = await prompt('> ');
  
  // Check for quit command
  if (input === ':q' || input === 'quit') {
    console.log('Goodbye!');
    Deno.exit(0);
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
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}
