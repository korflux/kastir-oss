import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { PackageAsset } from "@/lib/Modules/Backup/Types";
import {
  assertSafeSegment,
  assertWithinRoot,
  getMediaPublicRoot,
} from "@/lib/Processing/mediaStorage";

/**
 * Stage package assets under a private staging root, then promote into
 * public/uploads. On promote failure the public tree is left as-is for
 * assets not yet promoted; callers should surface safety snapshot recovery.
 */
export class MediaApply {
  constructor(
    private readonly publicDir = process.env.PUBLIC_DIR ??
      join(process.cwd(), "public"),
  ) {}

  private uploadsRoot(): string {
    return getMediaPublicRoot(this.publicDir);
  }

  private stagingRoot(token: string): string {
    return resolve(this.publicDir, "_kastir", "backups", ".media-stage", token);
  }

  async stageAssets(assets: PackageAsset[]): Promise<string> {
    const token = randomUUID();
    const root = this.stagingRoot(token);
    await mkdir(root, { recursive: true });

    for (const asset of assets) {
      const mediaId = assertSafeSegment(asset.mediaId, "mediaId");
      const fileName = assertSafeSegment(asset.fileName, "fileName");
      const target = assertWithinRoot(root, join(root, mediaId, fileName));
      await mkdir(dirname(target), { recursive: true });
      const tmp = join(dirname(target), `.${randomUUID()}.tmp`);
      await writeFile(tmp, asset.bytes);
      await rename(tmp, target);
    }

    return token;
  }

  async promoteStaged(token: string, assets: PackageAsset[]): Promise<void> {
    const stage = this.stagingRoot(token);
    const uploads = this.uploadsRoot();
    await mkdir(uploads, { recursive: true });

    for (const asset of assets) {
      const mediaId = assertSafeSegment(asset.mediaId, "mediaId");
      const fileName = assertSafeSegment(asset.fileName, "fileName");
      const from = assertWithinRoot(stage, join(stage, mediaId, fileName));
      const to = assertWithinRoot(uploads, join(uploads, mediaId, fileName));
      await mkdir(dirname(to), { recursive: true });
      // Overwrite destination atomically where the OS allows.
      try {
        await rm(to, { force: true });
      } catch {
        // ignore
      }
      await rename(from, to);
    }
  }

  async cleanupStaging(token: string): Promise<void> {
    await rm(this.stagingRoot(token), { recursive: true, force: true });
  }

  /**
   * Remove public upload directories whose media ids are not in the keep set.
   */
  async removeOrphanUploads(keepMediaIds: Set<string>): Promise<void> {
    const uploads = this.uploadsRoot();
    let names: string[] = [];
    try {
      names = await readdir(uploads);
    } catch {
      return;
    }

    for (const name of names) {
      if (name.startsWith(".")) continue;
      if (keepMediaIds.has(name)) continue;
      const target = assertWithinRoot(uploads, join(uploads, name));
      try {
        const info = await stat(target);
        if (info.isDirectory()) {
          await rm(target, { recursive: true, force: true });
        }
      } catch {
        // ignore missing
      }
    }
  }
}

export const mediaApply = new MediaApply();
