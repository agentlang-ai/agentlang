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
import { logger, updateLoggerFromConfig } from '../runtime/logger.js';
import { Instance, Module } from '../runtime/module.js';
import { ModuleDefinition } from '../language/generated/ast.js';
import { Config } from '../runtime/state.js';
import { prepareIntegrations } from '../runtime/integrations.js';
import { isExecGraphEnabled, isNodeEnv } from '../utils/runtime.js';
import { OpenAPIClientAxios } from 'openapi-client-axios';
import { registerOpenApiModule } from '../runtime/openapi.js';
import { initDatabase, resetDefaultDatabase } from '../runtime/resolvers/sqldb/database.js';
import { runInitFunctions } from '../runtime/util.js';
import { getKnowledgeService } from '../runtime/knowledge/service.js';
import { startServer } from '../api/http.js';
import { enableExecutionGraph } from '../runtime/exec-graph.js';
import { importModule } from '../runtime/jsmodules.js';
import {
  isRuntimeMode_dev,
  isRuntimeMode_prod,
  isRuntimeMode_test,
  setInternDynamicModuleFn,
  setRuntimeMode_generate_migration,
  setRuntimeMode_init_schema,
  setRuntimeMode_migration,
  setRuntimeMode_prod,
  setRuntimeMode_test,
  setRuntimeMode_undo_migration,
  updateEndpoints,
} from '../runtime/defs.js';
import { initGlobalApi } from '../runtime/api.js';
import {
  initCoreModuleManager,
  lookupTimersWithRunningStatus,
  triggerTimer,
} from '../runtime/modules/core.js';

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

import { parseAndEvaluateStatement } from '../runtime/interpreter.js';

/**
 * Pre-process agent documents before starting the HTTP server.
 * This ensures the knowledge base is fully populated before handling requests.
 */
async function preProcessAgentDocuments(knowledgeService: any): Promise<void> {
  const startTime = Date.now();
  logger.info('[CLI] Pre-processing agent documents...');

  try {
    // Find all agents with documents
    const aiModuleName = 'agentlang.ai';
    const agentsResult = await parseAndEvaluateStatement(`{${aiModuleName}/Agent? {}}`, undefined);

    if (!agentsResult || agentsResult.length === 0) {
      logger.info('[CLI] No agents found, skipping document pre-processing');
      return;
    }

    logger.info(`[CLI] Found ${agentsResult.length} agent(s)`);

    // Process documents for each agent
    for (const agent of agentsResult) {
      const agentName = agent.lookup('name') as string;
      const documents = agent.lookup('documents') as string;

      if (!documents || documents.length === 0) {
        logger.info(`[CLI] Agent ${agentName} has no documents, skipping`);
        continue;
      }

      const docTitles = documents.split(',').map((d: string) => d.trim());
      const llmName = agent.lookup('llm') as string;
      logger.info(
        `[CLI] Pre-processing ${docTitles.length} document(s) for agent ${agentName} using LLM ${llmName}: ${docTitles.join(', ')}`
      );

      try {
        // Get or create session for this agent
        const userId = 'system'; // Pre-processing uses system user
        const agentFqName = `${agent.lookup('moduleName')}/${agentName}`;
        const session = await knowledgeService.getOrCreateSession(agentName, userId, agentFqName);

        // Process documents synchronously (blocking) with the agent's LLM
        await knowledgeService.maybeProcessAgentDocuments(session, docTitles, undefined, llmName);

        // Mark this agent's documents as processed globally
        // This prevents re-processing for each user session
        logger.info(`[CLI] Marking documents as processed for agent ${agentName}`);

        logger.info(`[CLI] Successfully pre-processed documents for agent ${agentName}`);
      } catch (err) {
        logger.warn(`[CLI] Failed to pre-process documents for agent ${agentName}: ${err}`);
        // Continue with other agents even if one fails
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`[CLI] Document pre-processing completed in ${duration}ms`);
  } catch (err) {
    logger.error(`[CLI] Error during document pre-processing: ${err}`);
    throw err;
  }
}

export async function runPostInitTasks(appSpec?: ApplicationSpec, config?: Config) {
  await initDatabase(config?.store);
  await importModule('../runtime/api.js', 'agentlang');
  await runInitFunctions();
  await runStandaloneStatements();
  initCoreModuleManager();
  // Initialize knowledge service (connects to Neo4j if configured)
  let knowledgeService;
  try {
    knowledgeService = getKnowledgeService();
    await knowledgeService.init();
  } catch (err) {
    logger.warn(`[CLI] Knowledge service initialization failed: ${err}`);
  }

  // Pre-process agent documents before starting server
  // This ensures knowledge base is ready before handling requests
  if (knowledgeService) {
    try {
      await preProcessAgentDocuments(knowledgeService);
    } catch (err) {
      logger.warn(`[CLI] Pre-processing agent documents failed: ${err}`);
    }
  }

  await runPersistedTimers();
  logger.info(
    `Running application ${appSpec?.name || 'unknown'} version ${appSpec?.version || 'unknown'} on port ${config?.service?.port || 8080}`
  );
  logger.info(
    `Application dependencies: ${appSpec?.dependencies ? Object.keys(appSpec.dependencies).join(', ') : 'none'}`
  );
  logger.info(`Application database type: ${config?.store?.type || 'None'}`);
  logger.info(`Application authentication enabled: ${config?.auth?.enabled}`);
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

async function runPersistedTimers() {
  if (!isRuntimeMode_test()) {
    const insts: Instance[] = await lookupTimersWithRunningStatus();
    if (insts) {
      for (let i = 0; i < insts.length; ++i) {
        const inst: Instance = insts[i];
        if (await restartTimer(inst)) {
          logger.info(`Timer ${inst.lookup('name')} setup to restart`);
        }
      }
    }
  }
}

async function restartTimer(timerInst: Instance): Promise<boolean> {
  const n = timerInst.lookup('name');
  try {
    if (isRuntimeMode_prod()) {
      // TODO: create and configure an independent timer-managerment service.
      logger.warn(`Cannot restart timer ${n}, timer management service is not configured`);
    } else {
      triggerTimer(timerInst);
      return true;
    }
  } catch (reason: any) {
    logger.warn(`Error while restarting timer ${n} - ${reason}`);
  }
  return false;
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
  if (isRuntimeMode_dev()) {
    if (process.env.NODE_ENV === 'production') {
      setRuntimeMode_prod();
    } else if (process.env.NODE_ENV === 'test') {
      setRuntimeMode_test();
    }
  }
  const r: boolean = await runPreInitTasks();
  if (!r) {
    throw new Error('Failed to initialize runtime');
  }
  const configDir =
    path.dirname(fileName) === '.' ? process.cwd() : path.resolve(process.cwd(), fileName);
  const config: Config = await loadAppConfig(configDir);
  updateLoggerFromConfig();
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
