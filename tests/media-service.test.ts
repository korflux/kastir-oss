import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/Cdn/cloudflarePurge", () => ({
  cloudflarePurge: vi.fn().mockResolvedValue(undefined),
}));

import { cloudflarePurge } from "@/lib/Cdn/cloudflarePurge";
import {
  MediaService,
  type MediaDatabase,
  type MediaQueue,
} from "@/lib/Modules/Media/Service";
import type { MediaFileRecord } from "@/lib/Modules/Media/Types";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function createRecord(
  overrides: Partial<MediaFileRecord> = {},
): MediaFileRecord {
  const now = new Date();
  return {
    id: "media-id",
    name: "hero",
    fileName: "hero.webp",
    url: "/uploads/media-id/hero.webp",
    mimeType: "image/webp",
    category: "IMAGE_RASTER",
    sizeBytes: PNG_BUFFER.byteLength,
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

function createFixture(initial: MediaFileRecord[] = [createRecord()]) {
  const files = [...initial];
  const database = {
    mediaFolder: {
      findUnique: vi.fn().mockResolvedValue({ id: "base-id" }),
    },
    mediaFile: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          files.find((file) => file.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async ({ where }: { where?: { folderId?: string } } = {}) =>
          files.filter(
            (file) => !where?.folderId || file.folderId === where.folderId,
          ),
      ),
      create: vi.fn(),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<MediaFileRecord>;
        }) => {
          const file = files.find((candidate) => candidate.id === where.id);
          if (!file) throw new Error("media file missing");
          Object.assign(file, data, { updatedAt: new Date() });
          return file;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = files.findIndex((file) => file.id === where.id);
        if (index < 0) throw new Error("media file missing");
        return files.splice(index, 1)[0];
      }),
    },
    logEntry: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };
  const queue = {
    add: vi.fn().mockResolvedValue({}),
  } as MediaQueue & { add: ReturnType<typeof vi.fn> };

  return {
    database: database as unknown as MediaDatabase,
    rawDatabase: database,
    files,
    queue,
  };
}

describe("MediaService library operations", () => {
  const roots: string[] = [];
  let publicDir: string;

  beforeEach(async () => {
    publicDir = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    roots.push(publicDir);
    vi.mocked(cloudflarePurge).mockClear();
  });

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("updates metadata without changing the public file identity", async () => {
    const fixture = createFixture();
    const service = new MediaService(
      fixture.database,
      createMediaStorage(publicDir, join(publicDir, "staging")),
      fixture.queue,
    );

    const updated = await service.updateMetadata("user-id", {
      id: "media-id",
      name: "Hero image",
      alt: "A hero",
      description: "Homepage hero",
    });

    expect(updated).toMatchObject({
      name: "Hero image",
      alt: "A hero",
      description: "Homepage hero",
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
    });
    expect(fixture.database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "MEDIA_UPDATED",
        objectType: "MEDIA",
      }),
    });
  });

  it("replaces a ready file without changing its id, filename or URL", async () => {
    const fixture = createFixture();
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writePublic(
      "media-id",
      "hero.webp",
      Buffer.from("old-content"),
    );
    const service = new MediaService(fixture.database, storage, fixture.queue);

    const updated = await service.replace("user-id", "media-id", {
      fileName: "new.png",
      buffer: PNG_BUFFER,
    });

    expect(updated).toMatchObject({
      id: "media-id",
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      processingStatus: "PROCESSING",
    });
    expect(fixture.queue.add).toHaveBeenCalledWith(
      expect.stringMatching(/^media-webp-/),
      expect.objectContaining({ mediaFileId: "media-id" }),
      expect.anything(),
    );
    await expect(
      readFile(join(publicDir, "uploads", "media-id", "hero.webp"), "utf8"),
    ).resolves.toBe("old-content");
  });

  it("reserves a WebP filename when replacing a non-WebP raster", async () => {
    const fixture = createFixture([
      createRecord({
        fileName: "hero.png",
        url: "/uploads/media-id/hero.png",
        mimeType: "image/png",
      }),
    ]);
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writePublic(
      "media-id",
      "hero.png",
      Buffer.from("old-content"),
    );
    const service = new MediaService(fixture.database, storage, fixture.queue);

    const updated = await service.replace("user-id", "media-id", {
      fileName: "replacement.png",
      buffer: PNG_BUFFER,
    });

    expect(updated).toMatchObject({
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      mimeType: "image/webp",
      processingStatus: "PROCESSING",
    });
    expect(fixture.queue.add).toHaveBeenCalledWith(
      expect.stringMatching(/^media-webp-/),
      expect.objectContaining({
        mediaFileId: "media-id",
        previousFileName: "hero.png",
        previousUrl: "/uploads/media-id/hero.png",
        previousMimeType: "image/png",
      }),
      expect.anything(),
    );
    await expect(
      readFile(join(publicDir, "uploads", "media-id", "hero.png")),
    ).resolves.toEqual(Buffer.from("old-content"));
  });

  it("restores the previous identity when the replacement queue fails", async () => {
    const fixture = createFixture([
      createRecord({
        fileName: "hero.png",
        url: "/uploads/media-id/hero.png",
        mimeType: "image/png",
      }),
    ]);
    fixture.queue.add.mockRejectedValueOnce(new Error("queue unavailable"));
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writePublic("media-id", "hero.png", Buffer.from("old"));
    const service = new MediaService(fixture.database, storage, fixture.queue);

    const result = await service.replace("user-id", "media-id", {
      fileName: "replacement.png",
      buffer: PNG_BUFFER,
    });

    expect(result).toMatchObject({
      fileName: "hero.png",
      url: "/uploads/media-id/hero.png",
      mimeType: "image/png",
      processingStatus: "FAILED",
      processingToken: null,
    });
    await expect(
      readFile(join(publicDir, "uploads", "media-id", "hero.png")),
    ).resolves.toEqual(Buffer.from("old"));
  });

  it("moves one media file between folders without changing its public identity", async () => {
    const fixture = createFixture();
    fixture.rawDatabase.mediaFolder.findUnique.mockResolvedValue({
      id: "target-folder",
    });
    const service = new MediaService(
      fixture.database,
      createMediaStorage(publicDir, join(publicDir, "staging")),
      fixture.queue,
    );

    const moved = await service.updateMetadata("user-id", {
      id: "media-id",
      folderId: "target-folder",
    });

    expect(moved).toMatchObject({
      folderId: "target-folder",
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      processingStatus: "READY",
    });
  });

  it("queues an individual raster conversion and changes the public extension safely", async () => {
    const fixture = createFixture([
      createRecord({
        fileName: "hero.png",
        url: "/uploads/media-id/hero.png",
        mimeType: "image/png",
      }),
    ]);
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writePublic("media-id", "hero.png", PNG_BUFFER);
    const service = new MediaService(fixture.database, storage, fixture.queue);

    const queued = await service.convertToWebp("user-id", "media-id");

    expect(queued).toMatchObject({
      fileName: "hero.webp",
      url: "/uploads/media-id/hero.webp",
      mimeType: "image/webp",
      processingStatus: "PROCESSING",
    });
    expect(fixture.queue.add).toHaveBeenCalledWith(
      expect.stringMatching(/^media-webp-/),
      expect.objectContaining({
        type: "media-webp",
        mediaFileId: "media-id",
        previousFileName: "hero.png",
        previousUrl: "/uploads/media-id/hero.png",
      }),
      expect.anything(),
    );
    await expect(
      readFile(join(publicDir, "uploads", "media-id", "hero.png")),
    ).resolves.toEqual(PNG_BUFFER);
  });

  it("rejects manual conversion for non-raster and already-processing media", async () => {
    const fixture = createFixture([
      createRecord({
        id: "svg-id",
        category: "IMAGE_SVG",
        mimeType: "image/svg+xml",
        fileName: "icon.svg",
      }),
      createRecord({
        id: "processing-id",
        processingStatus: "PROCESSING",
        processingToken: "token",
      }),
    ]);
    const service = new MediaService(
      fixture.database,
      createMediaStorage(publicDir, join(publicDir, "staging")),
      fixture.queue,
    );

    await expect(
      service.convertToWebp("user-id", "svg-id"),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      service.convertToWebp("user-id", "processing-id"),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(fixture.queue.add).not.toHaveBeenCalled();
  });

  it("retains an MCP conversion job long enough for operation polling", async () => {
    const fixture = createFixture([
      createRecord({
        fileName: "hero.png",
        url: "/uploads/media-id/hero.png",
        mimeType: "image/png",
      }),
    ]);
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writePublic("media-id", "hero.png", PNG_BUFFER);
    const service = new MediaService(fixture.database, storage, fixture.queue);

    await service.convertToWebp(
      "user-id",
      "media-id",
      { source: "MCP", tool: "kastir_media_convert_to_webp", resource: "mcp" },
      "operation-id",
    );

    expect(fixture.queue.add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        audit: expect.objectContaining({ source: "MCP" }),
      }),
      expect.objectContaining({
        jobId: "operation-id",
        removeOnComplete: { age: 3600, count: 1000 },
      }),
    );
  });

  it("replaces SVG synchronously and calls the CDN purge hook", async () => {
    const fixture = createFixture([
      createRecord({
        fileName: "icon.svg",
        url: "/uploads/media-id/icon.svg",
        mimeType: "image/svg+xml",
        category: "IMAGE_SVG",
      }),
    ]);
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writePublic(
      "media-id",
      "icon.svg",
      Buffer.from("<svg></svg>"),
    );
    const service = new MediaService(fixture.database, storage, fixture.queue);

    const updated = await service.replace("user-id", "media-id", {
      fileName: "icon.svg",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect /></svg>',
      ),
    });

    expect(updated.processingStatus).toBe("READY");
    expect(cloudflarePurge).toHaveBeenCalledWith("/uploads/media-id/icon.svg");
    await expect(
      readFile(join(publicDir, "uploads", "media-id", "icon.svg"), "utf8"),
    ).resolves.not.toMatch(/script/i);
  });

  it("rejects a replacement that would make the stable URL serve another category", async () => {
    const fixture = createFixture();
    const service = new MediaService(
      fixture.database,
      createMediaStorage(publicDir, join(publicDir, "staging")),
      fixture.queue,
    );

    await expect(
      service.replace("user-id", "media-id", {
        fileName: "document.pdf",
        buffer: Buffer.from("%PDF-1.7"),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fixture.queue.add).not.toHaveBeenCalled();
  });

  it("restores synchronous replacement bytes when the database write fails", async () => {
    const fixture = createFixture([
      createRecord({
        fileName: "icon.svg",
        url: "/uploads/media-id/icon.svg",
        mimeType: "image/svg+xml",
        category: "IMAGE_SVG",
      }),
    ]);
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    const previous = Buffer.from("<svg><rect /></svg>");
    await storage.writePublic("media-id", "icon.svg", previous);
    fixture.rawDatabase.$transaction.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const service = new MediaService(fixture.database, storage, fixture.queue);

    await expect(
      service.replace("user-id", "media-id", {
        fileName: "replacement.svg",
        buffer: Buffer.from("<svg><circle /></svg>"),
      }),
    ).rejects.toThrow("database unavailable");
    await expect(
      readFile(join(publicDir, "uploads", "media-id", "icon.svg")),
    ).resolves.toEqual(previous);
  });

  it("removes staged replacement bytes when the queue rejects the job", async () => {
    const fixture = createFixture();
    fixture.queue.add.mockRejectedValueOnce(new Error("queue unavailable"));
    const stagingDir = join(publicDir, "staging");
    const storage = createMediaStorage(publicDir, stagingDir);
    await storage.writePublic("media-id", "hero.webp", PNG_BUFFER);
    const service = new MediaService(fixture.database, storage, fixture.queue);

    const result = await service.replace("user-id", "media-id", {
      fileName: "replacement.png",
      buffer: PNG_BUFFER,
    });

    expect(result.processingStatus).toBe("FAILED");
    await expect(readdir(stagingDir)).resolves.toEqual([]);
  });

  it("deletes a file from storage and records the deletion", async () => {
    const fixture = createFixture();
    const storage = createMediaStorage(publicDir, join(publicDir, "staging"));
    await storage.writePublic(
      "media-id",
      "hero.webp",
      Buffer.from("old-content"),
    );
    const service = new MediaService(fixture.database, storage, fixture.queue);

    await service.delete("user-id", "media-id");

    await expect(
      readFile(join(publicDir, "uploads", "media-id", "hero.webp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(fixture.files).toHaveLength(0);
    expect(fixture.database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "MEDIA_DELETED",
        objectType: "MEDIA",
      }),
    });
  });
});
