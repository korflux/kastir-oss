import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/Cdn/cloudflarePurge", () => ({
  cloudflarePurge: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildPublicMediaUrl,
  isPublicMediaUrlReady,
  parseInternalUploadsPath,
} from "@/lib/Modules/Media/publicUrl";
import { MediaService, type MediaDatabase } from "@/lib/Modules/Media/Service";
import type { MediaFileRecord } from "@/lib/Modules/Media/Types";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";

describe("isPublicMediaUrlReady", () => {
  it("allows copy only when processing is READY", () => {
    expect(isPublicMediaUrlReady("READY")).toBe(true);
    expect(isPublicMediaUrlReady("PROCESSING")).toBe(false);
    expect(isPublicMediaUrlReady("FAILED")).toBe(false);
  });
});

describe("parseInternalUploadsPath", () => {
  it("parses relative and absolute public media URLs", () => {
    expect(
      parseInternalUploadsPath(
        "/uploads/d657a4a6-d159-490c-b592-0c5d8fa5c464/book.webp",
      ),
    ).toEqual({
      mediaId: "d657a4a6-d159-490c-b592-0c5d8fa5c464",
      fileName: "book.webp",
    });
    expect(
      parseInternalUploadsPath(
        "https://kastir.example/uploads/d657a4a6-d159-490c-b592-0c5d8fa5c464/book.webp?v=1",
      ),
    ).toEqual({
      mediaId: "d657a4a6-d159-490c-b592-0c5d8fa5c464",
      fileName: "book.webp",
    });
  });

  it("rejects traversal and non-uploads paths", () => {
    expect(parseInternalUploadsPath("/uploads/../secret")).toBeNull();
    expect(parseInternalUploadsPath("/media/id/file.webp")).toBeNull();
    expect(
      parseInternalUploadsPath("https://cdn.example/hero.webp"),
    ).toBeNull();
  });

  it("builds the canonical public path", () => {
    expect(buildPublicMediaUrl("id", "hero.webp")).toBe(
      "/uploads/id/hero.webp",
    );
  });
});

describe("MediaService public readiness", () => {
  const roots: string[] = [];
  let publicDir: string;

  beforeEach(async () => {
    publicDir = await mkdtemp(join(tmpdir(), "kastir-media-ready-"));
    roots.push(publicDir);
  });

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  function record(overrides: Partial<MediaFileRecord> = {}): MediaFileRecord {
    const now = new Date();
    return {
      id: "media-id",
      name: "hero",
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      mimeType: "image/webp",
      category: "IMAGE_RASTER",
      sizeBytes: 12,
      alt: null,
      description: null,
      folderId: "base-id",
      processingStatus: "READY",
      processingToken: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it("hasPublicBytes is true only when READY and the public file exists", async () => {
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    const files = [record()];
    const database = {
      mediaFolder: { findUnique: vi.fn() },
      mediaFile: {
        findUnique: vi.fn(async () => files[0]),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      logEntry: { create: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(database),
      ),
    } as unknown as MediaDatabase;
    const service = new MediaService(database, storage);

    await expect(service.hasPublicBytes(files[0])).resolves.toBe(false);
    await storage.writePublic("media-id", "hero.webp", Buffer.from("webp"));
    await expect(service.hasPublicBytes(files[0])).resolves.toBe(true);
    await expect(
      service.hasPublicBytes(record({ processingStatus: "PROCESSING" })),
    ).resolves.toBe(false);
  });

  it("reconcilePublicReadiness marks READY without bytes as FAILED", async () => {
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    const files = [record()];
    const database = {
      mediaFolder: { findUnique: vi.fn() },
      mediaFile: {
        findUnique: vi.fn(async () => files[0]),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(
          async ({
            data,
          }: {
            where: { id: string };
            data: Partial<MediaFileRecord>;
          }) => {
            Object.assign(files[0], data);
            return files[0];
          },
        ),
        delete: vi.fn(),
      },
      logEntry: { create: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(database),
      ),
    } as unknown as MediaDatabase;
    const service = new MediaService(database, storage);

    const reconciled = await service.reconcilePublicReadiness(files[0]);
    expect(reconciled.processingStatus).toBe("FAILED");
  });

  it("listMedia self-heals a READY record whose public file is gone", async () => {
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    const files = [
      record(),
      record({ id: "media-id-2", fileName: "kept.webp" }),
    ];
    await storage.writePublic("media-id-2", "kept.webp", Buffer.from("webp"));

    const database = {
      mediaFolder: { findUnique: vi.fn() },
      mediaFile: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => files),
        create: vi.fn(),
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<MediaFileRecord>;
          }) => {
            const target = files.find((file) => file.id === where.id)!;
            Object.assign(target, data);
            return target;
          },
        ),
        delete: vi.fn(),
      },
      logEntry: { create: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(database),
      ),
    } as unknown as MediaDatabase;
    const service = new MediaService(database, storage);

    const list = await service.listMedia({});
    expect(list.find((item) => item.id === "media-id")?.processingStatus).toBe(
      "FAILED",
    );
    expect(
      list.find((item) => item.id === "media-id-2")?.processingStatus,
    ).toBe("READY");
  });
});
