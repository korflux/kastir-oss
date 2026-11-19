import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "app/generated/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "public/_kastir/**",
    "next-env.d.ts",
    // Bundle gerado (esbuild) — já no .gitignore; minificado dispara no-unused-* em massa
    "scripts/bootstrap-runtime.mjs",
  ]),
]);

export default eslintConfig;
