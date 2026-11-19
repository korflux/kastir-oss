import type { Job } from "bullmq";

import { purgeLogEntriesOlderThan } from "@/lib/Modules/Logs/Purge";
import { LOG_ENTRY_RETENTION_MS } from "@/lib/Modules/Logs/Retention";
import type { PublishingJob } from "@/lib/Publishing/queue";

export type ExpireLogEntriesJob = Job<
  Extract<PublishingJob, { type: "expire-log-entries" }>
>;

export async function expireLogEntries(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOG_ENTRY_RETENTION_MS);
  return purgeLogEntriesOlderThan(cutoff);
}

export async function processExpireLogEntriesJob(
  job: ExpireLogEntriesJob,
): Promise<void> {
  void job;
  await expireLogEntries();
}
