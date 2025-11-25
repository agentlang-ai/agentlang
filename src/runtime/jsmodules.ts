import { logger } from './logger.js';
import { now, splitRefs } from './util.js';
import { isNodeEnv } from '../utils/runtime.js';
import { setModuleFnFetcher, getModuleLoader } from './defs.js';
import {
  transformModule,
  wrapModuleCode,
  evaluateModule,
  wrapCommonJSCode,
  evaluateCommonJS,
} from './module-transform.js';

let dirname: any = undefined;
let sep: any = undefined;

if (isNodeEnv) {
  const p = await import('path');
  dirname = p.dirname;
  sep = p.sep;
} else {
  sep = '/';
  dirname = (s: string): string => {
    const idx = s.lastIndexOf(sep);
    if (idx > 0) {
      return s.substring(0, idx);
    } else {
      return s;
    }
  };
}

const importedModules = new Map<string, any>();

/**
 * Load dependencies for a module using the configured dependency provider
 */
async function loadModuleDependencies(
  imports: Array<{ defaultImport?: string; namedImports?: string[]; moduleSpecifier: string }>
): Promise<Map<string, any>> {
  const loadedDeps = new Map<string, any>();

  for (const imp of imports) {
    const moduleSpecifier = imp.moduleSpecifier;

    logger.debug(`Loading dependency: ${moduleSpecifier}`);

    // Try to get from dependency provider first
    let module: any;
    const moduleLoader = getModuleLoader();
    if (moduleLoader?.dependencyProvider) {
      module = moduleLoader.dependencyProvider(moduleSpecifier);
    }

    if (!module) {
      // In browser without dependency provider, we can't load external modules
      if (!isNodeEnv) {
        throw new Error(
          `Failed to load dependency "${moduleSpecifier}". ` +
            `Please add it to the dependency provider via setModuleLoader().`
        );
      }

      // In Node.js, try dynamic import
      try {
        module = await import(/* @vite-ignore */ moduleSpecifier);
        logger.debug(`Loaded ${moduleSpecifier} via dynamic import`);
      } catch (error) {
        throw new Error(`Failed to load dependency "${moduleSpecifier}": ${error}`);
      }
    } else {
      logger.debug(`Using pre-imported dependency: ${moduleSpecifier}`);
    }

    // Handle default import
    if (imp.defaultImport) {
      loadedDeps.set(imp.defaultImport, module.default || module);
    }

    // Handle named imports
    if (imp.namedImports) {
      for (const name of imp.namedImports) {
        loadedDeps.set(name, module[name]);
      }
    }
  }

  return loadedDeps;
}

/**
 * Load a JavaScript module in the browser environment
 */
async function loadModuleInBrowser(
  path: string,
  name: string,
  moduleFileName?: string
): Promise<any> {
  const moduleLoader = getModuleLoader();
  if (!moduleLoader) {
    throw new Error(
      'ModuleLoader not configured. Call setModuleLoader() with a fileReader and dependencyProvider.'
    );
  }

  logger.info(`Loading module in browser: ${path} as ${name}`);

  // Resolve path relative to the module file
  let resolvedPath = path;
  if (moduleFileName) {
    const dir = dirname(moduleFileName);
    resolvedPath = dir ? `${dir}${sep}${path}` : path;
  }

  // Add basePath if configured
  if (moduleLoader.basePath) {
    if (!resolvedPath.startsWith('/')) {
      resolvedPath = `${moduleLoader.basePath}${sep}${resolvedPath}`;
    }
  }

  logger.debug(`Resolved path: ${resolvedPath}`);

  // Read the module content
  const content = await moduleLoader.fileReader(resolvedPath);

  if (!content || content.trim().length === 0) {
    logger.warn(`Module file ${resolvedPath} is empty`);
    return {};
  }

  logger.debug(`Read ${content.length} characters from ${resolvedPath}`);

  // Check if the file uses ES6 import syntax
  const hasImports = /\bimport\s+/.test(content);

  let moduleExports: any;

  if (hasImports) {
    logger.debug(`Processing ES6 imports for: ${name}`);

    // Transform the module
    const { transformedCode, imports } = transformModule(content);

    // Load all import dependencies
    const loadedDeps = await loadModuleDependencies(imports);

    logger.debug(`Loaded ${loadedDeps.size} dependencies, executing transformed code...`);

    // Create wrapped code with injected dependencies
    const wrappedCode = wrapModuleCode(transformedCode, loadedDeps);

    // Evaluate and get exports
    moduleExports = evaluateModule(wrappedCode, loadedDeps);

    logger.debug(`Module exports:`, Object.keys(moduleExports));
  } else {
    logger.debug(`Loading as CommonJS module: ${name}`);

    // Wrap and evaluate as CommonJS
    const wrappedCode = wrapCommonJSCode(content);
    moduleExports = evaluateCommonJS(wrappedCode);
  }

  return moduleExports;
}

/**
 * Load a JavaScript module in Node.js environment
 */
async function loadModuleInNode(path: string, name: string, moduleFileName?: string): Promise<any> {
  if (moduleFileName) {
    let s: string = dirname(moduleFileName);
    if (s.startsWith('./')) {
      s = s.substring(2);
    } else if (s == '.') {
      s = process.cwd();
    }
    path = `${s}${sep}${path}`;
  }
  if (!(path.startsWith(sep) || path.startsWith('.'))) {
    path = process.cwd() + sep + path;
  }

  const m = await import(/* @vite-ignore */ path);
  return m;
}

// Usage: importModule("./mymodels/acme.js")
export async function importModule(path: string, name: string, moduleFileName?: string) {
  if (importedModules.has(name)) {
    logger.warn(`Alias '${name}' will overwrite a previously imported module`);
  }

  let moduleExports: any;

  if (isNodeEnv) {
    moduleExports = await loadModuleInNode(path, name, moduleFileName);
  } else {
    moduleExports = await loadModuleInBrowser(path, name, moduleFileName);
  }

  importedModules.set(name, moduleExports);

  logger.info(`Successfully imported module: ${name}`, Object.keys(moduleExports));

  return moduleExports;
}

export function moduleImported(moduleName: string): boolean {
  return importedModules.has(moduleName);
}

/**
 * Get an imported module by its alias name
 */
export function getImportedModule(moduleName: string): any | undefined {
  return importedModules.get(moduleName);
}

/**
 * Get all imported module names
 */
export function getImportedModuleNames(): string[] {
  return Array.from(importedModules.keys());
}

function maybeEvalFunction(fnName: string): Function | undefined {
  try {
    return eval(fnName);
  } catch (reason: any) {
    logger.debug(reason);
    return undefined;
  }
}

async function invokeBuiltInFn(fnName: string, args: Array<any> | null, isAsync: boolean = false) {
  if (fnName == 'now') {
    return now();
  } else if (fnName == 'uuid') {
    return crypto.randomUUID();
  } else {
    const pf: Function | undefined = maybeEvalFunction(fnName);
    if (pf instanceof Function) {
      if (args === null) {
        if (isAsync) return await pf();
        else return pf();
      } else {
        if (isAsync) return await pf(...args.slice(0, args.length - 1));
        else return pf(...args.slice(0, args.length - 1));
      }
    } else {
      throw new Error(`Failed to invoke function - ${fnName}`);
    }
  }
}

export async function invokeModuleFn(
  fqFnName: string,
  args: Array<any> | null,
  isAsync: boolean = false
): Promise<any> {
  try {
    const refs: string[] = splitRefs(fqFnName);
    if (refs.length == 1) {
      if (isAsync) {
        return await invokeBuiltInFn(refs[0], args, isAsync);
      } else {
        return invokeBuiltInFn(refs[0], args);
      }
    }
    const mname = refs[0];
    const m = importedModules.get(mname);
    if (m !== undefined) {
      const f = m[refs[1]];
      if (f !== undefined) {
        if (args === null)
          if (isAsync) {
            return await f();
          } else return f();
        else if (isAsync) {
          return await f(...args);
        } else return f(...args);
      } else throw new Error(`Function not found - ${fqFnName}`);
    } else throw new Error(`JavaScript module ${refs[0]} not found`);
  } catch (reason: any) {
    const pf: Function | undefined = maybeEvalFunction(fqFnName);
    if (pf instanceof Function) {
      if (args === null) {
        if (isAsync) return await pf();
        else return pf();
      } else {
        if (isAsync) return await pf(...args.slice(0, args.length - 1));
        else return pf(...args.slice(0, args.length - 1));
      }
    } else {
      throw new Error(reason);
    }
  }
}

export function getModuleFn(fqFnName: string): Function | undefined {
  const refs: string[] = splitRefs(fqFnName);
  const m = importedModules.get(refs[0]);
  if (m !== undefined) {
    return m[refs[1]];
  } else return undefined;
}

setModuleFnFetcher(getModuleFn);
