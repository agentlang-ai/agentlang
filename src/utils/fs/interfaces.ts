/**
 * Interfaces for filesystem operations
 */

/**
 * Basic filesystem interface that abstracts common operations
 */
export interface FileSystem {
  /**
   * Read a file as text
   * @param path Path to the file
   * @returns Promise resolving to file content as string
   */
  readFile(path: string): Promise<string>;

  /**
   * Read a file as binary
   * @param path Path to the file
   * @returns Promise resolving to file content as Buffer
   */
  readFileBuffer(path: string): Promise<Buffer>;

  /**
   * Write content to a file
   * @param path Path to the file
   * @param data Content to write (string or Buffer)
   * @returns Promise that resolves when write is complete
   */
  writeFile(path: string, data: string | Buffer): Promise<void>;

  /**
   * Check if a file or directory exists
   * @param path Path to check
   * @returns Promise resolving to boolean which indicates existence
   */
  exists(path: string): Promise<boolean>;

  /**
   * Create a directory
   * @param path Directory path to create
   * @returns Promise that resolves when directory is created
   */
  mkdir(path: string): Promise<void>;

  /**
   * List files in a directory
   * @param path Directory path
   * @returns Promise resolving to array of file names
   */
  readdir(path: string): Promise<string[]>;

  /**
   * Get stats for a file or directory
   * @param path Path to check
   * @returns Promise resolving to stats object
   */
  stat(path: string): Promise<FileStat>;

  /**
   * Remove a file
   * @param path Path to the file
   * @returns Promise that resolves when file is removed
   */
  unlink(path: string): Promise<void>;

  /**
   * Remove a directory
   * @param path Path to the directory
   * @returns Promise that resolves when directory is removed
   */
  rmdir(path: string): Promise<void>;
}

/**
 * File stats interface
 */
export interface FileStat {
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
  size: number;
  mtime: Date;
}

/**
 * Extended filesystem interface with additional operations
 */
export interface ExtendedFileSystem extends FileSystem {
  /**
   * Copy a file
   * @param src Source path
   * @param dest Destination path
   * @returns Promise that resolves when copy is complete
   */
  copyFile(src: string, dest: string): Promise<void>;

  /**
   * Move a file
   * @param src Source path
   * @param dest Destination path
   * @returns Promise that resolves when move is complete
   */
  moveFile(src: string, dest: string): Promise<void>;

  /**
   * Ensure a directory exists, creating it and any parent directories if needed
   * @param path Directory path
   * @returns Promise that resolves when directory exists
   */
  ensureDir(path: string): Promise<void>;

  /**
   * Remove a directory and all its contents recursively
   * @param path Directory path
   * @returns Promise that resolves when directory is removed
   */
  removeDir(path: string): Promise<void>;
}
