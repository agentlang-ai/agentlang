import chalk from 'chalk';
import { createAgentlangServices } from '../language/agentlang-module.js';
import {
  Import,
  RbacSpecEntries,
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
  isResolverDefinition,
  ResolverDefinition,
  ResolverMethodSpec,
  AgentPropertyDef,
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
  escapeSpecialChars,
  findRbacSchema,
  isString,
  makeFqName,
  maybeExtends,
  registerInitFunction,
} from './util.js';
import { getFileSystem, toFsPath, readFile, readdir, exists } from '../utils/fs-utils.js';
import { URI } from 'vscode-uri';
import { AstNode, LangiumCoreServices, LangiumDocument } from 'langium';
import { isNodeEnv, path } from '../utils/runtime.js';
import { CoreModules, registerCoreModules } from './modules/core.js';
import { maybeGetValidationErrors, parse, parseModule, parseWorkflow } from '../language/parser.js';
import { logger } from './logger.js';
import { Environment, evaluateStatements, GlobalEnvironment } from './interpreter.js';
import { createPermission, createRole } from './modules/auth.js';
import { AgentEntityName, CoreAIModuleName, LlmEntityName } from './modules/ai.js';
import { GenericResolver, GenericResolverMethods } from './resolvers/interface.js';
import { registerResolver, setResolver } from './resolvers/registry.js';
import { Config, ConfigSchema, setAppConfig } from './state.js';
import { getModuleFn, importModule } from './jsmodules.js';
import { SetSubscription } from './defs.js';
import { ExtendedFileSystem } from '../utils/fs/interfaces.js';
import z from 'zod';

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
      throw new Error(errorMsg);
    }
  } else if (!isNodeEnv && typeof fileName === 'string') {
    const fullFilePath = path.resolve(fileName);

    const fileExists = await exists(fullFilePath);

    if (!fileExists) {
      throw new Error(`File ${fileName} does not exist.`);
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
  const errs = maybeGetValidationErrors(document);

  if (errs) {
    const errorMsg = `${errs.join('\n')}`;
    throw new Error(errorMsg);
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

async function getAllModules(
  dir: string,
  fs: ExtendedFileSystem,
  drill: boolean = true
): Promise<string[]> {
  let alFiles = new Array<string>();
  if (!(await fs.exists(dir))) {
    return alFiles;
  }
  const directoryContents = await fs.readdir(dir);
  for (let i = 0; i < directoryContents.length; ++i) {
    const file = directoryContents[i];
    if (path.extname(file).toLowerCase() == '.al') {
      alFiles.push(dir + path.sep + file);
    } else if (drill) {
      const fullPath = dir + path.sep + file;
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        alFiles = alFiles.concat(await getAllModules(fullPath, fs));
      }
    }
  }
  return alFiles;
}

async function loadApp(appDir: string, fsOptions?: any, callback?: Function): Promise<string> {
  // Initialize filesystem if not already done
  const fs = await getFileSystem(fsOptions);

  const appJsonFile = `${appDir}${path.sep}package.json`;
  const s: string = await fs.readFile(appJsonFile);
  const appSpec: ApplicationSpec = JSON.parse(s);
  let lastModuleLoaded: string = '';
  async function cont2() {
    const fls01 = await getAllModules(appDir, fs, false);
    const fls02 = await getAllModules(appDir + path.sep + 'src', fs);
    const alFiles0 = fls01.concat(fls02);
    const configFile = `${appDir}/config.al`;
    const alFiles = alFiles0.filter((s: string) => {
      return s != configFile;
    });
    for (let i = 0; i < alFiles.length; ++i) {
      lastModuleLoaded = (await loadModule(alFiles[i], fsOptions)).name;
    }
    if (callback) await callback(appSpec);
  }
  if (appSpec.dependencies != undefined) {
    for (const [depName, _] of Object.entries(appSpec.dependencies)) {
      try {
        const depDirName = `./node_modules/${depName}`;
        const fls01 = await fs.readdir(depDirName);
        const srcDir = depDirName + path.sep + 'src';
        const hasSrc = await fs.exists(srcDir);
        const files = hasSrc ? fls01.concat(await fs.readdir(srcDir)) : fls01;
        if (
          files.find(file => {
            return path.extname(file).toLowerCase() == '.al';
          })
        ) {
          await loadApp(depDirName, fsOptions);
        }
      } catch (error) {
        logger.error(`Error loading dependency ${depName}: ${error}`);
      }
    }
  }
  await cont2();
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

export async function loadAppConfig(configDir: string): Promise<Config> {
  let cfgObj: any = undefined;
  const fs = await getFileSystem();
  const alCfgFile = `${configDir}/config.al`;
  if (await fs.exists(alCfgFile)) {
    const cfgPats = await fs.readFile(alCfgFile);
    const cfgWf = `workflow createConfig{\n${cfgPats}}`;
    const wf = await parseWorkflow(cfgWf);
    const env = new Environment('config.env');
    await evaluateStatements(wf.statements, env);
    cfgObj = env.getLastResult();
  }
  try {
    const cfg = cfgObj
      ? configFromObject(cfgObj)
      : await loadRawConfig(`${configDir}/app.config.json`);
    return setAppConfig(cfg);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      console.log(chalk.red('Config validation failed:'));
      err.errors.forEach((error: any, index: number) => {
        console.log(chalk.red(`  ${index + 1}. ${error.path.join('.')}: ${error.message}`));
      });
    } else {
      console.log(`Config loading failed: ${err}`);
    }
    throw err;
  }
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
  const result: Module = await internModule(module, fileName);
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
  const rbac: RbacSpecification[] = rbacSpec.specEntries.map((rs: RbacSpecEntries) => {
    return RbacSpecification.from(rs).setResource(makeFqName(entity.moduleName, entity.name));
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
  return addWorkflow(def.name || '', moduleName, def.statements, def.header);
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
      logger.debug(`Init eval result: ${GlobalEnvironment.getLastResult()}`);
    });
    StandaloneStatements.clear();
  }
}

async function addAgentDefinition(def: AgentDefinition, moduleName: string) {
  let llmName: string | undefined = undefined;
  const name = def.name;
  let hasUserLlm = false;
  const attrsStrs = new Array<string>();
  attrsStrs.push(`name "${name}"`);
  const attrs = newInstanceAttributes();
  def.body?.attributes.forEach((apdef: AgentPropertyDef) => {
    let v: any = undefined;
    if (apdef.value.array) {
      v = apdef.value.array.vals
        .map((stmt: Statement) => {
          if (stmt.pattern.expr && isLiteral(stmt.pattern.expr)) {
            const s = stmt.pattern.expr.str || stmt.pattern.expr.id || stmt.pattern.expr.ref;
            if (s == undefined) {
              throw new Error(
                `Only arrays of string-literals or identifiers should be passed to agent ${name}`
              );
            }
            return s;
          } else {
            throw new Error(`Invalid value in array passed to agent ${name}`);
          }
        })
        .join(',');
    } else {
      v = apdef.value.str || apdef.value.id || apdef.value.ref || apdef.value.num;
      if (v == undefined) {
        v = apdef.value.bool;
      }
    }
    if (v == undefined) {
      throw new Error(`Cannot initialize agent ${name}, only literals can be set for attributes`);
    }
    if (llmName == undefined && apdef.name == 'llm') {
      llmName = v;
      hasUserLlm = true;
    }
    const ov = v;
    if (apdef.value.id || apdef.value.ref || apdef.value.array) {
      v = `"${v}"`;
    } else if (apdef.value.str) {
      v = `"${escapeSpecialChars(v)}"`;
    }
    attrsStrs.push(`${apdef.name} ${v}`);
    attrs.set(apdef.name, ov);
  });
  if (!attrs.has('llm')) {
    llmName = `${name}_llm`;
    attrsStrs.push(`llm "${llmName}"`);
    if (hasUserLlm) attrs.set('llm', llmName);
  }
  const createAgent = `{${CoreAIModuleName}/${AgentEntityName} {
    ${attrsStrs.join(',')}
  }, @upsert}`;
  let wf = createAgent;
  if (llmName) {
    // Determine the appropriate service based on available API keys
    let service = 'openai'; // default
    if (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      service = 'anthropic';
    } else if (process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY) {
      // When both are available, prefer Anthropic to match getAvailableProvider() priority
      service = 'anthropic';
    }
    wf = `{${CoreAIModuleName}/${LlmEntityName} {name "${llmName}", service "${service}"}, @upsert}; ${wf}`;
  }
  (await parseWorkflow(`workflow A {${wf}}`)).statements.forEach((stmt: Statement) => {
    addStandaloneStatement(stmt, moduleName);
  });
  addAgent(def.name, attrs, moduleName);
}

function addResolverDefinition(def: ResolverDefinition, moduleName: string) {
  const resolverName = `${moduleName}/${def.name}`;
  const paths = def.paths;
  if (paths.length == 0) {
    logger.warn(`Resolver has no associated paths - ${resolverName}`);
    return;
  }
  registerInitFunction(() => {
    const methods = new Map<string, Function>();
    let subsFn: Function | undefined;
    let subsEvent: string | undefined;
    def.methods.forEach((spec: ResolverMethodSpec) => {
      const n = spec.key.name;
      if (n == 'subscribe') {
        subsFn = asResolverFn(spec.fn.name);
      } else if (n == 'onSubscription') {
        subsEvent = spec.fn.name;
      } else {
        methods.set(n, asResolverFn(spec.fn.name));
      }
    });
    const methodsObj = Object.fromEntries(methods.entries()) as GenericResolverMethods;
    const resolver = new GenericResolver(resolverName, methodsObj);
    registerResolver(resolverName, () => {
      return resolver;
    });
    paths.forEach((path: string) => {
      setResolver(path, resolverName);
    });
    if (subsFn) {
      resolver.subs = {
        subscribe: subsFn,
      };
      if (subsEvent) SetSubscription(subsEvent, resolverName);
      resolver.subscribe();
    }
  });
}

function asResolverFn(fname: string): Function {
  let fn = getModuleFn(fname);
  if (fn) return fn;
  fn = eval(fname);
  if (!(fn instanceof Function)) {
    throw new Error(`${fname} is not a function`);
  }
  return fn as Function;
}

export async function addFromDef(def: Definition, moduleName: string) {
  if (isEntityDefinition(def)) addSchemaFromDef(def, moduleName);
  else if (isEventDefinition(def)) addSchemaFromDef(def, moduleName);
  else if (isRecordDefinition(def)) addSchemaFromDef(def, moduleName);
  else if (isRelationshipDefinition(def)) addRelationshipFromDef(def, moduleName);
  else if (isWorkflowDefinition(def)) addWorkflowFromDef(def, moduleName);
  else if (isAgentDefinition(def)) await addAgentDefinition(def, moduleName);
  else if (isStandaloneStatement(def)) addStandaloneStatement(def.stmt, moduleName);
  else if (isResolverDefinition(def)) addResolverDefinition(def, moduleName);
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

export async function internModule(
  module: ModuleDefinition,
  moduleFileName?: string
): Promise<Module> {
  const mn = module.name;
  const r = addModule(mn);
  module.imports.forEach(async (imp: Import) => {
    await importModule(imp.path, imp.name, moduleFileName);
  });
  for (let i = 0; i < module.defs.length; ++i) {
    const def = module.defs[i];
    await addFromDef(def, mn);
  }
  return r;
}

const JS_PREFIX = '#js';

function preprocessRawConfig(rawConfig: any): any {
  const keys = Object.keys(rawConfig);
  keys.forEach((k: any) => {
    const v = rawConfig[k];
    if (isString(v) && v.startsWith(JS_PREFIX)) {
      const s = v.substring(3).trim();
      rawConfig[k] = eval(s);
    } else if (typeof v == 'object') {
      preprocessRawConfig(v);
    }
  });
  return rawConfig;
}

export async function loadRawConfig(
  configFileName: string,
  validate: boolean = true,
  fsOptions?: any
): Promise<any> {
  const fs = await getFileSystem(fsOptions);
  if (await fs.exists(configFileName)) {
    let rawConfig = preprocessRawConfig(JSON.parse(await fs.readFile(configFileName)));
    if (validate) {
      rawConfig = ConfigSchema.parse(rawConfig);
    }
    return rawConfig;
  } else {
    return { service: { port: 8080 } };
  }
}

export function configFromObject(cfgObj: any, validate: boolean = true): any {
  const rawConfig = preprocessRawConfig(cfgObj);
  if (validate) {
    return ConfigSchema.parse(rawConfig);
  }
  return rawConfig;
}

export function generateRawConfig(configObj: any): string {
  return JSON.stringify(configObj);
}
