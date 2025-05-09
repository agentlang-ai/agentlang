/**
 * Filesystem module exports
 */

export * from "./interfaces.js";
import { ExtendedFileSystem } from "./interfaces.js";
import { createNodeFS } from "./node-fs.js";
import { createLightningFS } from "./lightning-fs.js";

/**
 * Create the appropriate filesystem implementation based on environment
 * @returns Promise resolving to appropriate filesystem implementation
 */
export async function createFS(options?: any): Promise<ExtendedFileSystem> {
  // Check if we're in a browser or Node environment
  if (typeof window === "undefined") {
    // Node.js environment
    return createNodeFS();
  } else {
    // Browser environment - use Lightning FS
    return createLightningFS(options);
  }
}

// Export the specific filesystem implementations
export { createNodeFS } from "./node-fs.js";
export { createLightningFS } from "./lightning-fs.js";
export * from "./interfaces.js";
