/**
 * Browser filesystem implementation using Lightning FS
 */
import { ExtendedFileSystem, FileStat } from "./interfaces.js";
import LightningFS from "@isomorphic-git/lightning-fs";

/**
 * Convert Lightning FS stats to our FileStat interface
 */
function convertStats(stats: any): FileStat {
  return {
    isFile: () => stats.isFile(),
    isDirectory: () => stats.isDirectory(),
    isSymbolicLink: () => false,
    size: stats.size,
    mtime: stats.mtime,
  };
}

/**
 * Browser filesystem implementation using Lightning FS
 */
export class LightningFileSystem implements ExtendedFileSystem {
  private fs: any;
  private initialized: boolean = false;

  /**
   * Initialize Lightning FS
   * @param options Lightning FS options
   * @returns Promise that resolves when Lightning FS is initialized
   */
  async initialize(
    options: {
      name?: string;
      wipe?: boolean;
      persistentStorage?: boolean;
    } = {},
  ): Promise<void> {
    if (this.initialized) {
      return;
    }

    const name = options.name || "fs";
    const lfs = new LightningFS(name, { wipe: options.wipe });
    this.fs = lfs.promises;
    this.initialized = true;
  }

  /**
   * Ensure Lightning FS is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "LightningFileSystem is not initialized. Call initialize() first.",
      );
    }
  }

  /**
   * Read a file as text
   * @param filePath path to the file
   * @returns Promise resolving to file content as string
   */
  async readFile(filePath: string): Promise<string> {
    this.ensureInitialized();
    const buffer = await this.fs.readFile(filePath, { encoding: "utf8" });
    return buffer.toString();
  }

  /**
   * Read a file as binary
   * @param filePath Path to the file
   * @returns Promise resolving to file content as Buffer
   */
  async readFileBuffer(filePath: string): Promise<Buffer> {
    this.ensureInitialized();
    return this.fs.readFile(filePath);
  }

  /**
   * Write content to a file
   * @param filePath Path to the file
   * @param data Content to write (string or Buffer)
   * @returns Promise that resolves when write is complete
   */
  async writeFile(filePath: string, data: string | Buffer): Promise<void> {
    this.ensureInitialized();

    // Ensure the directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir) {
      await this.ensureDir(dir);
    }

    return this.fs.writeFile(filePath, data);
  }

  /**
   * Check if a file or directory exists
   * @param filePath Path to check
   * @returns Promise resolving to boolean indicate existence
   */
  async exists(filePath: string): Promise<boolean> {
    this.ensureInitialized();
    try {
      await this.fs.stat(filePath);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Create a directory
   * @param dirPath Directory path to create
   * @returns Promise that resolves when directory is created
   */
  async mkdir(dirPath: string): Promise<void> {
    this.ensureInitialized();
    try {
      return await this.fs.mkdir(dirPath);
    } catch (err: any) {
      // Ignore if the directory already exists
      if (err.code !== "EEXIST") {
        throw err;
      }
    }
  }

  /**
   * List files in a directory
   * @param dirPath Directory path
   * @returns Promise resolving to an array of file names
   */
  async readdir(dirPath: string): Promise<string[]> {
    this.ensureInitialized();
    return this.fs.readdir(dirPath);
  }

  /**
   * Get stats for a file or directory
   * @param filePath Path to check
   * @returns Promise resolving to stats object
   */
  async stat(filePath: string): Promise<FileStat> {
    this.ensureInitialized();
    const stats = await this.fs.stat(filePath);
    return convertStats(stats);
  }

  /**
   * Remove a file
   * @param filePath Path to the file
   * @returns Promise that resolves when a file is removed
   */
  async unlink(filePath: string): Promise<void> {
    this.ensureInitialized();
    return this.fs.unlink(filePath);
  }

  /**
   * Remove a directory
   * @param dirPath Path to the directory
   * @returns Promise that resolves when directory is removed
   */
  async rmdir(dirPath: string): Promise<void> {
    this.ensureInitialized();
    return this.fs.rmdir(dirPath);
  }

  /**
   * Copy a file
   * @param src Source path
   * @param dest Destination path
   * @returns Promise that resolves when copy is complete
   */
  async copyFile(src: string, dest: string): Promise<void> {
    this.ensureInitialized();

    // Ensure destination directory exists
    const destDir = dest.substring(0, dest.lastIndexOf("/"));
    if (destDir) {
      await this.ensureDir(destDir);
    }

    // Manual implementation
    const content = await this.readFileBuffer(src);
    return this.writeFile(dest, content);
  }

  /**
   * Move a file
   * @param src Source path
   * @param dest Destination path
   * @returns Promise that resolves when move is complete
   */
  async moveFile(src: string, dest: string): Promise<void> {
    this.ensureInitialized();

    // Ensure destination directory exists
    const destDir = dest.substring(0, dest.lastIndexOf("/"));
    if (destDir) {
      await this.ensureDir(destDir);
    }

    // Copy then delete the original
    await this.copyFile(src, dest);
    await this.unlink(src);
  }

  /**
   * Ensure a directory exists, creating it and any parent directories if needed
   * @param dirPath Directory path
   * @returns Promise that resolves when directory exists
   */
  async ensureDir(dirPath: string): Promise<void> {
    this.ensureInitialized();

    // Check if the directory already exists
    const exists = await this.exists(dirPath);
    if (exists) {
      return;
    }

    // Create with a recursive option (Lightning FS supports this)
    try {
      await this.fs.mkdir(dirPath, { recursive: true });
    } catch (err: any) {
      // Ignore if the directory already exists (race condition)
      if (err.code !== "EEXIST") {
        throw err;
      }
    }
  }

  /**
   * Remove a directory and all its contents recursively
   * @param dirPath Directory path
   * @returns Promise that resolves when directory is removed
   */
  async removeDir(dirPath: string): Promise<void> {
    this.ensureInitialized();

    // Check if path exists
    const exists = await this.exists(dirPath);
    if (!exists) {
      return;
    }

    // Get stats to check if it's a file or directory
    const stats = await this.stat(dirPath);

    if (stats.isFile()) {
      // If it's a file, just unlink it
      return this.unlink(dirPath);
    }

    // If it's a directory, remove all contents first
    const files = await this.readdir(dirPath);

    // Remove each file/directory in the directory
    for (const file of files) {
      const filePath = `${dirPath}/${file}`;
      await this.removeDir(filePath);
    }

    // Finally, remove the empty directory
    return this.rmdir(dirPath);
  }
}

/**
 * Create a new Lightning FS instance
 * @param options Configuration options
 * @returns Promise resolving to LightningFileSystem instance
 */
export async function createLightningFS(options?: {
  name?: string;
  wipe?: boolean;
}): Promise<ExtendedFileSystem> {
  const fs = new LightningFileSystem();
  await fs.initialize(options);
  return fs;
}
