import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JobStore } from "@/lib/Modules/Backup/JobStore";

const roots: string[] = [];

async function tempStore() {
  const root = await mkdtemp(join(tmpdir(), "kastir-jobs-"));
  roots.push(root);
  return new JobStore(root);
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("JobStore id and claim", () => {
  it("rejects traversal ids without reading outside the jobs root", async () => {
    const store = await tempStore();
    const job = await store.create({ kind: "import", userId: "admin" });

    await expect(store.get("../../package")).resolves.toBeNull();
    await expect(store.get("a/b")).resolves.toBeNull();
    await expect(store.get("a\\b")).resolves.toBeNull();
    await expect(store.get(job.id)).resolves.toMatchObject({ id: job.id });
  });

  it("lets only one parallel tryClaim win", async () => {
    const store = await tempStore();
    const job = await store.create({ kind: "import", userId: "admin" });

    const [first, second] = await Promise.all([
      store.tryClaim(job.id, ["queued"]),
      store.tryClaim(job.id, ["queued"]),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    await expect(store.get(job.id)).resolves.toMatchObject({
      id: job.id,
      status: "running",
    });
  });
});
