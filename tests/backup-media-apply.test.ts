import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MediaApply } from "@/lib/Modules/Backup/MediaApply";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("MediaApply path guards", () => {
  it("rejects traversal in package asset segments via the shared media guard", async () => {
    const root = await mkdtemp(join(tmpdir(), "kastir-media-apply-"));
    temporaryRoots.push(root);
    const apply = new MediaApply(root);

    await expect(
      apply.stageAssets([
        {
          zipPath: "assets/uploads/../escape/hero.webp",
          mediaId: "../escape",
          fileName: "hero.webp",
          bytes: Buffer.from("webp"),
        },
      ]),
    ).rejects.toThrow("safe");
    await expect(
      apply.stageAssets([
        {
          zipPath: "assets/uploads/media-id/../hero.webp",
          mediaId: "media-id",
          fileName: "../hero.webp",
          bytes: Buffer.from("webp"),
        },
      ]),
    ).rejects.toThrow("safe");
  });
});
