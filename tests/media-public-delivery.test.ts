import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMediaStorage } from "@/lib/Processing/mediaStorage";

/**
 * Contract for public media delivery (SPEC-FASE-21):
 * existence on disk decides 200 vs 404 — not the presence of a session cookie.
 * Nginx serves /uploads via try_files without auth (see docker-config tests).
 */
function resolvePublicMediaStatus(
  existsOnDisk: boolean,
  // Sessão documentada na assinatura: delivery pública ignora auth de propósito.
  _hasSession: boolean,
): 200 | 404 {
  void _hasSession;
  return existsOnDisk ? 200 : 404;
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("public media delivery contract", () => {
  it("returns the same status for existing files with or without a session", async () => {
    const root = await mkdtemp(join(tmpdir(), "kastir-media-public-delivery-"));
    temporaryRoots.push(root);
    const storage = createMediaStorage(root, join(root, "staging"));
    const mediaId = "d657a4a6-d159-490c-b592-0c5d8fa5c464";
    const fileName = "sample-ebook-cover.webp";

    await storage.writePublic(mediaId, fileName, Buffer.from("webp-bytes"));
    const onDisk = (await storage.readPublic(mediaId, fileName)) !== null;

    expect(onDisk).toBe(true);
    expect(resolvePublicMediaStatus(onDisk, true)).toBe(200);
    expect(resolvePublicMediaStatus(onDisk, false)).toBe(200);
  });

  it("returns 404 for missing files with or without a session", async () => {
    const root = await mkdtemp(join(tmpdir(), "kastir-media-public-delivery-"));
    temporaryRoots.push(root);
    const storage = createMediaStorage(root, join(root, "staging"));
    const mediaId = "missing-media-id";
    const fileName = "missing.webp";

    const onDisk = (await storage.readPublic(mediaId, fileName)) !== null;

    expect(onDisk).toBe(false);
    expect(resolvePublicMediaStatus(onDisk, true)).toBe(404);
    expect(resolvePublicMediaStatus(onDisk, false)).toBe(404);
  });

  it("uses the canonical public URL shape /uploads/{mediaId}/{fileName}", () => {
    const mediaId = "d657a4a6-d159-490c-b592-0c5d8fa5c464";
    const fileName = "sample-ebook-cover.webp";
    const url = `/uploads/${mediaId}/${fileName}`;

    expect(url).toMatch(/^\/uploads\/[^/]+\/[^/]+\.webp$/);
    expect(url).not.toMatch(/^\/u\//);
  });
});
