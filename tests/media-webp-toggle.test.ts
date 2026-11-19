import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Cdn/cloudflarePurge", () => ({ cloudflarePurge: vi.fn() }));

import { MediaService } from "@/lib/Modules/Media/Service";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("WebP setting gate", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("stores new raster uploads in their original format without enqueueing when disabled", async () => {
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-webp-toggle-"));
    roots.push(publicDir);
    const database = {
      siteSettings: {
        findUnique: vi.fn(async () => ({
          webpConversionEnabled: false,
          siteUrl: null,
        })),
      },
      mediaFolder: { findUnique: vi.fn(async () => ({ id: "base" })) },
      mediaFile: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }: { data: unknown }) => data),
        update: vi.fn(),
        delete: vi.fn(),
      },
      logEntry: { create: vi.fn(async () => undefined) },
      $transaction: vi.fn(
        async <T>(callback: (tx: typeof database) => Promise<T>) =>
          callback(database),
      ),
    };
    const queue = { add: vi.fn() };
    const service = new MediaService(
      database as never,
      createMediaStorage(publicDir, join(publicDir, "staging")),
      queue as never,
    );

    const uploaded = await service.upload("admin", {
      folderId: "base",
      fileName: "hero.png",
      buffer: PNG_BUFFER,
    });

    expect(uploaded.fileName).toMatch(/\.png$/);
    expect(uploaded.processingStatus).toBe("READY");
    expect(queue.add).not.toHaveBeenCalled();
    await expect(
      readFile(join(publicDir, "uploads", uploaded.id, uploaded.fileName)),
    ).resolves.toEqual(PNG_BUFFER);
  });
});
