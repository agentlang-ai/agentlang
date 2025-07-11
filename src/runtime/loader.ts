import chalk from 'chalk';
import { createAgentlangServices } from '../language/agentlang-module.js';
import {
  Import,
  RbacSpecEntries,
  RbacSpecEntry,
  RbacOpr,
  ModuleDefinition,
  Definition,
  isEntityDefinition,
  isEventDefinition,
  isRecordDefinition,
  isRelationshipDefinition,
  isWorkflowDefinition,
  EntityDefinition,
  RelationshipDefinition,
  WorkflowDefinition,
  RbacSpecDefinition,
  Statement,
  isStandaloneStatement,
  SchemaDefinition,
  isAgentDefinition,
  AgentDefinition,
  SetAttribute,
  isLiteral,
} from '../language/generated/ast.js';
import {
  addEntity,
  addEvent,
  addModule,
  addRecord,
  addRelationship,
  addWorkflow,
  Entity,
  RbacSpecification,
  Record,
  Relationship,
  Module,
  Workflow,
  isModule,
  getUserModuleNames,
  removeModule,
  newInstanceAttributes,
  addAgent,
} from './module.js';
import {
  findRbacSchema,
  importModule,
  makeFqName,
  maybeExtends,
  registerInitFunction,
  runShellCommand,
  //runShellCommand,
} from './util.js';
import { getFileSystem, toFsPath, readFile, readdir, exists } from '../utils/fs-utils.js';
import { URI } from 'vscode-uri';
import { AstNode, LangiumCoreServices, LangiumDocument } from 'langium';
import { isNodeEnv, path } from '../utils/runtime.js';
import { CoreModules, registerCoreModules } from './modules/core.js';
import { parse, parseModule, parseWorkflow } from '../language/parser.js';
import { logger } from './logger.js';
import { Environment, evaluateStatements, GlobalEnvironment } from './interpreter.js';
import { createPermission, createRole } from './modules/auth.js';
import { AgentEntityName, CoreAIModuleName, LlmEntityName } from './modules/ai.js';

export async function extractDocument(
  fileName: string,
  services: LangiumCoreServices
): Promise<LangiumDocument> {
  const extensions = services.LanguageMetaData.fileExtensions;

  if (isNodeEnv && typeof fileName === 'string') {
    if (!extensions.includes(path.extname(fileName))) {
      console.error(
        chalk.yellow(`Please choose a file with one of these extensions: ${extensions}.`)
      );
      process.exit(1);
    }

    const fullFilePath = path.resolve(fileName);

    const fileExists = await exists(fullFilePath);

    if (!fileExists) {
      const errorMsg = `File ${fileName} does not exist.`;
      if (chalk) {
        console.error(chalk.red(errorMsg));
      } else {
        console.error(errorMsg);
      }
      throw new Error(errorMsg);
    }
  } else if (!isNodeEnv && typeof fileName === 'string') {
    const fullFilePath = path.resolve(fileName);

    const fileExists = await exists(fullFilePath);

    if (!fileExists) {
      console.error(`File ${fileName} does not exist.`);
    }
  } else {
    throw new Error('Invalid input: expected file path (Node.js) or File object/content (browser)');
  }

  const document = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
    URI.file(path.resolve(fileName))
  );

  // Build document
  await services.shared.workspace.DocumentBuilder.build([document], {
    validation: true,
  });

  // Handle validation errors
  const validationErrors = (document.diagnostics ?? []).filter(e => e.severity === 1);

  if (validationErrors.length > 0) {
    console.error(
      isNodeEnv && chalk
        ? chalk.red('There are validation errors:')
        : 'There are validation errors:'
    );

    for (const validationError of validationErrors) {
      const errorMsg = `line ${validationError.range.start.line + 1}: ${
        validationError.message
      } [${document.textDocument.getText(validationError.range)}]`;
      if (isNodeEnv && chalk) {
        console.error(chalk.red(errorMsg));
      } else {
        console.error(errorMsg);
      }
    }

    throw new Error('Validation errors found');
  }

  return document;
}

export async function extractAstNode<T extends AstNode>(
  fileName: string,
  services: LangiumCoreServices
): Promise<T> {
  return (await extractDocument(fileName, services)).parseResult?.value as T;
}

export type ApplicationSpec = any;

export const DefaultAppSpec: ApplicationSpec = {
  name: 'agentlang-app',
  version: '0.0.1',
};

async function loadApp(appDir: string, fsOptions?: any, callback?: Function): Promise<string> {
  // Initialize filesystem if not already done
  const fs = await getFileSystem(fsOptions);

  const appJsonFile = `${appDir}${path.sep}package.json`;
  const s: string = await fs.readFile(appJsonFile);
  const appSpec: ApplicationSpec = JSON.parse(s);
  const alFiles: Array<string> = new Array<string>();
  const directoryContents = await fs.readdir(appDir);
  let lastModuleLoaded: string = '';
  async function cont2() {
    if (!directoryContents) {
      console.error(chalk.red(`Directory ${appDir} does not exist or is empty.`));
      return;
    }
    directoryContents.forEach(file => {
      if (path.extname(file) == '.al') {
        alFiles.push(appDir + path.sep + file);
      }
    });
    for (let i = 0; i < alFiles.length; ++i) {
      lastModuleLoaded = (await loadModule(alFiles[i], fsOptions)).name;
    }
    if (callback) await callback(appSpec);
  }
  if (appSpec.dependencies != undefined) {
    if (isNodeEnv) {
      // Only run shell commands in Node.js environment
      for (const [depName, depVer] of Object.entries(appSpec.dependencies)) {
        runShellCommand(`npm install ${depName}@${depVer}`, undefined, cont2);
      }
    } else {
      // In non-Node environments, log a warning and continue
      console.warn('Dependencies cannot be installed in non-Node.js environments');
      await cont2();
    }
  } else {
    await cont2();
  }
  return appSpec.name || lastModuleLoaded;
}

/**
 * Load a module from a file
 * @param fileName Path to the file containing the module
 * @param fsOptions Optional configuration for the filesystem
 * @param callback Function to be called after loading the module
 * @returns Promise that resolves when the module is loaded
 */
export async function load(
  fileName: string,
  fsOptions?: any,
  callback?: Function
): Promise<ApplicationSpec> {
  let result: string = '';
  if (path.basename(fileName).endsWith('.al')) {
    result = (await loadModule(fileName, fsOptions, callback)).name;
  } else {
    result = await loadApp(fileName, fsOptions, callback);
  }
  return { name: result, version: '0.0.1' };
}

/**
 * Removes all existing user-modules and loads the specified module-file.
 * @param fileName Path to the file containing the module
 * @param fsOptions Optional configuration for the filesystem
 * @param callback Function to be called after loading the module
 * @returns Promise that resolves when the module is loaded
 */
export async function flushAllAndLoad(
  fileName: string,
  fsOptions?: any,
  callback?: Function
): Promise<ApplicationSpec> {
  getUserModuleNames().forEach((n: string) => {
    removeModule(n);
  });
  return await load(fileName, fsOptions, callback);
}

export async function loadCoreModules() {
  if (CoreModules.length == 0) {
    registerCoreModules();
  }
  for (let i = 0; i < CoreModules.length; ++i) {
    await internModule(await parseModule(CoreModules[i]));
  }
}

async function loadModule(fileName: string, fsOptions?: any, callback?: Function): Promise<Module> {
  // Initialize filesystem if not already done
  const fs = await getFileSystem(fsOptions);

  const fsAdapter = getFsAdapter(fs);

  // Create services with our custom filesystem adapter
  const services = createAgentlangServices({
    fileSystemProvider: _services => fsAdapter,
  }).Agentlang;

  // Extract the AST node
  const module = await extractAstNode<ModuleDefinition>(fileName, services);
  const result: Module = await internModule(module);
  console.log(chalk.green(`Module ${chalk.bold(result.name)} loaded`));
  logger.info(`Module ${result.name} loaded`);
  if (callback) {
    await callback();
  }
  return result;
}

let cachedFsAdapter: any = null;

function getFsAdapter(fs: any) {
  if (cachedFsAdapter == null) {
    // Create an adapter to make our filesystem compatible with Langium
    cachedFsAdapter = {
      // Read file contents as text
      readFile: async (uri: URI) => {
        return await readFile(uri);
      },

      // List directory contents with proper metadata
      readDirectory: async (uri: URI) => {
        const result = await readdir(uri);
        const dirPath = toFsPath(uri);

        // Convert string[] to FileSystemNode[] as required by Langium
        return Promise.all(
          result.map(async name => {
            const filePath = dirPath.endsWith('/') ? `${dirPath}${name}` : `${dirPath}/${name}`;
            const stats = await fs
              .stat(filePath)
              .catch(() => ({ isFile: () => true, isDirectory: () => false }));

            return {
              uri: URI.file(filePath),
              isFile: stats.isFile?.() ?? true,
              isDirectory: stats.isDirectory?.() ?? false,
            };
          })
        );
      },
    };
  }
  return cachedFsAdapter;
}

function setRbacForEntity(entity: Entity, rbacSpec: RbacSpecDefinition) {
  const rbac: RbacSpecification[] = new Array<RbacSpecification>();
  rbacSpec.specEntries.forEach((specEntries: RbacSpecEntries) => {
    const rs: RbacSpecification = new RbacSpecification().setResource(
      makeFqName(entity.moduleName, entity.name)
    );
    specEntries.entries.forEach((spec: RbacSpecEntry) => {
      if (spec.allow) {
        rs.setPermissions(
          spec.allow.oprs.map((v: RbacOpr) => {
            return v.value;
          })
        );
      } else if (spec.role) {
        rs.setRoles(spec.role.roles);
      } else if (spec.expr) {
        rs.setExpression(spec.expr.lhs, spec.expr.rhs);
      }
    });
    rbac.push(rs);
  });
  if (rbac.length > 0) {
    const f = async () => {
      for (let i = 0; i < rbac.length; ++i) {
        await createRolesAndPermissions(rbac[i]);
      }
    };
    registerInitFunction(f);
    entity.setRbacSpecifications(rbac);
  }
}

async function createRolesAndPermissions(rbacSpec: RbacSpecification) {
  const roles: Array<string> = [...rbacSpec.roles];
  const env: Environment = new Environment();
  async function f() {
    for (let i = 0; i < roles.length; ++i) {
      const r = roles[i];
      await createRole(r, env);
      if (rbacSpec.hasPermissions() && rbacSpec.hasResource()) {
        await createPermission(
          `${r}_permission_${rbacSpec.resource}`,
          r,
          rbacSpec.resource,
          rbacSpec.hasCreatePermission(),
          rbacSpec.hasReadPermission(),
          rbacSpec.hasUpdatePermission(),
          rbacSpec.hasDeletePermission(),
          env
        );
      }
    }
  }
  await env.callInTransaction(f);
}

function addEntityFromDef(def: EntityDefinition, moduleName: string): Entity {
  const entity = addEntity(def.name, moduleName, def.schema, maybeExtends(def.extends));
  const rbacSpec = findRbacSchema(def.schema);
  if (rbacSpec) {
    setRbacForEntity(entity, rbacSpec);
  }
  return entity;
}

export function addSchemaFromDef(def: SchemaDefinition, moduleName: string): Record {
  let result: Record | undefined;
  if (isEntityDefinition(def)) {
    result = addEntityFromDef(def, moduleName);
  } else if (isEventDefinition(def)) {
    result = addEvent(def.name, moduleName, def.schema, maybeExtends(def.extends));
  } else {
    result = addRecord(def.name, moduleName, def.schema, maybeExtends(def.extends));
  }
  return result;
}

export function addRelationshipFromDef(
  def: RelationshipDefinition,
  moduleName: string
): Relationship {
  return addRelationship(def.name, def.type, def.nodes, moduleName, def.schema, def.properties);
}

export function addWorkflowFromDef(def: WorkflowDefinition, moduleName: string): Workflow {
  return addWorkflow(def.name, moduleName, def.statements);
}

const StandaloneStatements = new Map<string, Statement[]>();

function addStandaloneStatement(stmt: Statement, moduleName: string) {
  let stmts: Array<Statement> | undefined = StandaloneStatements.get(moduleName);
  if (stmts == undefined) {
    stmts = new Array<Statement>();
  }
  stmts.push(stmt);
  if (!StandaloneStatements.has(moduleName)) {
    StandaloneStatements.set(moduleName, stmts);
  }
}

export async function runStandaloneStatements() {
  if (StandaloneStatements.size > 0) {
    await GlobalEnvironment.callInTransaction(async () => {
      const ks = [...StandaloneStatements.keys()];
      for (let i = 0; i < ks.length; ++i) {
        const moduleName = ks[i];
        const stmts: Statement[] | undefined = StandaloneStatements.get(moduleName);
        if (stmts) {
          const oldModule = GlobalEnvironment.switchActiveModuleName(moduleName);
          await evaluateStatements(stmts, GlobalEnvironment);
          GlobalEnvironment.switchActiveModuleName(oldModule);
        }
      }
      logger.info(`Init eval result: ${GlobalEnvironment.getLastResult().toString()}`);
    });
    StandaloneStatements.clear();
  }
}

async function addAgentDefinition(def: AgentDefinition, moduleName: string) {
  let llmName: string | undefined = undefined;
  const name = def.name;
  const attrsStrs = new Array<string>();
  attrsStrs.push(`name "${name}"`);
  const attrs = newInstanceAttributes();
  def.body.attributes.forEach((sa: SetAttribute) => {
    let v: any = undefined;
    if (isLiteral(sa.value)) {
      v = sa.value.str || sa.value.id || sa.value.num;
      if (v == undefined) {
        v = sa.value.bool;
      }
    }
    if (v == undefined) {
      throw new Error(`Cannot initialize agent ${name}, only literals can be set for attributes`);
    }
    if (llmName == undefined && sa.name == 'llm') {
      llmName = v;
    }
    if (isLiteral(sa.value) && (sa.value.str || sa.value.id)) {
      v = `"${v}"`;
    }
    attrsStrs.push(`${sa.name} ${v}`);
    attrs.set(sa.name, v);
  });
  const createAgent = `{${CoreAIModuleName}/${AgentEntityName} {
    ${attrsStrs.join(',')}
  }}`;
  let wf = createAgent;
  if (llmName) {
    wf = `upsert {${CoreAIModuleName}/${LlmEntityName} {name "${llmName}"}}; ${wf}`;
  }
  (await parseWorkflow(`workflow A {${wf}}`)).statements.forEach((stmt: Statement) => {
    addStandaloneStatement(stmt, moduleName);
  });
  addAgent(def.name, attrs, moduleName);
}

export async function addFromDef(def: Definition, moduleName: string) {
  if (isEntityDefinition(def)) addSchemaFromDef(def, moduleName);
  else if (isEventDefinition(def)) addSchemaFromDef(def, moduleName);
  else if (isRecordDefinition(def)) addSchemaFromDef(def, moduleName);
  else if (isRelationshipDefinition(def)) addRelationshipFromDef(def, moduleName);
  else if (isWorkflowDefinition(def)) addWorkflowFromDef(def, moduleName);
  else if (isAgentDefinition(def)) await addAgentDefinition(def, moduleName);
  else if (isStandaloneStatement(def)) addStandaloneStatement(def.stmt, moduleName);
}

export async function parseAndIntern(code: string, moduleName?: string) {
  if (moduleName && !isModule(moduleName)) {
    throw new Error(`Module not found - ${moduleName}`);
  }
  const r = await parse(moduleName ? `module ${moduleName} ${code}` : code);
  if (r.parseResult.lexerErrors.length > 0) {
    throw new Error(`Lexer errors: ${r.parseResult.lexerErrors.join('\n')}`);
  }
  if (r.parseResult.parserErrors.length > 0) {
    throw new Error(`Parser errors: ${r.parseResult.parserErrors.join('\n')}`);
  }
  await internModule(r.parseResult.value);
}

export async function internModule(module: ModuleDefinition): Promise<Module> {
  const mn = module.name;
  const r = addModule(mn);
  module.imports.forEach(async (imp: Import) => {
    await importModule(imp.path, imp.name);
  });
  for (let i = 0; i < module.defs.length; ++i) {
    const def = module.defs[i];
    await addFromDef(def, mn);
  }
  return r;
}
