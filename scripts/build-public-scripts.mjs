import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const entries = [
  {
    source: "public-scripts/admin-bar.ts",
    output: "public/_kastir/admin-bar.js",
  },
  {
    source: "public-scripts/popup-triggers.ts",
    output: "public/_kastir/popup-triggers.js",
  },
];

async function buildEntry({ source, output }) {
  const sourcePath = resolve(projectRoot, source);
  const outputPath = resolve(projectRoot, output);

  const code = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
    fileName: sourcePath,
  }).outputText;

  // The sources intentionally have no imports. Removing their test-only named
  // exports leaves a self-contained browser script without a module loader.
  const browserSource = transpiled.replace(/^export\s+/gm, "");
  const terser = (await import("next/dist/compiled/terser/bundle.min.js"))
    .default;
  const minified = await terser.minify(`(function(){${browserSource}\n})();`, {
    ecma: 2017,
    format: { comments: false },
    module: false,
  });

  if (!minified.code || /\b(import|export)\b/.test(minified.code)) {
    throw new Error(
      `${source} bundle was not emitted as a self-contained script`,
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${minified.code}\n`, "utf8");
  console.log(
    `Generated ${output} (${Buffer.byteLength(minified.code)} bytes)`,
  );
}

for (const entry of entries) {
  await buildEntry(entry);
}
