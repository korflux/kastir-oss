// Bundles scripts/bootstrap-runtime.ts into a single minified ESM file so the
// production image can boot the Master bootstrap without shipping lib/ as
// TypeScript (and without tsx). Used by the Dockerfile builder stage.
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [path.join(root, "scripts/bootstrap-runtime.ts")],
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: path.join(root, "scripts/bootstrap-runtime.mjs"),
  // packages:"external" runs before tsconfig paths and would leave "@/..." as
  // bare imports. Resolve "@/*" ourselves; only real node_modules packages
  // (zod, argon2, @prisma/adapter-pg, …) stay external for the prod install.
  packages: "external",
  tsconfig: path.join(root, "tsconfig.json"),
  plugins: [
    {
      name: "resolve-at-alias",
      setup(build) {
        build.onResolve({ filter: /^@\// }, async (args) => {
          const result = await build.resolve(`./${args.path.slice(2)}`, {
            resolveDir: root,
            kind: args.kind,
          });
          if (result.errors.length > 0) return { errors: result.errors };
          return { path: result.path };
        });

        // This bundle runs via plain `node scripts/bootstrap-runtime.mjs` in
        // the Docker entrypoint — never through Next's own bundler, so the
        // "react-server" condition that makes server-only's default export a
        // no-op is never active. Left alone, `packages: "external"` re-emits
        // `import "server-only"` verbatim and Node's plain resolution picks
        // the throwing variant, crashing the entrypoint before boot. Some
        // lib/Publishing modules import "server-only" (correctly — it guards
        // against ending up in a client bundle elsewhere in the app), so
        // stub it out for this Node-only, never-bundled-for-the-browser
        // entry point instead of removing the guard everywhere.
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only-stub",
          namespace: "server-only-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "server-only-stub" }, () => ({
          contents: "",
          loader: "js",
        }));
      },
    },
  ],
});

console.log("[bundle-bootstrap] wrote scripts/bootstrap-runtime.mjs");
