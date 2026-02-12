/**
 * Filesystem module exports
 */

export * from './interfaces.js';
import { ExtendedFileSystem } from './interfaces.js';

/**
 * Create the appropriate filesystem implementation based on environment
 * Uses dynamic imports to avoid bundling Node.js-specific code in browser builds
 * @returns Promise resolving to appropriate filesystem implementation
 */
export async function createFS(options?: any): Promise<ExtendedFileSystem> {
  // Check if we're in a browser or Node environment
  if (typeof window === 'undefined') {
    // Node.js environment - use dynamic import to avoid bundling in browser
    const { createNodeFS } = await import('./node-fs.js');
    return createNodeFS();
  } else {
    // Browser environment - use Lightning FS
    const { createLightningFS } = await import('./lightning-fs.js');
    return createLightningFS(options);
  }
}

// Re-export interface types (these are safe for browser)
export * from './interfaces.js';

// Export factory functions that use dynamic imports internally
// These are async to support dynamic loading based on environment

/**
 * Create Node.js filesystem - only works in Node.js environment
 * @returns Promise resolving to NodeFileSystem instance
 */
export async function createNodeFS(): Promise<ExtendedFileSystem> {
  if (typeof window !== 'undefined') {
    throw new Error('createNodeFS is only available in Node.js environment');
  }
  const module = await import('./node-fs.js');
  return module.createNodeFS();
}

/**
 * Create Lightning FS - works in browser environment
 * @param options Optional configuration for Lightning FS
 * @returns Promise resolving to LightningFileSystem instance
 */
export async function createLightningFS(options?: any): Promise<ExtendedFileSystem> {
  const module = await import('./lightning-fs.js');
  return module.createLightningFS(options);
}
