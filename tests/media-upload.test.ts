import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import {
  MediaService,
  type MediaDatabase,
  type MediaQueue,
} from "@/lib/Modules/Media/Service";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function createUploadDatabase() {
  const files: Array<Record<string, unknown>> = [];
  const folder = {
    id: "base-id",
    name: "Base",
    color: null,
    parentId: null,
    isBase: true,
  };

  const database = {
    mediaFolder: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === folder.id ? folder : null,
      ),
    },
    mediaFile: {
      findMany: vi.fn(async () => [...files]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const record = { ...data, createdAt: now, updatedAt: now };
        files.push(record);
        return record;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const file = files.find((candidate) => candidate.id === where.id);
          if (!file) throw new Error("media file missing");
          Object.assign(file, data, { updatedAt: new Date() });
          return file;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = files.findIndex((candidate) => candidate.id === where.id);
        if (index < 0) throw new Error("media file missing");
        return files.splice(index, 1)[0];
      }),
    },
    logEntry: {
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };

  return { database: database as unknown as MediaDatabase, files };
}

describe("MediaService.upload", () => {
  const temporaryRoots: string[] = [];
  let database: MediaDatabase;
  let files: ReturnType<typeof createUploadDatabase>["files"];
  let queue: MediaQueue & { add: ReturnType<typeof vi.fn> };
  let storage: ReturnType<typeof createMediaStorage>;
  let publicDir: string;
  let stagingDir: string;

  beforeEach(async () => {
    const testDatabase = createUploadDatabase();
    database = testDatabase.database;
    files = testDatabase.files;
    queue = { add: vi.fn().mockResolvedValue({}) } as MediaQueue & {
      add: ReturnType<typeof vi.fn>;
    };
    publicDir = await mkdtemp(join(tmpdir(), "kastir-media-public-"));
    stagingDir = join(publicDir, "staging");
    temporaryRoots.push(publicDir);
    storage = createMediaStorage(publicDir, stagingDir);
  });

  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("stages raster uploads and responds before a WebP job writes public output", async () => {
    const service = new MediaService(database, storage, queue);

    const result = await service.upload(
      "user-id",
      {
        folderId: "base-id",
        fileName: "hero.png",
        buffer: PNG_BUFFER,
      },
      {
        source: "MCP",
        tool: "kastir_media_upload",
        resource: "https://public.example/api/mcp",
        requestId: "request-1",
      },
    );

    expect(result).toMatchObject({
      fileName: "hero.webp",
      mimeType: "image/webp",
      category: "IMAGE_RASTER",
      processingStatus: "PROCESSING",
      url: expect.stringMatching(/^\/uploads\/[^/]+\/hero\.webp$/),
    });
    expect(queue.add).toHaveBeenCalledWith(
      expect.stringMatching(/^media-webp-/),
      expect.objectContaining({
        type: "media-webp",
        mediaFileId: result.id,
        processingToken: expect.any(String),
        stagingKey: expect.any(String),
        userId: "user-id",
        audit: expect.objectContaining({
          source: "MCP",
          tool: "kastir_media_upload",
          requestId: "request-1",
        }),
      }),
      expect.objectContaining({
        jobId: expect.stringContaining("media-webp:"),
      }),
    );
    await expect(
      readFile(join(publicDir, "uploads", result.id, "hero.webp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        join(
          stagingDir,
          (queue.add.mock.calls[0]?.[1] as { stagingKey: string }).stagingKey,
        ),
      ),
    ).resolves.toEqual(PNG_BUFFER);
    expect(files).toHaveLength(1);
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: "MCP",
        tool: "kastir_media_upload",
        requestId: "request-1",
      }),
    });
  });

  it("sanitizes SVG synchronously and publishes it as ready", async () => {
    const service = new MediaService(database, storage, queue);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10" /></svg>',
    );

    const result = await service.upload("user-id", {
      folderId: "base-id",
      fileName: "icon.svg",
      buffer: svg,
    });

    expect(result.processingStatus).toBe("READY");
    expect(queue.add).not.toHaveBeenCalled();
    await expect(
      readFile(join(publicDir, "uploads", result.id, "icon.svg"), "utf8"),
    ).resolves.not.toMatch(/script|onload/i);
  });

  it("adds a numeric suffix for a duplicate final name in the same folder", async () => {
    const service = new MediaService(database, storage, queue);

    const first = await service.upload("user-id", {
      folderId: "base-id",
      fileName: "hero.png",
      buffer: PNG_BUFFER,
    });
    const second = await service.upload("user-id", {
      folderId: "base-id",
      fileName: "hero.png",
      buffer: PNG_BUFFER,
    });

    expect(first.fileName).toBe("hero.webp");
    expect(second.fileName).toBe("hero-1.webp");
  });

  it("does not create a database record for a spoofed upload", async () => {
    const service = new MediaService(database, storage, queue);

    await expect(
      service.upload("user-id", {
        folderId: "base-id",
        fileName: "malware.jpg",
        buffer: Buffer.from("MZ-not-a-jpeg"),
      }),
    ).rejects.toThrow("signature");
    expect(files).toHaveLength(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("marks FAILED and logs when the WebP job cannot be enqueued", async () => {
    queue.add.mockRejectedValueOnce(new Error("redis unavailable"));
    const service = new MediaService(database, storage, queue);

    const result = await service.upload("user-id", {
      folderId: "base-id",
      fileName: "hero.png",
      buffer: PNG_BUFFER,
    });

    expect(result.processingStatus).toBe("FAILED");
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-id",
        action: "MEDIA_PROCESSING_FAILED",
        objectType: "MEDIA",
      }),
    });
  });
});
