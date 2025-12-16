import chalk from 'chalk';
import { Command } from 'commander';
import { AgentlangLanguageMetaData } from '../language/generated/module.js';
import { createAgentlangServices } from '../language/agentlang-module.js';
import {
  ApplicationSpec,
  internModule,
  load,
  loadAppConfig,
  loadCoreModules,
  refreshModuleDefinition,
  runStandaloneStatements,
} from '../runtime/loader.js';
import { NodeFileSystem } from 'langium/node';
import { extractDocument } from '../runtime/loader.js';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../runtime/logger.js';
import { Module } from '../runtime/module.js';
import { ModuleDefinition } from '../language/generated/ast.js';
import { Config } from '../runtime/state.js';
import { prepareIntegrations } from '../runtime/integrations.js';
import { isExecGraphEnabled, isNodeEnv } from '../utils/runtime.js';
import { OpenAPIClientAxios } from 'openapi-client-axios';
import { registerOpenApiModule } from '../runtime/openapi.js';
import { initDatabase, resetDefaultDatabase } from '../runtime/resolvers/sqldb/database.js';
import { runInitFunctions } from '../runtime/util.js';
import { startServer } from '../api/http.js';
import { enableExecutionGraph } from '../runtime/exec-graph.js';
import { importModule } from '../runtime/jsmodules.js';
import {
  isRuntimeMode_dev,
  isRuntimeMode_prod,
  setInternDynamicModuleFn,
  setRuntimeMode_generate_migration,
  setRuntimeMode_init_schema,
  setRuntimeMode_migration,
  setRuntimeMode_prod,
  setRuntimeMode_undo_migration,
  updateEndpoints,
} from '../runtime/defs.js';
import { initGlobalApi } from '../runtime/api.js';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const packagePath = path.resolve(__dirname, '..', '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export type GenerateOptions = {
  destination?: string;
};

export default function (): void {
  const program = new Command();

  program.version(JSON.parse(packageContent).version);

  const fileExtensions = AgentlangLanguageMetaData.fileExtensions.join(', ');

  program
    .command('run')
    .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
    .option('-c, --config <config>', 'configuration file')
    .description('Loads and runs an agentlang module')
    .action(runModule);

  program
    .command('parseAndValidate')
    .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
    .option('-d, --destination <dir>', 'destination directory of generating')
    .description('Parses and validates an Agentlang module')
    .action(parseAndValidate);

  program
    .command('initSchema')
    .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
    .option('-c, --config <config>', 'configuration file')
    .description('Initialize database schema')
    .action(initSchema);

  program
    .command('runMigrations')
    .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
    .option('-c, --config <config>', 'configuration file')
    .description('Automatically perform migration of the schema')
    .action(runMigrations);

  program
    .command('undoLastMigration')
    .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
    .option('-c, --config <config>', 'configuration file')
    .description('Revoke the last migration')
    .action(undoLastMigration);

  program
    .command('generateMigration')
    .argument('<file>', `source file (possible file extensions: ${fileExtensions})`)
    .option('-c, --config <config>', 'configuration file')
    .description('Generate migration script')
    .action(generateMigration);

  program.parse(process.argv);
}

/**
 * Parse and validate a program written in our language.
 * Verifies that no lexer or parser errors occur.
 * Implicitly also checks for validation errors while extracting the document
 *
 * @param fileName Program to validate
 */
export const parseAndValidate = async (fileName: string): Promise<void> => {
  // retrieve the services for our language
  const services = createAgentlangServices(NodeFileSystem).Agentlang;
  // extract a document for our program
  const document = await extractDocument(fileName, services);
  // extract the parse result details
  const parseResult = document.parseResult;
  // verify no lexer, parser, or general diagnostic errors show up
  if (parseResult.lexerErrors.length === 0 && parseResult.parserErrors.length === 0) {
    console.log(chalk.green(`Parsed and validated ${fileName} successfully!`));
  } else {
    console.log(chalk.red(`Failed to parse and validate ${fileName}!`));
  }
};

let LastActiveConfig: Config | undefined;

export async function runPostInitTasks(appSpec?: ApplicationSpec, config?: Config) {
  await initDatabase(config?.store);
  await importModule('../runtime/api.js', 'agentlang');
  await runInitFunctions();
  await runStandaloneStatements();
  if (appSpec && (isRuntimeMode_dev() || isRuntimeMode_prod()))
    startServer(appSpec, config?.service?.port || 8080, config?.service?.host, config);
  LastActiveConfig = config;
}

export async function runPostInitTasksWithLastActiveConfig() {
  await runPostInitTasks(undefined, LastActiveConfig);
}

let execGraphEnabled = false;

export async function runPreInitTasks(): Promise<boolean> {
  initGlobalApi();
  if (!execGraphEnabled && isExecGraphEnabled()) {
    enableExecutionGraph();
    execGraphEnabled = true;
  }
  let result: boolean = true;
  await loadCoreModules().catch((reason: any) => {
    const msg = `Failed to load core modules - ${reason.toString()}`;
    logger.error(msg);
    console.log(chalk.red(msg));
    result = false;
  });
  return result;
}

async function internDynamicModule(name: string, definition: string): Promise<string> {
  await refreshModuleDefinition(name, definition);
  await resetDefaultDatabase();
  await runPostInitTasksWithLastActiveConfig();
  updateEndpoints(name);
  return name;
}

setInternDynamicModuleFn(internDynamicModule);

export const runModule = async (fileName: string, releaseDb: boolean = false): Promise<void> => {
  if (isRuntimeMode_dev() && process.env.NODE_ENV === 'production') {
    setRuntimeMode_prod();
  }
  const r: boolean = await runPreInitTasks();
  if (!r) {
    throw new Error('Failed to initialize runtime');
  }
  const configDir =
    path.dirname(fileName) === '.' ? process.cwd() : path.resolve(process.cwd(), fileName);
  const config: Config = await loadAppConfig(configDir);
  if (config.integrations) {
    await prepareIntegrations(
      config.integrations.host,
      config.integrations.username,
      config.integrations.password,
      config.integrations.connections
    );
  }
  if (config.openapi) {
    await loadOpenApiSpec(config.openapi);
  }
  try {
    await load(fileName, undefined, async (appSpec?: ApplicationSpec) => {
      await runPostInitTasks(appSpec, config);
    });
  } catch (err: any) {
    if (isNodeEnv && chalk) {
      console.error(chalk.red(err));
    } else {
      console.error(err);
    }
  } finally {
    if (releaseDb === true) {
      resetDefaultDatabase();
    }
  }
};

async function initSchema(fileName: string) {
  setRuntimeMode_init_schema();
  await runModule(fileName, true);
}

async function runMigrations(fileName: string) {
  setRuntimeMode_migration();
  await runModule(fileName, true);
}

async function undoLastMigration(fileName: string) {
  setRuntimeMode_undo_migration();
  await runModule(fileName, true);
}

async function generateMigration(fileName: string) {
  setRuntimeMode_generate_migration();
  await runModule(fileName, true);
}

export async function internAndRunModule(
  module: ModuleDefinition,
  appSpec?: ApplicationSpec
): Promise<Module> {
  const r: boolean = await runPreInitTasks();
  if (!r) {
    throw new Error('Failed to initialize runtime');
  }
  const rm: Module = await internModule(module);
  await runPostInitTasks(appSpec);
  return rm;
}

async function loadOpenApiSpec(openApiConfig: any[]) {
  for (let i = 0; i < openApiConfig.length; ++i) {
    const cfg: any = openApiConfig[i];
    const api = new OpenAPIClientAxios({ definition: cfg.specUrl });
    await api.init();
    const client = await api.getClient();
    client.defaults.baseURL = cfg.baseUrl
      ? cfg.baseUrl
      : cfg.specUrl.substring(0, cfg.specUrl.lastIndexOf('/'));
    const n = await registerOpenApiModule(cfg.name, { api: api, client: client });
    logger.info(`OpenAPI module '${n}' registered`);
  }
}
