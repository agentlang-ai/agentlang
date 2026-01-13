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
  GenericPropertyDef,
  isLiteral,
  ArrayLiteral,
  MapEntry,
  Expr,
  FlowDefinition,
  isFlowDefinition,
  Literal,
  isDecisionDefinition,
  DecisionDefinition,
  CaseEntry,
  isScenarioDefinition,
  ScenarioDefinition,
  DirectiveDefinition,
  GlossaryEntryDefinition,
  isDirectiveDefinition,
  isGlossaryEntryDefinition,
  isPublicWorkflowDefinition,
  isPublicAgentDefinition,
  isPublicEventDefinition,
  AgentXtraAttribute,
  If,
  isRetryDefinition,
  RetryDefinition,
  SetAttribute,
  CrudMap,
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
  fetchModule,
  Retry,
  addGlobalRetry,
} from './module.js';
import {
  asStringLiteralsMap,
  escapeSpecialChars,
  findRbacSchema,
  isFqName,
  makeFqName,
  maybeExtends,
  objectAsString,
  preprocessRawConfig,
  registerInitFunction,
  rootRef,
  ScratchModuleName,
} from './util.js';
import { getFileSystem, toFsPath, readFile, readdir, exists } from '../utils/fs-utils.js';
import { URI } from 'vscode-uri';
import { AstNode, LangiumCoreServices, LangiumDocument } from 'langium';
import { isNodeEnv, path } from '../utils/runtime.js';
import { CoreModules, registerCoreModules } from './modules/core.js';
import {
  canParse,
  introspectIf,
  maybeGetValidationErrors,
  maybeRaiseParserErrors,
  parse,
  parseModule,
  parseStatement,
  parseWorkflow,
} from '../language/parser.js';
import { logger } from './logger.js';
import { Environment, evaluateStatements, GlobalEnvironment } from './interpreter.js';
import { createPermission, createRole } from './modules/auth.js';
import { AgentEntityName, CoreAIModuleName, LlmEntityName } from './modules/ai.js';
import { getDefaultLLMService } from './agents/registry.js';
import { GenericResolver, GenericResolverMethods } from './resolvers/interface.js';
import { registerResolver, setResolver } from './resolvers/registry.js';
import { Config, ConfigSchema, setAppConfig } from './state.js';
import { getModuleFn, importModule } from './jsmodules.js';
import { SetSubscription } from './defs.js';
import { ExtendedFileSystem } from '../utils/fs/interfaces.js';
import z from 'zod';
import { registerAgentFlow, registerFlow } from './agents/flows.js';
import {
  addAgentDirective,
  addAgentGlossaryEntry,
  addAgentScenario,
  AgentCondition,
  AgentGlossaryEntry,
  AgentScenario,
  registerAgentDirectives,
  registerAgentGlossary,
  registerAgentResponseSchema,
  registerAgentScenarios,
  registerAgentScratchNames,
} from './agents/common.js';

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

let CurrentAppSpec: ApplicationSpec = DefaultAppSpec;

export function getAppSpec(): ApplicationSpec {
  return CurrentAppSpec;
}

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

let dependenciesCallback: Function | undefined = undefined;

export function setDependenciesCallback(cb: Function) {
  dependenciesCallback = cb;
}

export type DependencyInfo = {
  appName: string;
  url: string;
};

async function loadApp(appDir: string, fsOptions?: any, callback?: Function): Promise<string> {
  // Initialize filesystem if not already done
  const fs = await getFileSystem(fsOptions);

  const appJsonFile = `${appDir}${path.sep}package.json`;
  const s: string = await fs.readFile(appJsonFile);
  const appSpec: ApplicationSpec = JSON.parse(s);
  CurrentAppSpec = appSpec;
  if (dependenciesCallback !== undefined && appSpec.dependencies) {
    const aldeps = new Array<DependencyInfo>();
    for (const [k, v] of Object.entries(appSpec.dependencies)) {
      if (typeof v === 'string' && v.startsWith('git+http')) {
        aldeps.push({
          appName: k,
          url: v,
        });
      }
    }
    if (aldeps.length > 0) {
      await dependenciesCallback(aldeps);
    }
  }
  let lastModuleLoaded: string = '';
  async function cont2() {
    const fls01 = await getAllModules(appDir, fs, false);
    const fls02 = await getAllModules(appDir + path.sep + 'src', fs);
    const alFiles0 = fls01.concat(fls02);
    const configFile = `${appDir}${path.sep}config.al`;
    const alFiles = alFiles0.filter((s: string) => {
      return s != configFile;
    });
    for (let i = 0; i < alFiles.length; ++i) {
      lastModuleLoaded = (await loadModule(alFiles[i], fsOptions)).name;
    }
    if (callback) await callback(appSpec);
  }
  if (appSpec.dependencies !== undefined) {
    for (const [depName, _] of Object.entries(appSpec.dependencies)) {
      try {
        // In browser (with virtual filesystem), use absolute path relative to appDir
        // In Node.js, use relative path from current working directory
        const isBrowser = fsOptions && fsOptions.name;
        const depDirName = isBrowser
          ? `${appDir}${path.sep}node_modules${path.sep}${depName}`
          : `./node_modules/${depName}`;

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

export function flushAllModules() {
  getUserModuleNames().forEach((n: string) => {
    removeModule(n);
  });
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
  flushAllModules();
  return await load(fileName, fsOptions, callback);
}

async function evaluateConfigPatterns(cfgPats: string): Promise<any> {
  const cfgWf = `workflow createConfig{\n${cfgPats}}`;
  const wf = await parseWorkflow(cfgWf);
  const cfgStmts = new Array<Statement>();
  const initInsts = new Array<Statement>();
  const deleted = new Set<string>();
  for (let i = 0; i < wf.statements.length; ++i) {
    const stmt: Statement = wf.statements[i];
    if (stmt.pattern.crudMap) {
      if (!deleted.has(stmt.pattern.crudMap?.name)) {
        initInsts.push(await makeDeleteAllConfigStatement(stmt.pattern.crudMap));
        deleted.add(stmt.pattern.crudMap.name);
      }
      initInsts.push(stmt);
    } else {
      cfgStmts.push(stmt);
    }
  }
  if (initInsts.length > 0) {
    registerInitFunction(async () => {
      const env = new Environment('config.insts.env');
      try {
        await evaluateStatements(initInsts, env);
        await env.commitAllTransactions();
      } catch (reason: any) {
        await env.rollbackAllTransactions();
        console.error(`Failed to initialize config instances: ${reason}`);
      }
    });
  }
  if (cfgStmts.length > 0) {
    const env = new Environment('config.env');
    await evaluateStatements(cfgStmts, env);
    return env.getLastResult();
  }
  return undefined;
}

function isStringContent(content: string): boolean {
  return content.includes('{');
}

export async function loadAppConfig(configDirOrContent: string): Promise<Config> {
  const stringContent = isStringContent(configDirOrContent);

  let cfgObj: any = undefined;

  if (stringContent) {
    if (canParse(configDirOrContent)) {
      cfgObj = await evaluateConfigPatterns(configDirOrContent);
    }
  } else {
    const fs = await getFileSystem();
    const alCfgFile = `${configDirOrContent}${path.sep}config.al`;
    if (await fs.exists(alCfgFile)) {
      const cfgPats = await fs.readFile(alCfgFile);
      if (canParse(cfgPats)) {
        cfgObj = await evaluateConfigPatterns(cfgPats);
      }
    }
  }

  try {
    let cfg = cfgObj
      ? await configFromObject(cfgObj)
      : await loadRawConfig(`${configDirOrContent}${path.sep}app.config.json`);

    const envAppConfig = typeof process !== 'undefined' ? process.env.APP_CONFIG : undefined;
    if (envAppConfig) {
      const envConfig = JSON.parse(envAppConfig);
      cfg = { ...cfg, ...envConfig };
    }
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

async function makeDeleteAllConfigStatement(crudMap: CrudMap): Promise<Statement> {
  const n = crudMap.name;
  const p = `purge {${n}? {}}`;
  return await parseStatement(p);
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
  console.log(`loading ${fileName}`);
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
  if (cachedFsAdapter === null) {
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

function addSchemaFromDef(
  def: SchemaDefinition,
  moduleName: string,
  ispub: boolean = false
): Record {
  let result: Record | undefined;
  if (isEntityDefinition(def)) {
    result = addEntityFromDef(def, moduleName);
  } else if (isEventDefinition(def)) {
    result = addEvent(def.name, moduleName, def.schema, maybeExtends(def.extends));
  } else if (isRecordDefinition(def)) {
    result = addRecord(def.name, moduleName, def.schema, maybeExtends(def.extends));
  } else {
    throw new Error(`Cannot add schema definition in module ${moduleName} for ${def}`);
  }
  if (ispub) {
    result.setPublic(true);
  }
  return result;
}

export function addRelationshipFromDef(
  def: RelationshipDefinition,
  moduleName: string
): Relationship {
  return addRelationship(def.name, def.type, def.nodes, moduleName, def.schema, def.properties);
}

export function addWorkflowFromDef(
  def: WorkflowDefinition,
  moduleName: string,
  ispub: boolean = false
): Workflow {
  return addWorkflow(def.name || '', moduleName, def.statements, def.header, ispub);
}

const StandaloneStatements = new Map<string, Statement[]>();

function addStandaloneStatement(stmt: Statement, moduleName: string, userDefined = true) {
  let stmts: Array<Statement> | undefined = StandaloneStatements.get(moduleName);
  if (stmts === undefined) {
    stmts = new Array<Statement>();
  }
  stmts.push(stmt);
  if (!StandaloneStatements.has(moduleName)) {
    StandaloneStatements.set(moduleName, stmts);
  }
  if (userDefined) {
    const m = fetchModule(moduleName);
    m.addStandaloneStatement(stmt);
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

function processAgentDirectives(agentName: string, value: Literal): AgentCondition[] | undefined {
  if (value.array) {
    const conds = new Array<AgentCondition>();
    value.array.vals.forEach((stmt: Statement) => {
      const expr = stmt.pattern.expr;
      if (expr && isLiteral(expr) && expr.map) {
        let cond: string | undefined;
        let then: string | undefined;
        expr.map.entries.forEach((me: MapEntry) => {
          const v = isLiteral(me.value) ? me.value.str : undefined;
          if (v) {
            if (me.key.str == 'if') {
              cond = v;
            } else if (me.key.str == 'then') {
              then = v;
            }
          }
        });
        if (cond && then) {
          conds?.push({ if: cond, then, internal: true, ifPattern: undefined });
        } else {
          throw new Error(`Invalid condition spec in agent ${agentName}`);
        }
      }
    });
    return conds;
  }
  return undefined;
}

function processAgentScenarios(agentName: string, value: Literal): AgentScenario[] | undefined {
  if (value.array) {
    const scenarios = new Array<AgentScenario>();
    value.array.vals.forEach((stmt: Statement) => {
      const expr = stmt.pattern.expr;
      if (expr && isLiteral(expr) && expr.map) {
        let user: string | undefined;
        let ai: string | undefined;
        expr.map.entries.forEach((me: MapEntry) => {
          let v = isLiteral(me.value) ? me.value.str : undefined;
          if (v === undefined) {
            v = me.value.$cstNode?.text;
          }
          if (v) {
            if (me.key.str == 'user') {
              user = v;
            } else if (me.key.str == 'ai') {
              ai = v;
            }
          }
        });
        if (user && ai) {
          const internal = true;
          scenarios.push({ user, ai, internal, ifPattern: undefined });
        } else {
          throw new Error(`Invalid scenario spec in agent ${agentName}`);
        }
      }
    });
    return scenarios;
  }
  return undefined;
}

function processAgentGlossary(agentName: string, value: Literal): AgentGlossaryEntry[] | undefined {
  if (value.array) {
    const gls = new Array<AgentGlossaryEntry>();
    value.array.vals.forEach((stmt: Statement) => {
      const expr = stmt.pattern.expr;
      if (expr && isLiteral(expr) && expr.map) {
        let name: string | undefined;
        let meaning: string | undefined;
        let synonyms: string | undefined;
        expr.map.entries.forEach((me: MapEntry) => {
          const v = isLiteral(me.value) ? me.value.str : undefined;
          if (v) {
            if (me.key.str == 'name') {
              name = v;
            } else if (me.key.str == 'meaning') {
              meaning = v;
            } else if (me.key.str == 'synonyms') {
              synonyms = v;
            }
          }
        });
        if (name && meaning) {
          const internal = true;
          gls.push({ name, meaning, synonyms, internal });
        } else {
          throw new Error(`Invalid glossary spec in agent ${agentName}`);
        }
      }
    });
    return gls;
  }
  return undefined;
}

function processAgentScratchNames(agentName: string, value: Literal): string[] | undefined {
  if (value.array) {
    const scratch = new Array<string>();
    value.array.vals.forEach((stmt: Statement) => {
      const expr = stmt.pattern.expr;
      if (expr && isLiteral(expr) && (expr.id || expr.str)) {
        scratch.push(expr.id || expr.str || '');
      }
    });
    return scratch;
  }
  return undefined;
}

async function addAgentDefinition(
  def: AgentDefinition,
  moduleName: string,
  ispub: boolean = false
) {
  let llmName: string | undefined = undefined;
  const name = def.name;
  const attrsStrs = new Array<string>();
  attrsStrs.push(`name "${name}"`);
  const attrs = newInstanceAttributes();
  attrsStrs.push(`moduleName "${moduleName}"`);
  attrs.set('moduleName', moduleName);
  let conds: AgentCondition[] | undefined = undefined;
  let scenarios: AgentScenario[] | undefined = undefined;
  let glossary: AgentGlossaryEntry[] | undefined = undefined;
  let responseSchema: string | undefined = undefined;
  let scratchNames: string[] | undefined = undefined;
  def.body?.attributes.forEach((apdef: GenericPropertyDef) => {
    if (apdef.name == 'flows') {
      let fnames: string | undefined = undefined;
      if (apdef.value.array) {
        fnames = processAgentArray(apdef.value.array, name);
      } else {
        fnames = apdef.value.id || apdef.value.str;
      }
      if (fnames) {
        fnames.split(',').forEach((n: string) => {
          n = n.trim();
          const fqn = isFqName(n) ? n : `${moduleName}/${n}`;
          registerAgentFlow(name, fqn);
        });
        attrsStrs.push(`type "flow-exec"`);
        attrs.set('type', 'flow-exec');
        attrsStrs.push(`flows "${fnames}"`);
        attrs.set('flows', fnames);
      } else {
        throw new Error(`Invalid flows list in agent ${name}`);
      }
    } else if (apdef.name == 'directives') {
      conds = processAgentDirectives(name, apdef.value);
    } else if (apdef.name == 'scenarios') {
      scenarios = processAgentScenarios(name, apdef.value);
    } else if (apdef.name == 'glossary') {
      glossary = processAgentGlossary(name, apdef.value);
    } else if (apdef.name == 'responseSchema') {
      const s = apdef.value.id || apdef.value.ref || apdef.value.str;
      if (s) {
        if (isFqName(s)) {
          responseSchema = s;
        } else {
          responseSchema = makeFqName(moduleName, s);
        }
      } else {
        throw new Error(`responseSchema must be a valid name in agent ${name}`);
      }
    } else if (apdef.name == 'scratch') {
      scratchNames = processAgentScratchNames(name, apdef.value);
    } else {
      let v: any = undefined;
      if (apdef.value.array) {
        v = processAgentArray(apdef.value.array, name);
      } else {
        v = apdef.value.str || apdef.value.id || apdef.value.ref || apdef.value.num;
        if (v === undefined) {
          v = apdef.value.bool;
        }
      }
      if (v === undefined) {
        throw new Error(`Cannot initialize agent ${name}, only literals can be set for attributes`);
      }
      if (apdef.name == 'llm') {
        llmName = v;
      }
      const ov = v;
      if (apdef.value.id || apdef.value.ref || apdef.value.array) {
        v = `"${v}"`;
      } else if (apdef.value.str) {
        v = `"${escapeSpecialChars(v)}"`;
      }
      attrsStrs.push(`${apdef.name} ${v}`);
      attrs.set(apdef.name, ov);
    }
  });
  let createDefaultLLM = false;
  if (!attrs.has('llm')) {
    // Agent doesn't have an LLM specified, create a default one
    llmName = `${name}_llm`;
    createDefaultLLM = true;
  }

  // Create a copy of attrsStrs for the database operation
  const dbAttrsStrs = [...attrsStrs];
  // Only add llm to database attributes if we have one
  if (llmName) {
    dbAttrsStrs.push(`llm "${llmName}"`);
  }

  const createAgent = `{${CoreAIModuleName}/${AgentEntityName} {
    ${dbAttrsStrs.join(',')}
  }, @upsert}`;
  let wf = createAgent;
  // Only create an LLM with default service if we're creating a default LLM
  // If the user specified an LLM name, don't create/upsert it (it should already exist)
  if (createDefaultLLM && llmName) {
    const service = getDefaultLLMService();
    wf = `{${CoreAIModuleName}/${LlmEntityName} {name "${llmName}", service "${service}"}, @upsert}; ${wf}`;
  }
  (await parseWorkflow(`workflow A {${wf}}`)).statements.forEach((stmt: Statement) => {
    addStandaloneStatement(stmt, moduleName, false);
  });
  const agentFqName = makeFqName(moduleName, name);
  if (conds) {
    registerAgentDirectives(agentFqName, conds);
  }
  if (scenarios) {
    registerAgentScenarios(agentFqName, scenarios);
  }
  if (glossary) {
    registerAgentGlossary(agentFqName, glossary);
  }
  if (responseSchema) {
    registerAgentResponseSchema(agentFqName, responseSchema);
  }
  if (scratchNames) {
    registerAgentScratchNames(agentFqName, scratchNames);
  }
  // Don't add llm to module attrs if it wasn't originally specified
  const agent = addAgent(def.name, attrs, moduleName);
  if (ispub) {
    agent.setPublic(true);
  }
  return agent;
}

function processAgentArray(array: ArrayLiteral, attrName: string): string {
  return array.vals
    .map((stmt: Statement) => {
      const expr = stmt.pattern.expr;
      return processAgentArrayValue(expr, attrName);
    })
    .join(',');
}

function processAgentArrayValue(expr: Expr | undefined, attrName: string): string {
  if (expr && isLiteral(expr)) {
    const s = expr.str || expr.id || expr.ref || expr.bool;
    if (s !== undefined) {
      return s;
    }
    if (expr.array) {
      return processAgentArray(expr.array, attrName);
    } else if (expr.map) {
      const m = new Array<string>();
      expr.map.entries.forEach((me: MapEntry) => {
        m.push(
          `${me.key.str || me.key.num || me.key.bool || ''}: ${processAgentArrayValue(me.value, attrName)}`
        );
      });
      return `{${m.join(',')}}`;
    } else {
      throw new Error(`Type not supported in agent-arrays - ${attrName}`);
    }
  } else {
    throw new Error(`Invalid value in array passed to agent ${attrName}`);
  }
}

function addFlowDefinition(def: FlowDefinition, moduleName: string) {
  const m = fetchModule(moduleName);
  const sdef = def.$cstNode?.text;
  let f = '';
  if (sdef) {
    const idx = sdef.indexOf('{');
    if (idx > 0) {
      f = sdef.substring(idx + 1, sdef.lastIndexOf('}')).trim();
    } else {
      f = sdef;
    }
  }
  m.addFlow(def.name, f);
  registerFlow(`${moduleName}/${def.name}`, f);
}

function addDecisionDefinition(def: DecisionDefinition, moduleName: string) {
  const m = fetchModule(moduleName);
  const cases = def.body
    ? def.body.cases.map((ce: CaseEntry) => {
        return ce.$cstNode?.text;
      })
    : new Array<string>();
  m.addRawDecision(def.name, cases as string[]);
}

function agentXtraAttributesAsMap(xtras: AgentXtraAttribute[] | undefined): Map<string, string> {
  const result = new Map<string, string>();
  xtras?.forEach((v: AgentXtraAttribute) => {
    result.set(v.name, v.value);
  });
  return result;
}

function scenarioConditionAsMap(cond: If | undefined) {
  const result = new Map<string, any>();
  if (cond) {
    if (isLiteral(cond.cond)) {
      const s = cond.cond.str;
      if (s === undefined) {
        throw new Error(`scenario condition must be a string - ${cond.cond.$cstNode?.text}`);
      }
      const stmt = cond.statements[0];
      const v = stmt ? stmt.pattern.$cstNode?.text : '';
      if (v === undefined) {
        throw new Error(
          `scenario consequent must be a string or name - ${cond.cond.$cstNode?.text}`
        );
      }
      result.set('user', s).set('ai', v).set('if', introspectIf(cond));
    }
  }
  return result;
}

function addScenarioDefintion(def: ScenarioDefinition, moduleName: string) {
  if (def.body || def.scn) {
    let n = rootRef(def.name);
    if (!isFqName(n)) {
      n = makeFqName(moduleName, n);
    }
    const m = def.body ? asStringLiteralsMap(def.body) : scenarioConditionAsMap(def.scn);
    const user = m.get('user');
    const ai = m.get('ai');
    const ifPattern = m.get('if');
    if (user !== undefined && ai !== undefined) {
      const scn = { user: user, ai: ai, internal: false, ifPattern };
      addAgentScenario(n, scn);
      fetchModule(moduleName).addScenario(def.name, scn);
    } else throw new Error(`scenario ${def.name} requires both user and ai entries`);
  }
}

function addDirectiveDefintion(def: DirectiveDefinition, moduleName: string) {
  if (def.body || def.dir) {
    let n = rootRef(def.name);
    if (!isFqName(n)) {
      n = makeFqName(moduleName, n);
    }
    if (def.body) {
      const m = asStringLiteralsMap(def.body);
      const cond = m.get('if');
      const then = m.get('then');
      if (cond && then) {
        const dir = { if: cond, then: then, internal: false, ifPattern: undefined };
        addAgentDirective(n, dir);
        fetchModule(moduleName).addDirective(def.name, dir);
      } else throw new Error(`directive ${def.name} requires both if and then entries`);
    } else if (def.dir) {
      const cond = def.dir.$cstNode?.text;
      if (cond) {
        const ifPattern = introspectIf(def.dir);
        const dir = { if: cond, then: '', internal: false, ifPattern };
        addAgentDirective(n, dir);
        fetchModule(moduleName).addDirective(def.name, dir);
      } else {
        throw new Error(`directive ${def.name} requires a valid if expression`);
      }
    }
  }
}

function addGlossaryEntryDefintion(def: GlossaryEntryDefinition, moduleName: string) {
  if (def.body || def.glos) {
    let n = rootRef(def.name);
    if (!isFqName(n)) {
      n = makeFqName(moduleName, n);
    }
    const m = def.body
      ? asStringLiteralsMap(def.body)
      : agentXtraAttributesAsMap(def.glos?.attributes);
    const name = m.get('name') || m.get('word');
    const meaning = m.get('meaning');
    const syn = m.get('synonyms');
    if (name && meaning) {
      const ge = {
        name: name,
        meaning: meaning,
        synonyms: syn,
        internal: false,
      };
      addAgentGlossaryEntry(n, ge);
      fetchModule(moduleName).addGlossaryEntry(def.name, ge);
    } else throw new Error(`glossaryEntry ${def.name} requires both name and meaning keys`);
  }
}

function addRetryDefinition(def: RetryDefinition, moduleName: string) {
  const retry = new Retry(def.name, moduleName, def.attempts !== undefined ? def.attempts : 0);
  if (def.backoff) {
    def.backoff.attributes.forEach((attr: SetAttribute) => {
      if (isLiteral(attr.value)) {
        switch (attr.name) {
          case 'strategy':
            switch (attr.value.id || attr.value.str) {
              case 'exponential':
                retry.setExponentialBackoff();
                break;
              case 'linear':
                retry.setLinearBackoff();
                break;
              case 'constant':
                retry.setConstantBackoff();
                break;
              default:
                throw new Error(`Invalid backoff strategy ${attr.value} specified for ${def.name}`);
            }
            break;
          case 'delay':
            if (attr.value.num) {
              retry.setBackoffDelay(attr.value.num);
            } else {
              throw new Error(`Backoff delay must be a numeric value for ${def.name}`);
            }
            break;
          case 'magnitude':
            switch (attr.value.id || attr.value.str) {
              case 'milliseconds':
                retry.setBackoffMagnitudeAsMilliseconds();
                break;
              case 'seconds':
                retry.setBackoffMagnitudeAsSeconds();
                break;
              case 'minutes':
                retry.setBackoffMagnitudeAsMinutes();
                break;
              default:
                throw new Error(`Invalid backoff magnitude ${attr.value} set for ${def.name}`);
            }
            break;
          case 'factor':
            if (attr.value.num) {
              retry.setBackoffFactor(attr.value.num);
            } else {
              throw new Error(`Backoff factor must be a number for ${def.name}`);
            }
            break;
          default:
            throw new Error(`Invalid backoff option ${attr.name} specified for ${def.name}`);
        }
      } else {
        throw new Error(`strategy must be a string in ${def.name}`);
      }
    });
  }
  fetchModule(moduleName).addRetry(retry);
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
  else if (isPublicEventDefinition(def)) addSchemaFromDef(def.def, moduleName, true);
  else if (isRecordDefinition(def)) addSchemaFromDef(def, moduleName);
  else if (isRelationshipDefinition(def)) addRelationshipFromDef(def, moduleName);
  else if (isWorkflowDefinition(def)) addWorkflowFromDef(def, moduleName);
  else if (isPublicWorkflowDefinition(def)) addWorkflowFromDef(def.def, moduleName, true);
  else if (isAgentDefinition(def)) await addAgentDefinition(def, moduleName);
  else if (isPublicAgentDefinition(def)) await addAgentDefinition(def.def, moduleName, true);
  else if (isStandaloneStatement(def)) addStandaloneStatement(def.stmt, moduleName);
  else if (isResolverDefinition(def)) addResolverDefinition(def, moduleName);
  else if (isFlowDefinition(def)) addFlowDefinition(def, moduleName);
  else if (isDecisionDefinition(def)) addDecisionDefinition(def, moduleName);
  else if (isScenarioDefinition(def)) addScenarioDefintion(def, moduleName);
  else if (isDirectiveDefinition(def)) addDirectiveDefintion(def, moduleName);
  else if (isGlossaryEntryDefinition(def)) addGlossaryEntryDefintion(def, moduleName);
  else if (isRetryDefinition(def)) addRetryDefinition(def, moduleName);
}

export async function parseAndIntern(code: string, moduleName?: string) {
  if (moduleName && !isModule(moduleName)) {
    throw new Error(`Module not found - ${moduleName}`);
  }
  const r = await parse(moduleName ? `module ${moduleName} ${code}` : code);
  maybeRaiseParserErrors(r);
  await internModule(r.parseResult.value);
}

export async function refreshModuleDefinition(moduleName: string, moduleDefinition: string) {
  removeModule(moduleName);
  const r = await parse(moduleDefinition);
  maybeRaiseParserErrors(r);
  await internModule(r.parseResult.value);
}

export async function internModule(
  module: ModuleDefinition,
  moduleFileName?: string
): Promise<Module> {
  const mn = module.name;
  const r = addModule(mn);
  // Process imports sequentially to ensure all JS modules are loaded before definitions
  for (const imp of module.imports as Import[]) {
    await importModule(imp.path, imp.name, moduleFileName);
    r.addImport({ name: imp.name, path: imp.path });
  }
  for (let i = 0; i < module.defs.length; ++i) {
    const def = module.defs[i];
    await addFromDef(def, mn);
  }
  return r;
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

function filterConfigEntityInstances(rawConfig: any): [any, Array<any>] {
  let cfg: any = undefined;
  const insts = new Array<any>();
  const oldFormat = Object.keys(rawConfig).some((k: string) => {
    return k === 'store' || k === 'service';
  });
  const newFormat = !oldFormat;
  if (newFormat) {
    Object.entries(rawConfig).forEach(([key, value]: [string, any]) => {
      if (key === 'agentlang') {
        cfg = value;
      } else {
        if (value instanceof Array) {
          value.forEach((v: any) => {
            insts.push(v);
          });
        } else {
          insts.push(value);
        }
      }
    });
    if (cfg === undefined) cfg = {};
    return [cfg, insts];
  } else {
    return [rawConfig, insts];
  }
}

async function configFromObject(cfgObj: any, validate: boolean = true): Promise<any> {
  const rawConfig = preprocessRawConfig(cfgObj);
  if (validate) {
    const [cfg, insts] = filterConfigEntityInstances(rawConfig);
    const pats = new Array<string>();
    insts.forEach((v: any) => {
      const n = Object.keys(v)[0];
      const attrs = v[n];
      pats.push(`{${n} ${objectAsString(attrs)}}`);
    });
    if (pats.length > 0) {
      await evaluateConfigPatterns(pats.join('\n'));
    }
    const result = ConfigSchema.parse(cfg);
    cfg.retry?.forEach((r: any) => {
      const retry: Retry = new Retry(r.name, ScratchModuleName, r.attempts)
        .setBackoffDelay(r.backoff.delay)
        .setBackoffFactor(r.backoff.factor)
        .setBackoffStrategy(r.backoff.strategy[0])
        .setBackoffMagnitude(r.backoff.magnitude);
      addGlobalRetry(retry);
    });
    return result;
  }
  return rawConfig;
}

export function generateRawConfig(configObj: any): string {
  return JSON.stringify(configObj);
}
