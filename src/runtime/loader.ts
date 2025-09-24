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
} from './module.js';
import {
  escapeSpecialChars,
  findRbacSchema,
  isFqName,
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
import {
  AgentCondition,
  AgentEntityName,
  AgentGlossaryEntry,
  AgentScenario,
  CoreAIModuleName,
  LlmEntityName,
  registerAgentDirectives,
  registerAgentGlossary,
  registerAgentScenarios,
} from './modules/ai.js';
import { getDefaultLLMService } from './agents/registry.js';
import { GenericResolver, GenericResolverMethods } from './resolvers/interface.js';
import { registerResolver, setResolver } from './resolvers/registry.js';
import { Config, ConfigSchema, setAppConfig } from './state.js';
import { getModuleFn, importModule } from './jsmodules.js';
import { SetSubscription } from './defs.js';
import { ExtendedFileSystem } from '../utils/fs/interfaces.js';
import z from 'zod';
import { registerAgentFlow, registerFlow } from './agents/flows.js';

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

function addStandaloneStatement(stmt: Statement, moduleName: string, userDefined = true) {
  let stmts: Array<Statement> | undefined = StandaloneStatements.get(moduleName);
  if (stmts == undefined) {
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
          conds?.push({ cond, then });
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
          const v = isLiteral(me.value) ? me.value.str : undefined;
          if (v) {
            if (me.key.str == 'user') {
              user = v;
            } else if (me.key.str == 'ai') {
              ai = v;
            }
          }
        });
        if (user && ai) {
          scenarios.push({ user, ai });
        } else {
          throw new Error(`Invalid glossary spec in agent ${agentName}`);
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
          gls.push({ name, meaning, synonyms });
        } else {
          throw new Error(`Invalid glossary spec in agent ${agentName}`);
        }
      }
    });
    return gls;
  }
  return undefined;
}

async function addAgentDefinition(def: AgentDefinition, moduleName: string) {
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
    } else {
      let v: any = undefined;
      if (apdef.value.array) {
        v = processAgentArray(apdef.value.array, name);
      } else {
        v = apdef.value.str || apdef.value.id || apdef.value.ref || apdef.value.num;
        if (v == undefined) {
          v = apdef.value.bool;
        }
      }
      if (v == undefined) {
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
  if (conds) {
    registerAgentDirectives(moduleName, name, conds);
  }
  if (scenarios) {
    registerAgentScenarios(moduleName, name, scenarios);
  }
  if (glossary) {
    registerAgentGlossary(moduleName, name, glossary);
  }
  // Don't add llm to module attrs if it wasn't originally specified
  addAgent(def.name, attrs, moduleName);
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
    if (s != undefined) {
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
      throw new Error(`Type not supprted in agent-arrays - ${attrName}`);
    }
  } else {
    throw new Error(`Invalid value in array passed to agent ${attrName}`);
  }
}

function addFlowDefinition(def: FlowDefinition, moduleName: string) {
  if (def.body && def.$cstNode) {
    const m = fetchModule(moduleName);
    const sdef = def.$cstNode.text;
    const idx = sdef.indexOf('{');
    let f = '';
    if (idx > 0) {
      f = sdef.substring(idx + 1, sdef.lastIndexOf('}')).trim();
    } else {
      f = sdef;
    }
    m.addFlow(def.name, f);
    registerFlow(`${moduleName}/${def.name}`, f);
  }
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
  else if (isFlowDefinition(def)) addFlowDefinition(def, moduleName);
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
