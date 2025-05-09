/* eslint-disable header/header */
import { defineConfig } from "vite";
import * as path from "path";
import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";

export default defineConfig(() => {
  const config = {
    build: {
      target: "esnext",
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "index.html"),
          monacoClassic: path.resolve(__dirname, "static/monacoClassic.html"),
          monacoExtended: path.resolve(__dirname, "static/monacoExtended.html"),
        },
      },
      commonjsOptions: {
        include: ["@isomorphic-git/lightning-fs", "isomorphic-git"],
      },
    },
    define: {
      global: "globalThis",
    },
    resolve: {
      dedupe: ["vscode"],
      alias: {
        buffer: "buffer",
      },
    },
    optimizeDeps: {
      include: ["@isomorphic-git/lightning-fs", "isomorphic-git", "buffer"],
      esbuildOptions: {
        plugins: [importMetaUrlPlugin],
      },
    },
    server: {
      port: 5173,
    },
  };
  return config;
});
