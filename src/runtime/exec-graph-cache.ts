import type { ExecGraph } from './defs.js';

const graphCache = new Map<string, ExecGraph>();

/** Drop cached graphs so workflow/agent structure changes after module reload are picked up. */
export function clearExecutionGraphCache(): void {
  graphCache.clear();
}

export function getExecutionGraphCache(): Map<string, ExecGraph> {
  return graphCache;
}
