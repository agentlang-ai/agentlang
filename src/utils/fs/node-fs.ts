/**
 * Node.js filesystem implementation
 */
import * as fs from 'node:fs/promises';
import { Stats } from 'node:fs';
import * as path from 'node:path';
import { ExtendedFileSystem, FileStat } from './interfaces.js';

/**
 * Convert Node.js fs.Stats to our FileStat interface
 */
function convertStats(stats: Stats): FileStat {
  return {
    isFile: () => stats.isFile(),
    isDirectory: () => stats.isDirectory(),
    isSymbolicLink: () => stats.isSymbolicLink(),
    size: stats.size,
    mtime: stats.mtime,
  };
}

/**
 * Node.js filesystem implementation
 */
export class NodeFileSystem implements ExtendedFileSystem {
  /**
   * Read a file as text
   * @param filePath Path to the file
   * @returns Promise resolving to file content as string
   */
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }

  /**
   * Read a file as binary
   * @param filePath Path to the file
   * @returns Promise resolving to file content as Buffer
   */
  async readFileBuffer(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  /**
   * Write content to a file
   * @param filePath Path to the file
   * @param data Content to write (string or Buffer)
   * @returns Promise that resolves when write is complete
   */
  async writeFile(filePath: string, data: string | Buffer): Promise<void> {
    // Ensure the directory exists
    const dir = path.dirname(filePath);
    await this.ensureDir(dir);

    return fs.writeFile(filePath, data);
  }

  /**
   * Check if a file or directory exists
   * @param filePath Path to check
   * @returns Promise resolving to boolean which indicates existence
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a directory
   * @param dirPath Directory path to create
   * @returns Promise that resolves when directory is created
   */
  async mkdir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath);
    } catch (err: any) {
      // Ignore if the directory already exists
      if (err.code !== 'EEXIST') {
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
    return fs.readdir(dirPath);
  }

  /**
   * Get stats for a file or directory
   * @param filePath Path to check
   * @returns Promise resolving to stats object
   */
  async stat(filePath: string): Promise<FileStat> {
    const stats = await fs.stat(filePath);
    return convertStats(stats);
  }

  /**
   * Remove a file
   * @param filePath Path to the file
   * @returns Promise that resolves when a file is removed
   */
  async unlink(filePath: string): Promise<void> {
    return fs.unlink(filePath);
  }

  /**
   * Remove a directory
   * @param dirPath Path to the directory
   * @returns Promise that resolves when directory is removed
   */
  async rmdir(dirPath: string): Promise<void> {
    return fs.rmdir(dirPath);
  }

  /**
   * Copy a file
   * @param src Source path
   * @param dest Destination path
   * @returns Promise that resolves when copy is complete
   */
  async copyFile(src: string, dest: string): Promise<void> {
    // Ensure destination directory exists
    const destDir = path.dirname(dest);
    await this.ensureDir(destDir);

    return fs.copyFile(src, dest);
  }

  /**
   * Move a file
   * @param src Source path
   * @param dest Destination path
   * @returns Promise that resolves when move is complete
   */
  async moveFile(src: string, dest: string): Promise<void> {
    // Ensure destination directory exists
    const destDir = path.dirname(dest);
    await this.ensureDir(destDir);

    return fs.rename(src, dest);
  }

  /**
   * Ensure a directory exists, creating it and any parent directories if needed
   * @param dirPath Directory path
   * @returns Promise that resolves when directory exists
   */
  async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err: any) {
      // Ignore if the directory already exists
      if (err.code !== 'EEXIST') {
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
    return fs.rm(dirPath, { recursive: true, force: true });
  }
}

/**
 * Create a new Node.js filesystem instance
 * @returns NodeFileSystem instance
 */
export function createNodeFS(): ExtendedFileSystem {
  return new NodeFileSystem();
}
