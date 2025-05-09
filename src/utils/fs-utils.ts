import { ExtendedFileSystem, createFS } from "../utils/fs/index.js";
import { URI as VSCodeURI } from "vscode-uri";

/**
 * Re-export the URI type from vscode-uri
 */
export type URI = VSCodeURI;

/**
 * Creates a URI from a string
 * @param uriString String representation of a URI
 * @returns URI object
 */
export function createURI(uriString: string): URI {
  return VSCodeURI.parse(uriString);
}

/**
 * Creates a file URI from a file path
 * @param filePath File path (can be absolute or relative)
 * @returns File URI object
 */
export function createFileURI(filePath: string): URI {
  return VSCodeURI.file(filePath);
}

/**
 * Creates a directory URI from a directory path
 * @param dirPath Directory path (can be absolute or relative)
 * @returns Directory URI object
 */
export function createDirectoryURI(dirPath: string): URI {
  // Ensure path ends with a slash for directories
  if (!dirPath.endsWith("/") && !dirPath.endsWith("\\")) {
    dirPath = `${dirPath}/`;
  }
  return VSCodeURI.file(dirPath);
}

/**
 * Helper function to extract filesystem path from URI or string
 * @param uri URI or string representation of URI
 * @returns Filesystem path
 */
export function toFsPath(uri: URI | string): string {
  return typeof uri === "string" ? VSCodeURI.parse(uri).fsPath : uri.fsPath;
}

/**
 * Singleton instance of the filesystem
 */
let fsInstance: ExtendedFileSystem | null = null;

/**
 * Initialize the filesystem with the appropriate implementation based on environment
 * @param options Optional configuration for the filesystem
 * @returns Promise resolving to the filesystem instance
 */
export async function initializeFileSystem(
  options?: any
): Promise<ExtendedFileSystem> {
  if (!fsInstance) {
    fsInstance = await createFS(options);
  }
  return fsInstance;
}

/**
 * Get the filesystem instance, initializing it if necessary
 * @param options Optional configuration for the filesystem
 * @returns Promise resolving to the filesystem instance
 */
export async function getFileSystem(
  options?: any
): Promise<ExtendedFileSystem> {
  return fsInstance || initializeFileSystem(options);
}

/**
 * Read a file as text
 * @param uri URI to the file
 * @returns Promise resolving to file content as string
 */
export async function readFile(uri: URI | string): Promise<string> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.readFile(path);
}

/**
 * Read a file as binary
 * @param uri URI to the file
 * @returns Promise resolving to file content as Buffer
 */
export async function readFileBuffer(uri: URI | string): Promise<Buffer> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.readFileBuffer(path);
}

/**
 * Write content to a file
 * @param uri URI to the file
 * @param data Content to write (string or Buffer)
 * @returns Promise that resolves when write is complete
 */
export async function writeFile(
  uri: URI | string,
  data: string | Buffer
): Promise<void> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.writeFile(path, data);
}

/**
 * Check if a file or directory exists
 * @param uri URI to check
 * @returns Promise resolving to boolean indicating existence
 */
export async function exists(uri: URI | string): Promise<boolean> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.exists(path);
}

/**
 * Create a directory
 * @param uri Directory URI to create
 * @returns Promise that resolves when directory is created
 */
export async function mkdir(uri: URI | string): Promise<void> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.mkdir(path);
}

/**
 * List files in a directory
 * @param uri Directory URI
 * @returns Promise resolving to array of file names
 */
export async function readdir(uri: URI | string): Promise<string[]> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.readdir(path);
}

/**
 * List files in a Directory (Wrapper for readdir)
 * @param uri Directory URI
 * @returns Promise resolving to array of file names
 */
export async function readDirectory(uri: URI | string): Promise<string[]> {
  return readdir(uri);
}

/**
 * Get stats for a file or directory
 * @param uri URI to check
 * @returns Promise resolving to stats object
 */
export async function stat(uri: URI | string): Promise<any> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.stat(path);
}

/**
 * Remove a file
 * @param uri URI to the file
 * @returns Promise that resolves when file is removed
 */
export async function unlink(uri: URI | string): Promise<void> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.unlink(path);
}

/**
 * Remove a directory
 * @param uri URI to the directory
 * @returns Promise that resolves when directory is removed
 */
export async function rmdir(uri: URI | string): Promise<void> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.rmdir(path);
}

/**
 * Copy a file
 * @param srcUri Source URI
 * @param destUri Destination URI
 * @returns Promise that resolves when copy is complete
 */
export async function copyFile(
  srcUri: URI | string,
  destUri: URI | string
): Promise<void> {
  const fs = await getFileSystem();
  const srcPath = toFsPath(srcUri);
  const destPath = toFsPath(destUri);
  return fs.copyFile(srcPath, destPath);
}

/**
 * Move a file
 * @param srcUri Source URI
 * @param destUri Destination URI
 * @returns Promise that resolves when move is complete
 */
export async function moveFile(
  srcUri: URI | string,
  destUri: URI | string
): Promise<void> {
  const fs = await getFileSystem();
  const srcPath = toFsPath(srcUri);
  const destPath = toFsPath(destUri);
  return fs.moveFile(srcPath, destPath);
}

/**
 * Ensure a directory exists, creating it and any parent directories if needed
 * @param uri Directory URI
 * @returns Promise that resolves when directory exists
 */
export async function ensureDir(uri: URI | string): Promise<void> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.ensureDir(path);
}

/**
 * Remove a directory and all its contents recursively
 * @param uri Directory URI
 * @returns Promise that resolves when directory is removed
 */
export async function removeDir(uri: URI | string): Promise<void> {
  const fs = await getFileSystem();
  const path = toFsPath(uri);
  return fs.removeDir(path);
}

/**
 * Determine if we're running in a browser environment
 * @returns boolean indicating if in browser
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Determine if we're running in Node.js environment
 * @returns boolean indicating if in Node.js
 */
export function isNode(): boolean {
  return typeof window === "undefined";
}

/**
 * Joins a URI with path segments
 * @param base Base URI
 * @param pathSegments Path segments to join
 * @returns New URI with joined path
 */
export function joinURI(base: URI | string, ...pathSegments: string[]): URI {
  const baseUri = typeof base === "string" ? VSCodeURI.parse(base) : base;
  let path = baseUri.path;

  // Join the path segments
  for (const segment of pathSegments) {
    // Make sure we don't double up on slashes
    if (path.endsWith("/") && segment.startsWith("/")) {
      path += segment.substring(1);
    } else if (!path.endsWith("/") && !segment.startsWith("/")) {
      path += "/" + segment;
    } else {
      path += segment;
    }
  }

  // Create a new URI with the same scheme and authority but updated path
  return VSCodeURI.from({
    scheme: baseUri.scheme,
    authority: baseUri.authority,
    path,
    query: baseUri.query,
    fragment: baseUri.fragment,
  });
}

/**
 * Gets the parent directory URI from a file or directory URI
 * @param uri URI to get parent from
 * @returns Parent directory URI
 */
export function getParentURI(uri: URI | string): URI {
  const uriObj = typeof uri === "string" ? VSCodeURI.parse(uri) : uri;

  // Split the path into segments
  const segments = uriObj.path.split("/").filter(Boolean);

  // Remove the last segment (file or directory name)
  segments.pop();

  // Create a new path with the parent segments
  const parentPath = "/" + segments.join("/");

  return VSCodeURI.from({
    scheme: uriObj.scheme,
    authority: uriObj.authority,
    path: parentPath,
    query: uriObj.query,
    fragment: uriObj.fragment,
  });
}
