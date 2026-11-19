import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compilePage } from "@/lib/Publishing/compile";
import { createPageFileStore } from "@/lib/Publishing/fileStore";

describe("static publishing file store", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("compiles the blob exactly without injecting SEO", () => {
    const content =
      "<!doctype html><html><body><script>window.x = 1</script></body></html>";

    expect(compilePage({ content, seoTitle: "Ignored SEO" })).toBe(content);
  });

  it("writes the exact blob under the static Next public path", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-pages-"));
    directories.push(publicDir);
    const store = createPageFileStore(publicDir);
    const content = "<h1>Published</h1>\n<style>body { color: red }</style>";

    await store.write("landing-page", content);

    await expect(
      readFile(join(publicDir, "landing-page", "index.html"), "utf8"),
    ).resolves.toBe(content);
    await expect(store.read("landing-page")).resolves.toBe(content);
  });

  it("removes a page idempotently and rejects reserved/path slugs", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-pages-"));
    directories.push(publicDir);
    const store = createPageFileStore(publicDir);

    await store.write("landing-page", "<p>Published</p>");
    await store.remove("landing-page");
    await store.remove("landing-page");

    await expect(store.read("landing-page")).resolves.toBeNull();
    await expect(store.write("admin", "blocked")).rejects.toThrow();
    await expect(store.write("../escape", "blocked")).rejects.toThrow();
    await expect(readdir(publicDir)).resolves.toEqual([]);
  });
});
