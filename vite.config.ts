/* eslint-disable header/header */
import { defineConfig } from 'vite';
import * as path from 'path';
// Use node: protocol for Node.js built-in modules
import { fileURLToPath } from 'node:url';
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Node.js polyfills configuration
const nodePolyfillsConfig = nodePolyfills({
  // Whether to polyfill `node:` protocol imports.
  protocolImports: true,
});
export default defineConfig({
  plugins: [
    // Node.js polyfills
    nodePolyfillsConfig,
  ],
  worker: {
    format: 'es',
    rollupOptions: {
      external: ['vscode', 'vscode/*', 'node:path', 'node:url'],
    },
  },
  build: {
    outDir: './dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Make sure to use es modules
        format: 'es',
        // Manual chunking for specific dependencies
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
          // Removed monaco-languageclient from manual chunks to let Vite handle it
        },
      },
      // Mark problematic dependencies as external
      external: ['vscode', 'vscode-languageserver-protocol'],
    },
  },
  lib: {
    entry: 'src/main.ts',
    formats: ['es'],
    fileName: () => '[name].js',
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    dedupe: ['vscode'],
    alias: [
      {
        find: 'buffer',
        replacement: 'buffer/',
      },
      {
        find: /^monaco-editor\/esm\/vs\/editor\/editor.api$/,
        replacement: 'monaco-editor/esm/vs/editor/editor.api.js',
      },
    ],
  },
  optimizeDeps: {
    include: ['@isomorphic-git/lightning-fs', 'isomorphic-git', 'buffer', 'monaco-editor'],
    exclude: [
      'vscode',
      'vscode-languageclient',
      'vscode-languageclient/browser',
      'vscode-languageclient/node',
      'vscode-languageserver',
      'vscode-languageserver-protocol',
      'monaco-languageclient',
    ],
    esbuildOptions: {
      plugins: [importMetaUrlPlugin],
      // Ensure Node.js global & built-ins are polyfilled
      define: {
        global: 'globalThis',
      },
      // Support for Node.js built-ins
      mainFields: ['module', 'jsnext:main', 'jsnext'],
      conditions: ['import', 'module', 'browser', 'default'],
      // Add support for Node.js built-ins
      target: 'es2020',
      platform: 'browser',
      // Ensure proper handling of ES modules
      format: 'esm',
      // Node.js polyfills are handled by the plugin
    },
  },
  server: {
    port: 5173,
  },
  ssr: {
    noExternal: ['monaco-editor', 'monaco-languageclient'],
  },
});
