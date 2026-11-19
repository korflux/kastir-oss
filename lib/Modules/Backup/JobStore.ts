import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertSafeBackupId,
  assertWithinBackupRoot,
  getBackupJobsDir,
} from "@/lib/Modules/Backup/paths";
import type { BackupJobRecord } from "@/lib/Modules/Backup/Types";

export class JobStore {
  constructor(private readonly root = getBackupJobsDir()) {}

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  private path(id: string): string {
    const safe = assertSafeBackupId(id);
    return assertWithinBackupRoot(this.root, join(this.root, `${safe}.json`));
  }

  private claimPath(id: string): string {
    const safe = assertSafeBackupId(id);
    return assertWithinBackupRoot(this.root, join(this.root, `${safe}.claim`));
  }

  async create(
    partial: Omit<
      BackupJobRecord,
      "id" | "createdAt" | "updatedAt" | "status" | "progress"
    > & {
      status?: BackupJobRecord["status"];
      progress?: number;
    },
  ): Promise<BackupJobRecord> {
    await this.ensure();
    const now = new Date().toISOString();
    const record: BackupJobRecord = {
      id: randomUUID(),
      status: partial.status ?? "queued",
      progress: partial.progress ?? 0,
      kind: partial.kind,
      userId: partial.userId,
      message: partial.message,
      error: partial.error,
      snapshotId: partial.snapshotId,
      packagePath: partial.packagePath,
      dryRun: partial.dryRun,
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(this.path(record.id), JSON.stringify(record, null, 2));
    return record;
  }

  async get(id: string): Promise<BackupJobRecord | null> {
    try {
      const raw = await readFile(this.path(id), "utf8");
      return JSON.parse(raw) as BackupJobRecord;
    } catch {
      return null;
    }
  }

  async update(
    id: string,
    patch: Partial<BackupJobRecord>,
  ): Promise<BackupJobRecord> {
    const current = await this.get(id);
    if (!current) throw new Error(`Backup job ${id} not found`);
    const next: BackupJobRecord = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(this.path(id), JSON.stringify(next, null, 2));
    return next;
  }

  /**
   * Compare-and-set status transition to prevent re-entrant workers.
   * Returns null if the job is missing or not in an allowed from-status.
   */
  async tryClaim(
    id: string,
    from: BackupJobRecord["status"][],
    to: BackupJobRecord["status"] = "running",
  ): Promise<BackupJobRecord | null> {
    const current = await this.get(id);
    if (!current || !from.includes(current.status)) return null;
    const claimPath = this.claimPath(id);
    try {
      await writeFile(claimPath, to, { flag: "wx" });
    } catch {
      return null;
    }
    try {
      const fresh = await this.get(id);
      if (!fresh || !from.includes(fresh.status)) return null;
      return await this.update(id, {
        status: to,
        progress: Math.max(fresh.progress, 1),
        message: fresh.message ?? "Running",
      });
    } finally {
      await rm(claimPath, { force: true });
    }
  }

  async list(): Promise<BackupJobRecord[]> {
    await this.ensure();
    const names = await readdir(this.root);
    const jobs: BackupJobRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const job = await this.get(name.replace(/\.json$/, ""));
      if (job) jobs.push(job);
    }
    return jobs.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
  }

  async delete(id: string): Promise<void> {
    await rm(this.path(id), { force: true });
  }
}

export const jobStore = new JobStore();
