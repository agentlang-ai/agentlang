// This file is kept for reference but is not used directly anymore
// The monaco-editor-wrapper API has changed significantly in v6+

// These functions are kept for reference but not used directly anymore

/*
export const defineUserServices = () => {
  return {
    userServices: {
      // This API has changed in the latest version
    },
    debugLogging: true,
  };
};

export const configureMonacoWorkers = () => {
  // This function is kept for compatibility, but implementation has changed
  // Use configureDefaultWorkerFactory from monaco-editor-wrapper/workers/workerLoaders in newer code
};

export const configureWorker = () => {
  // vite does not extract the worker properly if it is URL is a variable
  const lsWorker = new Worker(new URL('./language/main-browser', import.meta.url), {
    type: 'module',
    name: 'Agentlang Language Server',
  });

  return {
    type: 'WorkerDirect',
    worker: lsWorker,
  };
};
*/
