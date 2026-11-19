import type { Job } from "bullmq";

import { backupService } from "@/lib/Modules/Backup/Service";
import type { PublishingJob } from "@/lib/Publishing/queue";

export type BackupAutoSnapshotJob = Job<
  Extract<PublishingJob, { type: "backup-auto-snapshot" }>
>;

/** Job agendado: cria snapshot sem userId de sessão. */
export async function processBackupAutoSnapshotJob(
  job: BackupAutoSnapshotJob,
): Promise<void> {
  void job;
  await backupService.runAutomaticSnapshot();
}
