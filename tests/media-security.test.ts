import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import {
  assertMediaSize,
  detectMediaType,
  getMediaExtension,
} from "@/lib/Processing/detectFileType";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";
import { sanitizeSvg } from "@/lib/Processing/sanitizeSvg";
import {
  MediaService,
  type MediaDatabase,
  type MediaQueue,
} from "@/lib/Modules/Media/Service";

describe("media security boundaries", () => {
  it.each(["../image.png", "..\\image.png", "image\0.png", ".", ".."])(
    "rejects unsafe file name %s",
    (fileName) => {
      expect(() => getMediaExtension(fileName)).toThrow();
    },
  );

  it("rejects invalid and oversized declared media sizes", () => {
    expect(() => assertMediaSize("image.png", -1)).toThrow("invalid");
    expect(() => assertMediaSize("image.png", 20 * 1024 * 1024 + 1)).toThrow(
      "too large",
    );
  });

  it("keeps SVG uploads as a text boundary before sanitization", async () => {
    await expect(
      detectMediaType(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        "icon.svg",
      ),
    ).resolves.toMatchObject({ mimeType: "image/svg+xml" });
  });

  it("removes executable and external SVG attack surfaces", () => {
    const sanitized = sanitizeSvg(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
        "<script>alert(2)</script>",
        '<foreignObject><iframe src="https://evil.example"></iframe></foreignObject>',
        '<image href="javascript:alert(3)" onerror="alert(4)" />',
        '<use href="https://evil.example/payload.svg#root" />',
        "</svg>",
      ].join(""),
    );

    expect(sanitized).toMatch(/<svg/i);
    expect(sanitized).not.toMatch(
      /<script|foreignObject|iframe|javascript:|onload|onerror|evil\.example/i,
    );
  });
});

describe("media security stored SVG pipeline", () => {
  const temporaryRoots: string[] = [];
  let database: MediaDatabase;
  let queue: MediaQueue & { add: ReturnType<typeof vi.fn> };
  let storage: ReturnType<typeof createMediaStorage>;
  let publicDir: string;

  beforeEach(async () => {
    publicDir = await mkdtemp(join(tmpdir(), "kastir-media-sec-public-"));
    const stagingDir = join(publicDir, "staging");
    temporaryRoots.push(publicDir);
    storage = createMediaStorage(publicDir, stagingDir);
    queue = { add: vi.fn().mockResolvedValue(undefined) } as never;

    const folder = {
      id: "base-id",
      name: "Base",
      color: null,
      parentId: null,
      isBase: true,
    };
    const files: Array<Record<string, unknown>> = [];
    database = {
      mediaFolder: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === folder.id ? folder : null,
        ),
      },
      mediaFile: {
        findMany: vi.fn(async () => [...files]),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const now = new Date();
          const record = {
            id: "svg-media-id",
            ...data,
            createdAt: now,
            updatedAt: now,
          };
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
            if (!file) throw new Error("missing");
            Object.assign(file, data);
            return file;
          },
        ),
        delete: vi.fn(),
      },
      logEntry: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(
        async <T>(callback: (tx: typeof database) => Promise<T>) =>
          callback(database),
      ),
    } as unknown as MediaDatabase;
  });

  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("writes only sanitized SVG bytes to public uploads", async () => {
    const service = new MediaService(database, storage, queue);
    const malicious = Buffer.from(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">',
        "<script>alert(2)</script>",
        '<image href="javascript:alert(3)" />',
        "</svg>",
      ].join(""),
    );

    const result = await service.upload("user-id", {
      folderId: "base-id",
      fileName: "evil.svg",
      buffer: malicious,
    });

    expect(result.processingStatus).toBe("READY");
    const stored = await readFile(
      join(publicDir, "uploads", result.id, result.fileName),
      "utf8",
    );
    expect(stored).toMatch(/<svg/i);
    expect(stored).not.toMatch(/<script|onload|javascript:|alert\(/i);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
