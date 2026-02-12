export {
  getOrCreateSession,
  retrieveMemoryContext,
  buildMemoryContextString,
  storeEpisode,
  extractAndStoreFacts,
  addMemoryToGraph,
  markMemoryOutdated,
  loadMemoriesIntoGraph,
  resetLoadedContainers,
  trackInstanceInteraction,
  getMemoriesForInstance,
  createInstanceMemory,
  type SessionContext,
  type MemoryContext,
  type InstanceReference,
} from './service.js';

export {
  extractFactsFromConversation,
  storeExtractedFacts,
  type ExtractedFact,
} from './fact-extraction.js';

export {
  getMemoryGraph,
  resetMemoryGraph,
  type MemoryNode,
  type MemoryEdge,
  type EdgeType,
  MemoryGraph,
} from './graph.js';
