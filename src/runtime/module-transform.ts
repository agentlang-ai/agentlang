/**
 * ES6 Module Transformation Utilities
 *
 * Transforms ES6 import/export syntax into code that can be evaluated
 * in a browser environment without native ES6 module support.
 */

import { logger } from './logger.js';

export interface ImportInfo {
  defaultImport?: string;
  namedImports?: string[];
  moduleSpecifier: string;
  fullStatement: string;
}

export interface DynamicImportInfo {
  fullMatch: string;
  templateString: string;
}

export interface TransformResult {
  transformedCode: string;
  imports: ImportInfo[];
  dynamicImports: DynamicImportInfo[];
  exports: string[];
}

/**
 * Parse ES6 import statements from code
 * Matches: import ... from 'url'
 */
export function parseImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Match: import ... from 'url'
  const importRegex = /import\s+(?:(\w+)|{([^}]+)})\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const [fullStatement, defaultImport, namedImports, moduleSpecifier] = match;

    imports.push({
      defaultImport,
      namedImports: namedImports ? namedImports.split(',').map(n => n.trim()) : undefined,
      moduleSpecifier,
      fullStatement,
    });
  }

  return imports;
}

/**
 * Parse dynamic import statements
 * Matches: await import(`${process.cwd()}/...`)
 */
export function parseDynamicImports(content: string): DynamicImportInfo[] {
  const dynamicImports: DynamicImportInfo[] = [];

  const dynamicImportRegex = /await\s+import\s*\(\s*`([^`]+)`\s*\)/g;
  let match;

  while ((match = dynamicImportRegex.exec(content)) !== null) {
    const [fullMatch, templateString] = match;
    dynamicImports.push({
      fullMatch,
      templateString,
    });
  }

  return dynamicImports;
}

/**
 * Parse export statements and extract exported names
 */
export function parseExports(content: string): string[] {
  const exportedNames: string[] = [];

  // Handle: export function name() {}
  const exportFnRegex = /export\s+(async\s+)?function\s+(\w+)/g;
  let match;

  while ((match = exportFnRegex.exec(content)) !== null) {
    exportedNames.push(match[2]);
  }

  // Handle: export const name = ...
  const exportConstRegex = /export\s+(const|let|var)\s+(\w+)/g;

  while ((match = exportConstRegex.exec(content)) !== null) {
    exportedNames.push(match[2]);
  }

  // Handle: export { name1, name2 }
  const exportListRegex = /export\s*{\s*([^}]+)\s*}/g;

  while ((match = exportListRegex.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim().split(' as ')[0].trim());
    exportedNames.push(...names);
  }

  return exportedNames;
}

/**
 * Remove import statements from code
 */
export function removeImportStatements(content: string, imports: ImportInfo[]): string {
  let result = content;

  for (const imp of imports) {
    result = result.replace(imp.fullStatement, '');
  }

  return result;
}

/**
 * Remove export keywords from code
 */
export function removeExportKeywords(content: string): string {
  let result = content;

  // Remove: export function name() {}
  result = result.replace(
    /export\s+(async\s+)?function\s+(\w+)/g,
    (match, async, name) => `${async || ''}function ${name}`
  );

  // Remove: export const name = ...
  result = result.replace(
    /export\s+(const|let|var)\s+(\w+)/g,
    (match, keyword, name) => `${keyword} ${name}`
  );

  // Remove: export { name1, name2 }
  result = result.replace(/export\s*{\s*[^}]+\s*}/g, '');

  return result;
}

/**
 * Replace dynamic imports with variable references
 */
export function replaceDynamicImports(
  content: string,
  dynamicImports: DynamicImportInfo[]
): { code: string; varNames: Map<string, string> } {
  let result = content;
  const varNames = new Map<string, string>();

  for (const dynImp of dynamicImports) {
    // Clean up process.cwd() references
    const cleanedPath = dynImp.templateString.replace(/\$\{process\.cwd\(\)\}/g, '');

    // Create a variable name from the path
    const varName = cleanedPath.split('/').pop()?.replace(/\.js$/, '') || 'dynamicModule';

    varNames.set(cleanedPath, varName);
    result = result.replace(dynImp.fullMatch, varName);
  }

  return { code: result, varNames };
}

/**
 * Generate export assignments
 */
export function generateExportAssignments(exportedNames: string[]): string {
  if (exportedNames.length === 0) {
    return '';
  }

  const assignments = exportedNames.map(name => `exports.${name} = ${name};`).join('\n');

  return `\n\n// Export assignments\n${assignments}`;
}

/**
 * Transform ES6 module code to CommonJS-style code
 */
export function transformModule(content: string): TransformResult {
  logger.debug('Transforming ES6 module code');

  // Parse imports, exports, and dynamic imports
  const imports = parseImports(content);
  const dynamicImports = parseDynamicImports(content);
  const exports = parseExports(content);

  // Remove import statements
  let transformedCode = removeImportStatements(content, imports);

  // Handle dynamic imports
  const { code: codeWithoutDynImports } = replaceDynamicImports(transformedCode, dynamicImports);
  transformedCode = codeWithoutDynImports;

  // Remove export keywords
  transformedCode = removeExportKeywords(transformedCode);

  // Add export assignments
  transformedCode += generateExportAssignments(exports);

  logger.debug(
    `Found ${imports.length} imports, ${dynamicImports.length} dynamic imports, ${exports.length} exports`
  );

  return {
    transformedCode,
    imports,
    dynamicImports,
    exports,
  };
}

/**
 * Create a wrapped function that evaluates the transformed code
 * with injected dependencies
 */
export function wrapModuleCode(transformedCode: string, importedModules: Map<string, any>): string {
  const importNames = Array.from(importedModules.keys());

  const wrappedCode = `
    (function(exports, ${importNames.join(', ')}) {
      ${transformedCode}
      return exports;
    })
  `;

  return wrappedCode;
}

/**
 * Evaluate wrapped module code and return the exports
 */
export function evaluateModule(wrappedCode: string, importedModules: Map<string, any>): any {
  const exportObj: any = {};
  const importValues = Array.from(importedModules.values());

  try {
    const moduleFactory = eval(wrappedCode);
    return moduleFactory(exportObj, ...importValues);
  } catch (error) {
    logger.error('Failed to evaluate module:', error);
    throw error;
  }
}

/**
 * Create CommonJS-style wrapper for code without ES6 imports
 */
export function wrapCommonJSCode(content: string): string {
  return `
    (function(module, exports) {
      ${content}
      return module.exports || exports;
    })
  `;
}

/**
 * Evaluate CommonJS-style code
 */
export function evaluateCommonJS(wrappedCode: string): any {
  const moduleObj: any = { exports: {} };
  const exportsObj: any = {};

  try {
    const moduleFactory = eval(wrappedCode);
    const result = moduleFactory(moduleObj, exportsObj);
    return result || moduleObj.exports || exportsObj;
  } catch (error) {
    logger.error('Failed to evaluate CommonJS module:', error);
    throw error;
  }
}
