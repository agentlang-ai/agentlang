// Browser-compatible database implementation using SQL.js
// This module provides browser-safe versions of database functions

import initSqlJs from 'sql.js';

// SQL.js database instance
let sqlJsDb: any = null;
let SQL: any = null;

export interface DatabaseConfig {
  store?: {
    type?: string;
  };
}

/**
 * Initialize SQL.js database for browser environment
 */
export async function initDatabase(_config?: DatabaseConfig): Promise<void> {
  if (sqlJsDb) {
    console.log('SQL.js database already initialized');
    return;
  }

  try {
    console.log('Initializing SQL.js database...');
    SQL = await initSqlJs({
      locateFile: (_file: string) => {
        // SQL.js WASM file should be in public directory
        return `/sql-wasm.wasm`;
      },
    });

    // Create an in-memory database
    sqlJsDb = new SQL.Database();
    console.log('SQL.js database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize SQL.js database:', error);
    throw error;
  }
}

/**
 * Reset the SQL.js database
 */
export async function resetDefaultDatabase(): Promise<void> {
  if (sqlJsDb) {
    sqlJsDb.close();
    sqlJsDb = null;
    console.log('SQL.js database reset');
  }
}

/**
 * Get the current SQL.js database instance
 */
export function getSqlJsDb(): any {
  return sqlJsDb;
}

/**
 * Get the SQL.js module
 */
export function getSQL(): any {
  return SQL;
}

/**
 * Check if database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return sqlJsDb !== null;
}

// Default exports for compatibility
export default {
  initDatabase,
  resetDefaultDatabase,
  getSqlJsDb,
  getSQL,
  isDatabaseInitialized,
};
