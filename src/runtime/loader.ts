import chalk from "chalk";
import { createAgentlangServices } from "../language/agentlang-module.js";
import {
  Module,
  Def,
  isEntity,
  isEvent,
  isRecord,
  isWorkflow,
  Import,
} from "../language/generated/ast.js";
import {
  addModule,
  addEntity,
  addEvent,
  addRecord,
  addWorkflow,
} from "./module.js";
import { importModule, runShellCommand } from "./util.js";
import {
  getFileSystem,
  toFsPath,
  readFile,
  readdir,
  exists,
} from "../utils/fs-utils.js";
import { URI } from "vscode-uri";
import { AstNode, LangiumCoreServices, LangiumDocument } from "langium";
import { isNodeEnv, path } from "../utils/runtime.js";

export async function extractDocument(
  fileName: string,
  services: LangiumCoreServices
): Promise<LangiumDocument> {
  const extensions = services.LanguageMetaData.fileExtensions;

  if (isNodeEnv && typeof fileName === "string") {
    if (!extensions.includes(path.extname(fileName))) {
      console.error(
        chalk.yellow(
          `Please choose a file with one of these extensions: ${extensions}.`
        )
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
  } else if (!isNodeEnv && typeof fileName === "string") {
    const fullFilePath = path.resolve(fileName);

    const fileExists = await exists(fullFilePath);

    if (!fileExists) {
      console.error(`File ${fileName} does not exist.`);
    }
  } else {
    throw new Error(
      "Invalid input: expected file path (Node.js) or File object/content (browser)"
    );
  }

  const document =
    await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
      URI.file(path.resolve(fileName))
    );

  // Build document
  await services.shared.workspace.DocumentBuilder.build([document], {
    validation: true,
  });

  // Handle validation errors
  const validationErrors = (document.diagnostics ?? []).filter(
    (e) => e.severity === 1
  );

  if (validationErrors.length > 0) {
    console.error(
      isNodeEnv && chalk
        ? chalk.red("There are validation errors:")
        : "There are validation errors:"
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

    throw new Error("Validation errors found");
  }

  return document;
}

export async function extractAstNode<T extends AstNode>(
  fileName: string,
  services: LangiumCoreServices
): Promise<T> {
  return (await extractDocument(fileName, services)).parseResult?.value as T;
}

export type ApplicationSpec = {
  name: string;
  version: string;
  dependencies?: object | undefined;
};

const loadApp = async (
  appJsonFile: string,
  continuation: Function,
  fsOptions?: any
): Promise<void> => {
  // Initialize filesystem if not already done
  const fs = await getFileSystem(fsOptions);

  const s: string = await fs.readFile(appJsonFile);
  const appSpec: ApplicationSpec = JSON.parse(s);
  let dir: string = path.dirname(appJsonFile);
  let alFiles: Array<string> = new Array<string>();
  const directoryContents = await fs.readdir(dir);

  let cont2: Function = () => {
    if (!directoryContents) {
      console.error(chalk.red(`Directory ${dir} does not exist or is empty.`));
      return;
    }
    directoryContents.forEach((file) => {
      if (path.extname(file) == ".al") {
        alFiles.push(dir + path.sep + file);
      }
    });
    if (alFiles.length > 0) {
      let loadedCount: number = 0;
      let cont: Function = (_: string) => {
        ++loadedCount;
        if (loadedCount >= alFiles.length) {
          continuation(appSpec);
        }
      };
      alFiles.forEach((fileName: string) => {
        loadModule(fileName, cont, fsOptions);
      });
    }
  };
  if (appSpec.dependencies != undefined) {
    for (const [depName, depVer] of Object.entries(appSpec.dependencies)) {
      runShellCommand(`npm install ${depName}@${depVer}`, cont2);
    }
  } else {
    cont2();
  }
};

/**
 * Load a module from a file
 * @param fileName Path to the file containing the module
 * @param fsOptions Optional configuration for the filesystem
 * @returns Promise that resolves when the module is loaded
 */
export const load = async (
  fileName: string,
  continuation: Function,
  fsOptions?: any
): Promise<void> => {
  if (path.basename(fileName) == "app.json") {
    loadApp(fileName, continuation, fsOptions);
  } else {
    loadModule(
      fileName,
      (moduleName: string) => {
        continuation({
          name: moduleName,
          version: "0.0.1",
        });
      },
      fsOptions
    );
  }
};

const loadModule = async (
  fileName: string,
  continuation: Function,
  fsOptions?: any
): Promise<void> => {
  // Initialize filesystem if not already done
  const fs = await getFileSystem(fsOptions);

  // Create an adapter to make our filesystem compatible with Langium
  const fsAdapter = {
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
        result.map(async (name) => {
          const filePath = dirPath.endsWith("/")
            ? `${dirPath}${name}`
            : `${dirPath}/${name}`;
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

  // Create services with our custom filesystem adapter
  const services = createAgentlangServices({
    fileSystemProvider: (_services) => fsAdapter,
  }).Agentlang;

  // Extract the AST node
  const model = await extractAstNode<Module>(fileName, services);
  const moduleName = internModule(model);
  console.log(chalk.green(`Module ${chalk.bold(moduleName)} loaded`));
  if (continuation != undefined) continuation(moduleName);
};

function internModule(module: Module): string {
  addModule(module.name);
  module.imports.forEach((imp: Import) => {
    importModule(imp.path, imp.name);
  });
  module.defs.forEach((def: Def) => {
    if (isEntity(def)) addEntity(def.name, def.attributes);
    else if (isEvent(def)) addEvent(def.name, def.attributes);
    else if (isRecord(def)) addRecord(def.name, def.attributes);
    else if (isWorkflow(def)) addWorkflow(def.name, def.statements);
  });
  return module.name;
}
