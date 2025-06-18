import chalk from 'chalk';
import { Command } from 'commander';
import { AgentlangLanguageMetaData } from '../language/generated/module.js';
import { createAgentlangServices } from '../language/agentlang-module.js';
import {
  ApplicationSpec,
  internModule,
  load,
  loadCoreModules,
  runStandaloneStatements,
} from '../runtime/loader.js';
import { NodeFileSystem } from 'langium/node';
import { extractDocument } from '../runtime/loader.js';
import * as url from 'node:url';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { startServer } from '../api/http.js';
import { initDefaultDatabase } from '../runtime/resolvers/sqldb/database.js';
import { logger } from '../runtime/logger.js';
import { runInitFunctions } from '../runtime/util.js';
import { Module } from '../runtime/module.js';
import { ModuleDefinition } from '../language/generated/ast.js';
import { z } from 'zod';
import { loadConfig } from 'c12';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const packagePath = path.resolve(__dirname, '..', '..', 'package.json');
const packageContent = await fs.readFile(packagePath, 'utf-8');

export type GenerateOptions = {
  destination?: string;
};

// Config validation schema
const ConfigSchema = z.object({
  service: z
    .object({
      port: z.number(),
    })
    .default({
      port: 8080,
    }),
  store: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('postgres'),
        host: z.string().default('localhost'),
        username: z.string().default('postgres'),
        password: z.string().default('postgres'),
        dbname: z.string().default('postgres'),
        port: z.number().default(5432),
      }),
      z.object({
        type: z.literal('mysql'),
        host: z.string().default('localhost'),
        username: z.string().default('mysql'),
        password: z.string().default('mysql'),
        dbname: z.string().default('mysql'),
        port: z.number().default(3306),
      }),
      z.object({
        type: z.literal('sqlite'),
        dbname: z.string().optional(),
      }),
    ])
    .optional(),
  graphql: z
    .object({
      enabled: z.boolean().default(false),
    })
    .optional(),
  rbacEnabled: z.boolean().optional(),
  auditTrail: z
    .object({
      enabled: z.boolean().default(false),
    })
    .optional(),
  authentication: z
    .discriminatedUnion('service', [
      z.object({
        service: z.literal('okta'),
        superuserEmail: z.string(),
        domain: z.string(),
        cookieDomain: z.string().optional(),
        authServer: z.string().default('default'),
        clientSecret: z.string(),
        apiToken: z.string(),
        scope: z.string().default('openid offline_access'),
        cookieTtlMs: z.number().default(1209600000),
        introspect: z.boolean().default(true),
        authorizeRedirectUrl: z.string(),
        clientUrl: z.string(),
        roleClaim: z.string().default('roles'),
        defaultRole: z.string().default('user'),
        clientId: z.string(),
      }),
      z.object({
        service: z.literal('cognito'),
        superuserEmail: z.string(),
        superuserPassword: z.string().optional(),
        isIdentityStore: z.boolean().default(false),
        userPoolId: z.string(),
        clientId: z.string(),
        whitelistEnabled: z.boolean().default(false),
        disableUserSessions: z.boolean().default(false),
      }),
    ])
    .optional(),
});

type Config = z.infer<typeof ConfigSchema>;

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

export async function runPreInitTasks(): Promise<boolean> {
  let result: boolean = true;
  await loadCoreModules().catch((reason: any) => {
    const msg = `Failed to load core modules - ${reason.toString()}`;
    logger.error(msg);
    console.log(chalk.red(msg));
    result = false;
  });
  return result;
}

export async function runPostInitTasks(appSpec?: ApplicationSpec, config?: Config) {
  await initDefaultDatabase();
  await runInitFunctions();
  await runStandaloneStatements();
  if (appSpec) startServer(appSpec, config?.service?.port || 8080);
}

export const runModule = async (fileName: string, options?: { config?: string }): Promise<void> => {
  const configDir =
    path.dirname(fileName) === '.'
      ? process.cwd()
      : path.resolve(process.cwd(), path.dirname(fileName));

  let config: Config | undefined;

  try {
    const { config: rawConfig } = await loadConfig({
      cwd: configDir,
      name: 'config',
      configFile: options?.config || 'app.config',
      dotenv: true,
    });

    config = ConfigSchema.parse(rawConfig);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.log(chalk.red('Config validation failed:'));
      err.errors.forEach((error, index) => {
        console.log(chalk.red(`  ${index + 1}. ${error.path.join('.')}: ${error.message}`));
      });
    } else {
      console.log(`Config loading failed: ${err}`);
    }
  }

  const r: boolean = await runPreInitTasks();
  if (!r) {
    throw new Error('Failed to initialize runtime');
  }
  const appSpec: ApplicationSpec = await load(fileName);
  await runPostInitTasks(appSpec, config);
};

export async function internAndRunModule(
  module: ModuleDefinition,
  appSpec?: ApplicationSpec
): Promise<Module> {
  const r: boolean = await runPreInitTasks();
  if (!r) {
    throw new Error('Failed to initialize runtime');
  }
  const rm: Module = internModule(module);
  await runPostInitTasks(appSpec);
  return rm;
}
