import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/Cdn/cloudflarePurge", () => ({
  cloudflarePurge: vi.fn().mockResolvedValue(undefined),
}));

import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import { processMediaWebpJob } from "@/lib/Processing/convertToWebp";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function createMutableDatabase(initial: {
  id: string;
  name: string;
  fileName: string;
  url: string;
  processingStatus: "PROCESSING" | "READY" | "FAILED";
  processingToken: string | null;
}) {
  const mediaFile = { ...initial };
  const logEntry = { create: vi.fn().mockResolvedValue({}) };

  return {
    mediaFile: {
      state: mediaFile,
      findUnique: vi.fn(async () => ({ ...mediaFile })),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            processingStatus?: string;
            processingToken?: string | null;
          };
          data: Partial<typeof mediaFile> & {
            mimeType?: string;
            sizeBytes?: number;
          };
        }) => {
          if (where.id !== mediaFile.id) return { count: 0 };
          if (
            where.processingStatus !== undefined &&
            where.processingStatus !== mediaFile.processingStatus
          ) {
            return { count: 0 };
          }
          if (
            where.processingToken !== undefined &&
            where.processingToken !== mediaFile.processingToken
          ) {
            return { count: 0 };
          }
          Object.assign(mediaFile, data);
          return { count: 1 };
        },
      ),
    },
    logEntry,
  };
}

describe("WebP processing job", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
    vi.mocked(cloudflarePurge).mockClear();
  });

  it("converts the staged raster with the fixed compression settings", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    roots.push(publicDir);
    const stagingDir = join(publicDir, "staging");
    const storage = createMediaStorage(publicDir, stagingDir);
    await storage.writeStaging("job-1", PNG_BUFFER);

    const database = createMutableDatabase({
      id: "media-id",
      name: "hero",
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      processingStatus: "PROCESSING",
      processingToken: "token",
    });

    await processMediaWebpJob(
      {
        data: {
          type: "media-webp",
          mediaFileId: "media-id",
          processingToken: "token",
          stagingKey: "job-1",
          userId: "user-id",
        },
      } as never,
      { database, storage },
    );

    const output = await readFile(
      join(publicDir, "uploads", "media-id", "hero.webp"),
    );
    expect(output.subarray(0, 4)).toEqual(Buffer.from("RIFF"));
    expect(database.mediaFile.state).toMatchObject({
      mimeType: "image/webp",
      processingStatus: "READY",
      processingToken: null,
      sizeBytes: output.length,
    });
    expect(database.mediaFile.updateMany).toHaveBeenCalledWith({
      where: {
        id: "media-id",
        processingStatus: "PROCESSING",
        processingToken: "token",
      },
      data: expect.objectContaining({
        mimeType: "image/webp",
        processingStatus: "READY",
        processingToken: null,
        sizeBytes: output.length,
      }),
    });
    expect(cloudflarePurge).toHaveBeenCalledWith("/uploads/media-id/hero.webp");
    await expect(readFile(join(stagingDir, "job-1"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("ignores a stale job without publishing its staged data", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    roots.push(publicDir);
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writeStaging("job-stale", PNG_BUFFER);
    const database = createMutableDatabase({
      id: "media-id",
      name: "hero",
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      processingStatus: "PROCESSING",
      processingToken: "new-token",
    });

    await processMediaWebpJob(
      {
        data: {
          type: "media-webp",
          mediaFileId: "media-id",
          processingToken: "old-token",
          stagingKey: "job-stale",
          userId: "user-id",
        },
      } as never,
      { database, storage },
    );

    expect(database.mediaFile.updateMany).not.toHaveBeenCalled();
    await expect(
      readFile(join(publicDir, "uploads", "media-id", "hero.webp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite the live file when the token changes mid-job (replace race)", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    roots.push(publicDir);
    const stagingDir = join(publicDir, "staging");
    const storage = createMediaStorage(publicDir, stagingDir);
    await storage.writeStaging("job-old", PNG_BUFFER);

    const liveDir = join(publicDir, "uploads", "media-id");
    await mkdir(liveDir, { recursive: true });
    await writeFile(
      join(liveDir, "hero.webp"),
      Buffer.from("previous-live-webp"),
    );

    const database = createMutableDatabase({
      id: "media-id",
      name: "hero",
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      processingStatus: "PROCESSING",
      processingToken: "old-token",
    });

    // After conversion would start, a replace claims a new token.
    database.mediaFile.updateMany.mockImplementationOnce(async () => {
      database.mediaFile.state.processingToken = "new-token";
      database.mediaFile.state.processingStatus = "PROCESSING";
      return { count: 0 };
    });

    await processMediaWebpJob(
      {
        data: {
          type: "media-webp",
          mediaFileId: "media-id",
          processingToken: "old-token",
          stagingKey: "job-old",
          userId: "user-id",
        },
      } as never,
      { database, storage },
    );

    await expect(readFile(join(liveDir, "hero.webp"), "utf8")).resolves.toBe(
      "previous-live-webp",
    );
    await expect(
      readFile(join(liveDir, "pending-old-token.webp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(database.mediaFile.state.processingToken).toBe("new-token");
    expect(cloudflarePurge).not.toHaveBeenCalled();
  });

  it("marks FAILED and logs when conversion throws for the current token", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    roots.push(publicDir);
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writeStaging("job-bad", Buffer.from("not-an-image"));

    const database = createMutableDatabase({
      id: "media-id",
      name: "hero",
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      processingStatus: "PROCESSING",
      processingToken: "token",
    });

    await expect(
      processMediaWebpJob(
        {
          data: {
            type: "media-webp",
            mediaFileId: "media-id",
            processingToken: "token",
            stagingKey: "job-bad",
            userId: "user-id",
          },
        } as never,
        { database, storage },
      ),
    ).rejects.toThrow();

    expect(database.mediaFile.state.processingStatus).toBe("FAILED");
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-id",
        action: "MEDIA_PROCESSING_FAILED",
        objectType: "MEDIA",
        objectLabel: "hero (/uploads/media-id/hero.webp)",
      }),
    });
  });
});
