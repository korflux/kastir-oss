import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
    // Vite's default order puts .mjs/.js before .ts, so any extensionless
    // import of a TS source file that has a sibling built artifact (e.g.
    // scripts/bootstrap-runtime.ts next to its bundled .mjs) would silently
    // resolve to the stale build output instead of the source under test.
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});
