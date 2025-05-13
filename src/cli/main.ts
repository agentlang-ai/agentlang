import chalk from "chalk";
import { Command } from "commander";
import { AgentlangLanguageMetaData } from "../language/generated/module.js";
import { createAgentlangServices } from "../language/agentlang-module.js";
import { ApplicationSpec, load } from "../runtime/loader.js";
import { NodeFileSystem } from "langium/node";
import { extractDocument } from "../runtime/loader.js";
import * as url from "node:url";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { startServer } from "../api/http.js";
import { initDefaultDatabase } from "../runtime/resolvers/sqldb/schema.js";

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

export const runModule = async (fileName: string): Promise<void> => {
    load(fileName, (appSpec: ApplicationSpec) => {
      initDefaultDatabase()
      startServer(appSpec, 8080)
    });
};
