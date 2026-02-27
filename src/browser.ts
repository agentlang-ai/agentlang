// Browser-compatible entry point for agentlang
// This module provides browser-safe exports without Node.js-specific dependencies

// Re-export types
export type { AttributeSpec } from './runtime/module.js';

// Re-export functions that don't depend on Node.js-specific modules
export {
  ModuleEntry,
  fetchModule,
  fetchModuleEntry,
  getUserModuleNames,
  getEntity,
  getRelationship,
  getEntityRbacRules,
  getRecord,
} from './runtime/module.js';

// Re-export loader functions
export { flushAllAndLoad } from './runtime/loader.js';

// Re-export utilities
export { isFqName, nameToPath } from './runtime/util.js';

// Re-export graph utilities
export { buildGraph } from './runtime/relgraph.js';

// Note: Features requiring Node.js modules (fs, LanceDB, etc.) are not available in browser
// Use environment detection to conditionally load these features
