import { logger } from './logger.js';
import { setSubscription } from './resolvers/registry.js';
import { now, splitRefs } from './util.js';

const importedModules = new Map<string, any>();

// Usage: importModule("./mymodels/acme.js")
export async function importModule(path: string, name: string) {
  if (importedModules.has(name)) {
    logger.warn(`Alias '${name}' will overwrite a previously imported module`);
  }
  if (!(path.startsWith('/') || path.startsWith('.'))) {
    path = process.cwd() + '/' + path;
  }
  const m = await import(/* @vite-ignore */ path);
  importedModules.set(name, m);
  // e.g of dynamic fn-call:
  //// let f = eval("(a, b) => m.add(a, b)");
  //// console.log(f(10, 20))
  return m;
}

export function moduleImported(moduleName: string): boolean {
  return importedModules.has(moduleName);
}

const ReservedImports = new Set<string>(['resolvers']);

export function valiadteImportName(n: string) {
  if (ReservedImports.has(n)) {
    throw new Error(`${n} is an import reserved by the runtime`);
  }
}

function maybeEvalFunction(fnName: string): Function | undefined {
  try {
    return eval(fnName);
  } catch (reason: any) {
    logger.debug(reason);
    return undefined;
  }
}

function invokeReservedFn(moduleName: string, fnName: string, args: Array<any> | null) {
  if (moduleName == 'resolvers' && fnName == 'setSubscription' && args != null) {
    return setSubscription(args[0], args[1]);
  } else {
    throw new Error(`Failed to call ${moduleName}.${fnName} with the given arguments`);
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
      if (args == null) {
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
    if (ReservedImports.has(mname)) {
      return invokeReservedFn(mname, refs[1], args);
    }
    const m = importedModules.get(mname);
    if (m != undefined) {
      const f = m[refs[1]];
      if (f != undefined) {
        if (args == null)
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
      if (args == null) {
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
  if (m != undefined) {
    return m[refs[1]];
  } else return undefined;
}
