import { builtinModules } from "node:module";
import { defineConfig } from "vite";

export default defineConfig({
  define: { __ADHISTHANA_VERSION__: JSON.stringify("0.1.0") },
  build: {
    ssr: "distribution/entry.ts",
    outDir: "dist",
    target: "node22",
    emptyOutDir: true,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`), "fastify", "@fastify/cors"],
      output: { entryFileNames: "cli.mjs" }
    }
  }
});
