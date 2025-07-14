/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://vitest.dev/config/
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // coverage: {
    //     provider: 'v8',
    //     reporter: ['text', 'html'],
    //     include: ['src'],
    //     exclude: ['**/generated'],
    // },
    testTimeout: 0,
    deps: {
      interopDefault: true,
    },
    include: ['**/*.test.ts'],
    // Reduce noise in test output - only show test results
    reporters:
      process.env.VITEST_VERBOSE === 'true' || process.env.DEBUG === 'true'
        ? ['verbose']
        : [['default', { summary: false }]],
    // Suppress console output unless in verbose mode
    silent: !(process.env.VITEST_VERBOSE === 'true' || process.env.DEBUG === 'true'),
  },
});
