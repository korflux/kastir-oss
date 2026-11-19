import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const MUTATION = /export async function (POST|PUT|PATCH|DELETE)\b/;

describe("panel mutation origin contract", () => {
  it("requires a trusted-origin gate on every admin mutation handler", () => {
    const files = walk("app/api/admin").filter((file) =>
      file.endsWith("route.ts"),
    );
    const missing = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      if (!MUTATION.test(source)) return false;
      return (
        !source.includes("getTrustedPanelMutationAuth") &&
        !source.includes("requireTrustedPanelMutation")
      );
    });

    expect(missing).toEqual([]);
  });
});
