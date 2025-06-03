import chalk from 'chalk';
import { createAgentlangServices } from '../language/agentlang-module.js';
import {
  Module,
  Def,
  isEntity,
  isEvent,
  isRecord,
  isWorkflow,
  Import,
  isRelationship,
  ExtendsClause,
  RbacSpec,
  RbacSpecEntry,
  RbacOpr,
  RbacSpecEntries,
} from '../language/generated/ast.js';
import {
  addModule,
  addEntity,
  addEvent,
  addRecord,
  addWorkflow,
  addRelationship,
  EntityEntry,
  RbacSpecification,
  RuntimeModule,
} from './module.js';
import { importModule, makeFqName, registerInitFunction, runShellCommand } from './util.js';
import { getFileSystem, toFsPath, readFile, readdir, exists } from '../utils/fs-utils.js';
import { URI } from 'vscode-uri';
import { AstNode, LangiumCoreServices, LangiumDocument } from 'langium';
import { isNodeEnv, path } from '../utils/runtime.js';
import { CoreModules } from './modules/core.js';
import { parseModule } from '../language/parser.js';
import { createPermission, createRole } from './modules/auth.js';
import { logger } from './logger.js';
import { Environment } from './interpreter.js';

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

export type ApplicationSpec = {
  name: string;
  version: string;
  dependencies?: object | undefined;
};

export const DefaultAppSpec: ApplicationSpec = {
  name: 'agentlang-app',
  version: '0.0.1',
};

async function loadApp(appJsonFile: string, fsOptions?: any): Promise<string> {
  // Initialize filesystem if not already done
  const fs = await getFileSystem(fsOptions);

  const s: string = await fs.readFile(appJsonFile);
  const appSpec: ApplicationSpec = JSON.parse(s);
  const dir: string = path.dirname(appJsonFile);
  const alFiles: Array<string> = new Array<string>();
  const directoryContents = await fs.readdir(dir);
  let lastModuleLoaded: string = '';
  async function cont2() {
    if (!directoryContents) {
      console.error(chalk.red(`Directory ${dir} does not exist or is empty.`));
      return;
    }
    directoryContents.forEach(file => {
      if (path.extname(file) == '.al') {
        alFiles.push(dir + path.sep + file);
      }
    });
    for (let i = 0; i < alFiles.length; ++i) {
      await loadModule(alFiles[i], fsOptions).then((r: RuntimeModule) => {
        lastModuleLoaded = r.name;
      });
    }
  }
  if (appSpec.dependencies != undefined) {
    if (isNodeEnv) {
      // Only run shell commands in Node.js environment
      for (const [depName, depVer] of Object.entries(appSpec.dependencies)) {
        runShellCommand(`npm install ${depName}@${depVer}`, cont2);
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
 * @returns Promise that resolves when the module is loaded
 */
export async function load(fileName: string, fsOptions?: any): Promise<ApplicationSpec> {
  let result: string = '';
  if (path.basename(fileName) == 'app.json') {
    await loadApp(fileName, fsOptions).then((r: string) => {
      result = r;
    });
  } else {
    await loadModule(fileName, fsOptions).then((r: RuntimeModule) => {
      result = r.name;
    });
  }
  return { name: result, version: '0.0.1' };
}

export async function loadCoreModules() {
  for (let i = 0; i < CoreModules.length; ++i) {
    await parseModule(CoreModules[i]).then(internModule);
  }
}

async function loadModule(fileName: string, fsOptions?: any): Promise<RuntimeModule> {
  // Initialize filesystem if not already done
  const fs = await getFileSystem(fsOptions);

  const fsAdapter = getFsAdapter(fs);

  // Create services with our custom filesystem adapter
  const services = createAgentlangServices({
    fileSystemProvider: _services => fsAdapter,
  }).Agentlang;

  // Extract the AST node
  const module = await extractAstNode<Module>(fileName, services);
  const result: RuntimeModule = internModule(module);
  console.log(chalk.green(`Module ${chalk.bold(result.name)} loaded`));
  logger.info(`Module ${result.name} loaded`);
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

function maybeExtends(ext: ExtendsClause | undefined): string | undefined {
  return ext ? ext.parentName : undefined;
}

function setRbacForEntity(entity: EntityEntry, rbacSpec: RbacSpec) {
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
          `${r}_permission`,
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
  await env.callInTransactions(f);
}

export function internModule(module: Module): RuntimeModule {
  const r = addModule(module.name);
  module.imports.forEach((imp: Import) => {
    importModule(imp.path, imp.name);
  });
  module.defs.forEach((def: Def) => {
    if (isEntity(def)) {
      const entity: EntityEntry = addEntity(
        def.name,
        module.name,
        def.schema.attributes,
        maybeExtends(def.extends)
      );
      if (def.schema.rbacSpec) {
        setRbacForEntity(entity, def.schema.rbacSpec);
      }
    } else if (isEvent(def))
      addEvent(def.name, module.name, def.schema.attributes, maybeExtends(def.extends));
    else if (isRecord(def))
      addRecord(def.name, module.name, def.schema.attributes, maybeExtends(def.extends));
    else if (isRelationship(def))
      addRelationship(def.name, def.type, def.nodes, module.name, def.attributes, def.properties);
    else if (isWorkflow(def)) addWorkflow(def.name, module.name, def.statements);
  });
  return r;
}
