import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { MAX_LOCAL_SNAPSHOTS } from "@/lib/Modules/Backup/constants";
import {
  assertSafeBackupId,
  assertWithinBackupRoot,
  getBackupRoot,
} from "@/lib/Modules/Backup/paths";
import { parseSitePackageManifest } from "@/lib/Modules/Backup/Schema";
import type {
  SnapshotMeta,
  SitePackageManifest,
} from "@/lib/Modules/Backup/Types";
import { readZip } from "@/lib/Modules/Backup/Zip";

function metaPath(root: string, id: string): string {
  return assertWithinBackupRoot(root, join(root, `${id}.meta.json`));
}

function packagePath(root: string, id: string): string {
  return assertWithinBackupRoot(root, join(root, `${id}.kastir`));
}

async function readMeta(
  root: string,
  id: string,
): Promise<SnapshotMeta | null> {
  try {
    const raw = await readFile(metaPath(root, id), "utf8");
    return JSON.parse(raw) as SnapshotMeta;
  } catch {
    return null;
  }
}

export class SnapshotStore {
  constructor(private readonly root = getBackupRoot()) {}

  getRoot(): string {
    return this.root;
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  /**
   * List snapshots. Safety (recovery) snapshots are included so operators
   * can download/restore after a failed apply.
   */
  async list(
    options: { includeSafety?: boolean } = {},
  ): Promise<SnapshotMeta[]> {
    const includeSafety = options.includeSafety !== false;
    await this.ensureRoot();
    const names = await readdir(this.root);
    const metas: SnapshotMeta[] = [];

    for (const name of names) {
      if (!name.endsWith(".meta.json")) continue;
      const id = name.replace(/\.meta\.json$/, "");
      const meta = await readMeta(this.root, id);
      if (!meta) continue;
      if (meta.safety && !includeSafety) continue;
      metas.push(meta);
    }

    return metas.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
  }

  async get(id: string): Promise<SnapshotMeta | null> {
    return readMeta(this.root, assertSafeBackupId(id));
  }

  async readPackageBytes(id: string): Promise<Buffer> {
    return readFile(packagePath(this.root, assertSafeBackupId(id)));
  }

  async createFromZip(
    zipBytes: Buffer,
    options: { safety?: boolean; id?: string } = {},
  ): Promise<SnapshotMeta> {
    await this.ensureRoot();
    const id = assertSafeBackupId(options.id ?? randomUUID());
    const tmp = assertWithinBackupRoot(this.root, join(this.root, `${id}.tmp`));
    const finalPkg = packagePath(this.root, id);

    await writeFile(tmp, zipBytes);
    await rename(tmp, finalPkg);

    const entries = readZip(zipBytes);
    const manifestEntry = entries.find((e) => e.path === "manifest.json");
    if (!manifestEntry) {
      await rm(finalPkg, { force: true });
      throw new Error("Package missing manifest.json");
    }

    const parsed = parseSitePackageManifest(
      JSON.parse(manifestEntry.data.toString("utf8")),
    );
    if (!parsed.success) {
      await rm(finalPkg, { force: true });
      throw new Error("Invalid package manifest");
    }

    const manifest: SitePackageManifest = parsed.data;
    const fileStat = await stat(finalPkg);
    const meta: SnapshotMeta = {
      id,
      fileName: `${id}.kastir`,
      createdAt: manifest.createdAt,
      sizeBytes: fileStat.size,
      kastirVersion: manifest.kastirVersion,
      schemaVersion: manifest.schemaVersion,
      origin: manifest.origin,
      siteTitle: manifest.siteTitle,
      safety: options.safety ?? false,
    };

    await writeFile(metaPath(this.root, id), JSON.stringify(meta, null, 2));

    if (!meta.safety) {
      await this.prune();
    }

    return meta;
  }

  async delete(id: string): Promise<void> {
    const safe = assertSafeBackupId(id);
    await rm(packagePath(this.root, safe), { force: true });
    await rm(metaPath(this.root, safe), { force: true });
  }

  async prune(limit = MAX_LOCAL_SNAPSHOTS): Promise<void> {
    const all = await this.list({ includeSafety: false });
    const excess = all.slice(limit);
    for (const snap of excess) {
      await this.delete(snap.id);
    }
  }

  async clearSafetyFlag(id: string): Promise<void> {
    const meta = await readMeta(this.root, assertSafeBackupId(id));
    if (!meta) return;
    const next: SnapshotMeta = {
      ...meta,
      safety: false,
    };
    await writeFile(metaPath(this.root, id), JSON.stringify(next, null, 2));
    await this.prune();
  }

  /** Mark a safety snapshot as failed-recovery (still safety, but listed). */
  async markSafetyFailed(id: string, note?: string): Promise<void> {
    const meta = await readMeta(this.root, assertSafeBackupId(id));
    if (!meta) return;
    const next: SnapshotMeta = {
      ...meta,
      safety: true,
      siteTitle: note
        ? `${meta.siteTitle} [recovery: ${note}]`
        : `${meta.siteTitle} [recovery]`,
    };
    await writeFile(metaPath(this.root, id), JSON.stringify(next, null, 2));
  }
}

export const snapshotStore = new SnapshotStore();
