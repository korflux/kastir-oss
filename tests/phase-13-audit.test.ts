import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const roots = ["app", "components", "lib", "public-scripts"];
const allowedFiles = new Set([
  "app/globals.css",
  "components/Shared/ColorPicker.tsx",
  "lib/Modules/Pages/Components/PageEditor.tsx",
  "lib/Modules/Shared/FolderSchema.ts",
  // Standalone HTML/CSS strings served outside the app shell — no Tailwind
  // tokens available, same rationale as public-scripts/admin-bar.ts below.
  "lib/Modules/CustomCode/newScriptTemplate.ts",
  "lib/Publishing/installationFallbackHtml.ts",
  "public-scripts/admin-bar.ts",
]);
const sourceExtensions = new Set([".css", ".js", ".ts", ".tsx"]);
const colorLiteralPattern = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)\s*\(/gi;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    if (statSync(absolutePath).isDirectory()) return sourceFiles(absolutePath);
    return sourceExtensions.has(path.extname(entry)) ? [absolutePath] : [];
  });
}

describe("phase 13 static audit", () => {
  it("keeps literal colors inside the documented token/data boundaries", () => {
    const findings = roots
      .flatMap((root) => sourceFiles(path.resolve(process.cwd(), root)))
      .filter((absolutePath) => {
        const relativePath = path
          .relative(process.cwd(), absolutePath)
          .replaceAll(path.sep, "/");
        return allowedFiles.has(relativePath) === false;
      })
      .flatMap((absolutePath) => {
        const relativePath = path.relative(process.cwd(), absolutePath);
        const matches = readFileSync(absolutePath, "utf8").match(
          colorLiteralPattern,
        );
        return matches
          ? matches.map((match) => `${relativePath}: ${match}`)
          : [];
      });

    expect(findings).toEqual([]);
  });
});
