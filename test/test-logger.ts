/**
 * Test logging utility that only outputs when verbose mode is enabled
 */

const isVerbose = (): boolean => {
  return (
    process.env.VITEST_VERBOSE === 'true' ||
    process.env.DEBUG === 'true' ||
    process.argv.includes('--verbose') ||
    process.argv.includes('--debug')
  );
};

/**
 * Verbose logger that only outputs to stdout when verbose mode is enabled
 */
export const testLogger = {
  /**
   * Log a message only in verbose mode
   */
  verbose: (message: string, ...args: any[]): void => {
    if (isVerbose()) {
      console.log(message, ...args);
    }
  },

  /**
   * Log an error message only in verbose mode
   */
  verboseError: (message: string, ...args: any[]): void => {
    if (isVerbose()) {
      console.error(message, ...args);
    }
  },

  /**
   * Log a warning message only in verbose mode
   */
  verboseWarn: (message: string, ...args: any[]): void => {
    if (isVerbose()) {
      console.warn(message, ...args);
    }
  },

  /**
   * Check if verbose mode is enabled
   */
  isVerbose,
};
