import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeSegment,
  assertWithinRoot,
  createMediaStorage,
  getMediaFilePath,
} from "@/lib/Processing/mediaStorage";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("media storage", () => {
  it("stores a file beneath its media id and can read it back", async () => {
    const root = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    temporaryRoots.push(root);
    const storage = createMediaStorage(root, join(root, "staging"));

    await storage.writePublic("media-id", "hero.webp", Buffer.from("webp"));

    expect(getMediaFilePath(root, "media-id", "hero.webp")).toBe(
      join(root, "uploads", "media-id", "hero.webp"),
    );
    await expect(
      readFile(getMediaFilePath(root, "media-id", "hero.webp"), "utf8"),
    ).resolves.toBe("webp");
  });

  it("rejects traversal in ids and file names", () => {
    expect(() =>
      getMediaFilePath("C:/public", "../escape", "hero.webp"),
    ).toThrow("safe");
    expect(() =>
      getMediaFilePath("C:/public", "media-id", "../escape"),
    ).toThrow("safe");
  });

  it("exports the canonical segment and root guards for other writers", () => {
    expect(() => assertSafeSegment("../escape", "mediaId")).toThrow("safe");
    expect(() => assertSafeSegment("ok.webp", "fileName")).not.toThrow();
    expect(() =>
      assertWithinRoot("C:/public/uploads", "C:/public/uploads/../secret"),
    ).toThrow("not safe");
    expect(
      assertWithinRoot("C:/public/uploads", "C:/public/uploads/id/a.webp"),
    ).toMatch(/uploads[\\/]+id[\\/]+a\.webp$/);
  });

  it("keeps staging outside the public uploads directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    temporaryRoots.push(root);
    const staging = join(root, "private-staging");
    const storage = createMediaStorage(root, staging);

    await storage.writeStaging("job-1", Buffer.from("original"));

    await expect(readFile(join(staging, "job-1"), "utf8")).resolves.toBe(
      "original",
    );
  });

  it("promotes a pending public file onto the final name, replacing any prior file", async () => {
    const root = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    temporaryRoots.push(root);
    const storage = createMediaStorage(root, join(root, "staging"));

    await storage.writePublic("media-id", "hero.webp", Buffer.from("old"));
    await storage.writePublic(
      "media-id",
      "pending-token.webp",
      Buffer.from("new"),
    );
    await storage.promotePublic("media-id", "pending-token.webp", "hero.webp");

    await expect(
      readFile(join(root, "uploads", "media-id", "hero.webp"), "utf8"),
    ).resolves.toBe("new");
    await expect(
      readFile(join(root, "uploads", "media-id", "pending-token.webp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
