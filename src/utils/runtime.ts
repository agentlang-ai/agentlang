export let chalk: any;

// Environment detection
export const isNodeEnv =
  typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

if (isNodeEnv) {
  // Only import Node.js modules in Node environment
  // Using dynamic imports to avoid breaking browser bundling
  import('chalk').then(module => {
    chalk = module.default;
  });
}

export function isExecGraphEnabled(): boolean {
  if (isNodeEnv) {
    const flag = process.env['AL_EXEC_GRAPH_ENABLED'];
    if (flag != undefined && flag == 'false') {
      return false;
    }
  }
  return true;
}

// Browser-compatible path utilities
export const browserPath = {
  extname: (path: string): string => {
    const lastDotIndex = path.lastIndexOf('.');
    return lastDotIndex !== -1 ? path.substring(lastDotIndex) : '';
  },
  basename: (path: string, ext?: string): string => {
    let name = path.split('/').pop() || '';
    if (ext && name.endsWith(ext)) {
      name = name.substring(0, name.length - ext.length);
    }
    return name;
  },
  dirname: (path: string): string => {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/') || '.';
  },
  join: (...parts: string[]): string => {
    return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
  },
  resolve: (path: string): string => {
    return path;
  },
  sep: '/',
};

// Use either Node.js path or browser path based on environment
export const path = isNodeEnv ? await import('node:path').then(module => module) : browserPath;
