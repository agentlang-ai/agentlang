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

  const initCodeLines = [
    '// Add shims for Node.js built-in modules',
    'globalThis.require = (modulePath) => {',
    '  if (modulePath === "path" || modulePath === "fs" ||',
    '      modulePath === "url" || modulePath === "util" ||',
    '      modulePath === "os" || modulePath === "crypto") {',
    '    return import("node:" + modulePath);',
    '  }',
    '  return import(modulePath);',
    '};',
    '',
    '// Create necessary globals that may be referenced',
    'globalThis.global = globalThis;',
    '',
    '// Create a minimal process object with common properties',
    'globalThis.process = {',
    '  env: Deno.env.toObject(),',
    '  cwd: () => Deno.cwd(),',
    '  stdout: Deno.stdout,',
    '  stderr: Deno.stderr,',
    '  platform: Deno.build.os',
    '};',
    '',
    '// Import AgentLang runtime functions from module path',
    `const { addModule, getActiveModuleName, fetchModule, getModuleNames,`,
    `        getUserModuleNames, getEntity, addEntity, removeEntity, getRecord,`,
    `        addRecord, removeRecord, getEntrySchema, getRelationship,`,
    `        addRelationship, removeRelationship, getWorkflow, addWorkflow,`,
    `        removeWorkflow, getEvent, addEvent, removeEvent, removeModule } = await import("${modulePath}");`,
    '',
    '// Import parseAndIntern from loader',
    `const { parseAndIntern } = await import("${loaderPath}");`,
    '',
    '// Import loader functions',
    `const { load, ApplicationSpec } = await import("${loaderPath}");`,
    '',

    '// Core AgentLang processing function',
    'async function processAgentlang(code) {',
    '  try {',
    '    let currentModule = getActiveModuleName();',
    '    // If no active module, try to get from appSpec',
    '    if (!currentModule && globalThis.appSpec && globalThis.appSpec.name) {',
    '      currentModule = globalThis.appSpec.name;',
    '      console.log(`Using module from appSpec: ${currentModule}`);',
    '    }',
    '    if (!currentModule) {',
    '      throw new Error("No active module found. Please ensure the application is loaded.");',
    '    }',
    '    await parseAndIntern(code, currentModule);',
    '    return "✓ AgentLang code processed successfully";',
    '  } catch (error) {',
    '    console.error("✗ Error processing AgentLang code:", error.message || error);',
    '    throw error;',
    '  }',
    '}',
    '',
    '// ========== ENHANCED AGENTLANG HELPERS ==========',
    '',
    '// Template literal tag functions AND regular function for natural syntax',
    'globalThis.al = globalThis.ag = function(strings, ...values) {',
    '  // Check if called as a template literal',
    '  if (Array.isArray(strings) && strings.raw) {',
    '    const code = strings.reduce((acc, str, i) => {',
    '      return acc + str + (values[i] !== undefined ? values[i] : "");',
    '    }, "");',
    '    return processAgentlang(code);',
    '  }',
    '  // Called as a regular function with a string',
    '  else if (typeof strings === "string") {',
    '    return processAgentlang(strings);',
    '  }',
    '  else {',
    '    throw new Error("Usage: Check help for usage...");',
    '  }',
    '};',
    '',
    '// Enhanced entity function - supports both object and string definitions',
    'globalThis.e = globalThis.entity = function(name, definition) {',
    '  if (typeof name === "string" && typeof definition === "object") {',
    '    // Object style: e("User", { name: "String", age: "Int" })',
    '    const fields = Object.entries(definition)',
    '      .map(([key, type]) => `  ${key} ${type}`)',
    '      .join("\\n");',
    '    const code = `entity ${name} {\\n${fields}\\n}`;',
    '    return processAgentlang(code);',
    '  }',
    '  else if (typeof name === "string" && typeof definition === "string") {',
    '    // String style: e("User", "{id String @id, name String}")',
    '    // Clean up the string - remove outer braces if present',
    '    const cleanDef = definition.trim();',
    '    const fieldsContent = cleanDef.startsWith("{") && cleanDef.endsWith("}") ',
    '      ? cleanDef.slice(1, -1).trim() ',
    '      : cleanDef;',
    '    const code = `entity ${name} { ${fieldsContent} }`;',
    '    return processAgentlang(code);',
    '  }',
    '  else {',
    '    throw new Error("Usage: check help() for entity usage");',
    '  }',
    '};',
    '',
    '// Enhanced record function - supports both object and string definitions',
    'globalThis.r = globalThis.record = function(name, definition) {',
    '  if (typeof name === "string" && typeof definition === "object") {',
    '    // Object style: r("Profile", { bio: "String" })',
    '    const fields = Object.entries(definition)',
    '      .map(([key, type]) => `  ${key} ${type}`)',
    '      .join("\\n");',
    '    const code = `record ${name} {\\n${fields}\\n}`;',
    '    return processAgentlang(code);',
    '  }',
    '  else if (typeof name === "string" && typeof definition === "string") {',
    '    // String style: r("Profile", "{bio String @optional}")',
    '    const cleanDef = definition.trim();',
    '    const fieldsContent = cleanDef.startsWith("{") && cleanDef.endsWith("}") ',
    '      ? cleanDef.slice(1, -1).trim() ',
    '      : cleanDef;',
    '    const code = `record ${name} { ${fieldsContent} }`;',
    '    return processAgentlang(code);',
    '  }',
    '  else {',
    '    throw new Error("Usage: check help() for record usage");',
    '  }',
    '};',
    '',
    '// Enhanced event function - supports both object and string definitions',
    'globalThis.ev = globalThis.event = function(name, definition) {',
    '  if (typeof name === "string" && typeof definition === "object") {',
    '    // Object style: ev("UserCreated", { userId: "String" })',
    '    const fields = Object.entries(definition)',
    '      .map(([key, type]) => `  ${key} ${type}`)',
    '      .join("\\n");',
    '    const code = `event ${name} {\\n${fields}\\n}`;',
    '    return processAgentlang(code);',
    '  }',
    '  else if (typeof name === "string" && typeof definition === "string") {',
    '    // String style: ev("UserCreated", "{userId String, timestamp DateTime}")',
    '    const cleanDef = definition.trim();',
    '    const fieldsContent = cleanDef.startsWith("{") && cleanDef.endsWith("}") ',
    '      ? cleanDef.slice(1, -1).trim() ',
    '      : cleanDef;',
    '    const code = `event ${name} { ${fieldsContent} }`;',
    '    return processAgentlang(code);',
    '  }',
    '  else {',
    '    throw new Error("Usage: check help() for event usage");',
    '  }',
    '};',
    '',
    '// Enhanced relationship function - supports multiple syntax styles',
    'globalThis.rel = globalThis.relationship = function(name, typeOrDef, from, to, annotation) {',
    '  // Style 1: rel("UserPost", "contains", "User", "Post", "@one_many")',
    '  if (typeof name === "string" && typeof typeOrDef === "string" && typeof from === "string" && typeof to === "string") {',
    '    const annotStr = annotation ? ` ${annotation}` : "";',
    '    const code = `relationship ${name} ${typeOrDef} (${from}, ${to})${annotStr}`;',
    '    return processAgentlang(code);',
    '  }',
    '  // Style 2: rel("UserPost", "contains (User, Post) @one_many")',
    '  else if (typeof name === "string" && typeof typeOrDef === "string" && !from && !to) {',
    '    const code = `relationship ${name} ${typeOrDef}`;',
    '    return processAgentlang(code);',
    '  }',
    '  // Style 3: rel("relationship UserPost contains (User, Post) @one_many")',
    '  else if (typeof name === "string" && !typeOrDef && !from && !to) {',
    '    return processAgentlang(name);',
    '  }',
    '  else {',
    '    throw new Error("Usage: check help() for relationship usage");',
    '  }',
    '};',
    '',
    '// Enhanced workflow function - supports string and builder syntax',
    'globalThis.w = globalThis.workflow = function(name, definition) {',
    '  // String style: w("CreateUser", "{ {User {name CreateUser.name}} }")',
    '  if (typeof name === "string" && typeof definition === "string") {',
    '    const cleanDef = definition.trim();',
    '    const bodyContent = cleanDef.startsWith("{") && cleanDef.endsWith("}") ',
    '      ? cleanDef.slice(1, -1).trim() ',
    '      : cleanDef;',
    '    const code = `workflow ${name} {\\n  ${bodyContent}\\n}`;',
    '    return processAgentlang(code);',
    '  }',
    '  // Direct string: w("workflow CreateUser { ... }")',
    '  else if (typeof name === "string" && !definition) {',
    '    return processAgentlang(name);',
    '  }',
    '  else {',
    '    throw new Error("Usage: check help() for workflow usage");',
    '  }',
    '};',
    '',
    '// Workflow builder helpers',
    'globalThis.WF = {',
    '  // Create a workflow operation',
    '  op: (entity, fields) => {',
    '    if (typeof fields === "string") return `{${entity} ${fields}}`;',
    '    const fieldStr = Object.entries(fields)',
    '      .map(([k, v]) => `${k} ${v}`)',
    '      .join(", ");',
    '    return `{${entity} {${fieldStr}}}`;',
    '  },',
    '  // Create a query operation (with ?)',
    '  query: (entity, fields) => {',
    '    if (!fields || fields === "{}") return `{${entity}? {}}`;',
    '    if (typeof fields === "string") return `{${entity}? ${fields}}`;',
    '    const fieldStr = Object.entries(fields)',
    '      .map(([k, v]) => `${k}? ${v}`)',
    '      .join(", ");',
    '    return `{${entity} {${fieldStr}}}`;',
    '  },',
    '  // Create an alias',
    '  as: (operation, alias) => `${operation} as [${alias}]`,',
    '  // Join multiple operations',
    '  join: (...operations) => operations.join(";\\n  "),',
    '};',
    '',
    '// Multi-line AgentLang builder for complex definitions',
    'globalThis.AL = class AgentLangBuilder {',
    '  constructor() {',
    '    this.lines = [];',
    '    this.indentLevel = 0;',
    '  }',
    '  ',
    '  indent() {',
    '    this.indentLevel++;',
    '    return this;',
    '  }',
    '  ',
    '  dedent() {',
    '    this.indentLevel = Math.max(0, this.indentLevel - 1);',
    '    return this;',
    '  }',
    '  ',
    '  add(line) {',
    '    const indent = "  ".repeat(this.indentLevel);',
    '    this.lines.push(indent + line);',
    '    return this;',
    '  }',
    '  ',
    '  entity(name) {',
    '    this.add(`entity ${name} {`);',
    '    this.indent();',
    '    return this;',
    '  }',
    '  ',
    '  record(name) {',
    '    this.add(`record ${name} {`);',
    '    this.indent();',
    '    return this;',
    '  }',
    '  ',
    '  event(name, extending) {',
    '    if (extending) {',
    '      this.add(`event ${name} extends ${extending} {`);',
    '    } else {',
    '      this.add(`event ${name} {`);',
    '    }',
    '    this.indent();',
    '    return this;',
    '  }',
    '  ',
    '  relationship(name, type, from, to, annotation) {',
    '    const annotStr = annotation ? ` ${annotation}` : "";',
    '    this.add(`relationship ${name} ${type} (${from}, ${to})${annotStr}`);',
    '    return this;',
    '  }',
    '  ',
    '  workflow(name) {',
    '    this.add(`workflow ${name} {`);',
    '    this.indent();',
    '    return this;',
    '  }',
    '  ',
    '  operation(content) {',
    '    this.add(content);',
    '    return this;',
    '  }',
    '  ',
    '  field(name, type, ...annotations) {',
    '    const annotStr = annotations.length > 0 ? " " + annotations.join(" ") : "";',
    '    this.add(`${name} ${type}${annotStr}`);',
    '    return this;',
    '  }',
    '  ',
    '  rbac(rules) {',
    '    this.add(`@rbac ${rules}`);',
    '    return this;',
    '  }',
    '  ',
    '  end() {',
    '    this.dedent();',
    '    this.add("}");',
    '    return this;',
    '  }',
    '  ',
    '  toString() {',
    '    return this.lines.join("\\n");',
    '  }',
    '  ',
    '  run() {',
    '    return processAgentlang(this.toString());',
    '  }',
    '};',
    '',
    '// Quick type helpers with annotations',
    'globalThis.T = {',
    '  // Basic types',
    '  String: "String",',
    '  Int: "Int",',
    '  Float: "Float",',
    '  Double: "Double",',
    '  Boolean: "Boolean",',
    '  DateTime: "DateTime",',
    '  Email: "Email",',
    '  Uuid: "Uuid",',
    '  UUID: "UUID",',
    '  URL: "URL",',
    '  ',
    '  // Type with annotations',
    '  id: (type = "UUID") => `${type} @id`,',
    '  optional: (type) => `${type} @optional`,',
    '  indexed: (type) => `${type} @indexed`,',
    '  unique: (type) => `${type} @unique`,',
    '  default: (type, value) => `${type} @default(${value})`,',
    '  ref: (type) => `${type} @ref(${type})`,',
    '  array: (type) => `${type} @array`,',
    '  object: (type) => `${type} @object`,',
    '  autoincrement: (type = "Int") => `${type} @autoincrement`,',
    '};',
    '',
    '// Batch operations helper',
    'globalThis.batch = function(...agentLangCodes) {',
    '  const results = [];',
    '  for (const code of agentLangCodes) {',
    '    try {',
    '      results.push(processAgentlang(code));',
    '    } catch (error) {',
    '      results.push(`Error: ${error.message}`);',
    '    }',
    '  }',
    '  return results;',
    '};',
    '',
    '// Module management shortcuts',
    'globalThis.m = {',
    '  current: () => getActiveModuleName(),',
    '  list: () => getModuleNames(),',
    '  user: () => getUserModuleNames(),',
    '  get: (name) => fetchModule(name),',
    '  new: (name) => addModule(name),',
    '  remove: (name) => removeModule(name),',
    '};',
    '',
    '// Entity/Record/Event inspection shortcuts',
    'globalThis.inspect = {',
    '  entity: (name) => getEntity(name),',
    '  record: (name) => getRecord(name),',
    '  event: (name) => getEvent(name),',
    '  relationship: (name) => getRelationship(name),',
    '  workflow: (name) => getWorkflow(name),',
    '  schema: (name) => getEntrySchema(name),',
    '};',
    '',
    '// Helper to check current module status',
    'globalThis.checkModule = () => {',
    '  const active = getActiveModuleName();',
    '  const modules = getModuleNames();',
    '  console.log("Active module:", active || "none");',
    '  console.log("Available modules:", modules);',
    '  if (globalThis.appSpec) {',
    '    console.log("App spec name:", globalThis.appSpec.name);',
    '  }',
    '  return { active, modules };',
    '};',
    '',
    '// Close function',
    'const close = () => {',
    '  console.log("Exiting REPL...");',
    '  if (typeof globalThis.exitRepl === "function") {',
    '    globalThis.exitRepl();',
    '    return "Shutting down REPL...";',
    '  } else {',
    '    Deno.exit(0);',
    '  }',
    '};',
    '',
    '// Load the application',
    `console.log("Loading application: ${appPath}");`,
    'await load(',
    `  "${appPath}",`,
    '  (appSpec) => {',
    '    console.log("Application loaded successfully");',
    '    globalThis.appSpec = appSpec;',
    '    // Set the active module from the loaded app spec',
    '    if (appSpec && appSpec.name) {',
    '      const moduleName = appSpec.name;',
    '      console.log(`Setting active module: ${moduleName}`);',
    "      // Try to add the module if it doesn't exist",
    '      try {',
    '        addModule(moduleName);',
    '      } catch (e) {',
    "        // Module might already exist, that's fine",
    '      }',
    '      // You may need to call a function to set the active module',
    '      // This depends on the AgentLang runtime API',
    '    }',
    '  }',
    ');',
    '',
    '// Enhanced help function',
    'const help = () => {',
    '  console.log(`',
    '╔═══════════════════════════════════════════════════════════════╗',
    '║                    AgentLang REPL - Enhanced                  ║',
    '╚═══════════════════════════════════════════════════════════════╝',
    '',
    '🎯 QUICK START - Multiple Styles:',
    '',
    '  1️⃣ Template Literals:',
    '    al\\`entity User {',
    '      id UUID @id @default(uuid())',
    '      name String @indexed',
    '    }\\`',
    '',
    '  2️⃣ String Functions:',
    '    al("entity User { id String @id, name String @indexed }")',
    '    e("User", "{id String @id, name String @indexed}")',
    '    r("Profile", "{bio String @optional, userId String @ref(User)}")',
    '',
    '  3️⃣ Object Style:',
    '    e("User", { id: T.id(), name: T.indexed("String") })',
    '    r("Profile", { bio: T.optional("String") })',
    '',
    '🚀 SHORT ALIASES:',
    '  e()  / entity()      - Define entities',
    '  r()  / record()      - Define records',
    '  ev() / event()       - Define events',
    '  rel()/ relationship()- Define relationships',
    '  w()  / workflow()    - Define workflows',
    '  al() / ag()          - Process any AgentLang code',
    '',
    '🔗 RELATIONSHIPS:',
    '',
    '  // Different syntax styles:',
    '  rel("UserProfile", "between", "User", "Profile", "@one_one")',
    '  rel("UserPost", "contains (User, Post) @one_many")',
    '  al("relationship PostCategory between (Post, Category)")',
    '',
    '  // With namespaced entities:',
    '  rel("UserProfile", "between (Blog/User, Blog/Profile) @one_one")',
    '',
    '⚡ WORKFLOWS:',
    '',
    '  // Simple workflow:',
    '  w("GetUser", "{User {id? GetUser.userId}}")',
    '',
    '  // Multi-operation workflow:',
    '  w("CreateUser", \\`{User {name CreateUser.name},',
    '     UserProfile {Profile {email CreateUser.email}}}\\`)',
    '',
    '  // Workflow with aliases:',
    '  al\\`workflow AddCategoryToPost {',
    '    {Post {id? AddCategoryToPost.postId}} as [post];',
    '    {Category {id? AddCategoryToPost.catId}} as [cat];',
    '    {PostCategory {Post post, Category cat}}',
    '  }\\`',
    '',
    '📋 EVENTS:',
    '',
    '  // Event extending another type:',
    '  ev("CreateUser", "extends Profile { name String }")',
    '  al("event UserCreated { userId String, timestamp DateTime }")',
    '',
    '📝 SYNTAX EXAMPLES:',
    '',
    '  // Entities - all equivalent:',
    '  al\\`entity User { name String }\\`',
    '  al("entity User { name String }")',
    '  e("User", "{ name String }")',
    '  e("User", "name String")  // Braces optional',
    '  e("User", { name: "String" })',
    '',
    '  // Relationships - all equivalent:',
    '  al\\`relationship UserPost contains (User, Post) @one_many\\`',
    '  rel("UserPost", "contains", "User", "Post", "@one_many")',
    '  rel("UserPost", "contains (User, Post) @one_many")',
    '',
    '  // Workflows - multiple styles:',
    '  al\\`workflow FindUsers { {User {name? FindUsers.name}} }\\`',
    '  w("FindUsers", "{User {name? FindUsers.name}}")',
    '',
    '🏗️  BUILDER PATTERN (for complex definitions):',
    '  new AL()',
    '    .entity("User")',
    '      .field("id", "UUID", "@id", "@default(uuid())")',
    '      .field("email", "Email", "@unique", "@indexed")',
    '      .rbac("[(roles: [admin], allow: [all])]")',
    '    .end()',
    '    .relationship("UserPost", "contains", "User", "Post", "@one_many")',
    '    .workflow("CreateUser")',
    '      .operation("{User {name CreateUser.name}}")',
    '    .end()',
    '    .run()',
    '',
    '📦 TYPE HELPERS (T):',
    '  T.String, T.Int, T.Boolean, T.DateTime',
    '  T.UUID, T.Email, T.URL, T.Float, T.Double',
    '  T.id(), T.id("UUID"), T.optional("String")',
    '  T.indexed("Int"), T.unique("Email")',
    '  T.default("UUID", "uuid()"), T.ref("User")',
    '  T.autoincrement(), T.array("String")',
    '',
    '🛠️ WORKFLOW HELPERS (WF):',
    '  WF.op("User", { name: "CreateUser.name" })',
    '    => {User {name CreateUser.name}}',
    '  ',
    '  WF.query("User", { id: "GetUser.id" })',
    '    => {User {id? GetUser.id}}',
    '  ',
    '  WF.as("{User {id? GetUser.id}}", "user")',
    '    => {User {id? GetUser.id}} as [user]',
    '',
    '🔧 MODULE MANAGEMENT (m):',
    '  m.current()     - Current module name',
    '  m.list()        - All modules',
    '  m.new("name")   - Create module',
    '  m.get("name")   - Get module details',
    '',
    '🔍 INSPECTION (inspect):',
    '  inspect.entity("User")',
    '  inspect.record("Profile")',
    '  inspect.event("CreateUser")',
    '  inspect.relationship("UserPost")',
    '  inspect.workflow("CreateUser")',
    '  inspect.schema("User")',
    '',
    '⚡ BATCH OPERATIONS:',
    '  batch(',
    '    "entity User { name String }",',
    '    "entity Post { title String }",',
    '    "relationship UserPost contains (User, Post)"',
    '  )',
    '',
    '💡 TIPS:',
    '  • Braces {} are optional in string definitions',
    '  • Use @one_one, @one_many for relationship cardinality',
    '  • Use ? for query fields in workflows (e.g., id?)',
    '  • Use Tab for auto-completion',
    '  • Use arrow keys for history',
    '  • Type help() in REPL for Deno commands',
    '  • close() or Ctrl+C to exit',
    '',
    'Type help() to see this again.',
    '`);',
    '};',
    '',
    '// Show initial help',
    'console.log("\\n✨ AgentLang Enhanced REPL ready!");',
    'console.log("Type help() for usage examples\\n");',
    '',
    '// Export everything to global scope',
    'globalThis.close = close;',
    'globalThis.help = help;',
    'globalThis.processAgentlang = processAgentlang;',
    'globalThis.getEntity = getEntity;',
    'globalThis.addEntity = addEntity;',
    'globalThis.removeEntity = removeEntity;',
    'globalThis.getRecord = getRecord;',
    'globalThis.addRecord = addRecord;',
    'globalThis.removeRecord = removeRecord;',
    'globalThis.getEntrySchema = getEntrySchema;',
    'globalThis.getRelationship = getRelationship;',
    'globalThis.addRelationship = addRelationship;',
    'globalThis.removeRelationship = removeRelationship;',
    'globalThis.getWorkflow = getWorkflow;',
    'globalThis.addWorkflow = addWorkflow;',
    'globalThis.removeWorkflow = removeWorkflow;',
    'globalThis.getEvent = getEvent;',
    'globalThis.addEvent = addEvent;',
    'globalThis.removeEvent = removeEvent;',
    'globalThis.addModule = addModule;',
    'globalThis.getActiveModuleName = getActiveModuleName;',
    'globalThis.fetchModule = fetchModule;',
    'globalThis.removeModule = removeModule;',
    'globalThis.getModuleNames = getModuleNames;',
    'globalThis.getUserModuleNames = getUserModuleNames;',
    'globalThis.ApplicationSpec = ApplicationSpec;',
  ];

  const initCode = initCodeLines.join('\n');

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
        if (eventPaths.some((path: string) => skipPatterns.some(pattern => pattern.test(path)))) {
          continue;
        }

        // Skip if not a modify or create event
        if (!['modify', 'create'].includes(event.kind)) {
          continue;
        }

        // Filter for relevant file extensions
        const relevantExtensions = ['.al', '.json', '.ts', '.js'];

        if (eventPaths.some((path: string) => relevantExtensions.some(ext => path.endsWith(ext)))) {
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
