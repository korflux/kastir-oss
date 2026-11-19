import type { Job } from "bullmq";

import { rollupEventsOlderThan } from "@/lib/Modules/SplitTests/Aggregation";
import { SPLIT_EVENT_RETENTION_MS } from "@/lib/Modules/SplitTests/constants";
import type { PublishingJob } from "@/lib/Publishing/queue";

export type ExpireSplitRedirectEventsJob = Job<
  Extract<PublishingJob, { type: "expire-split-redirect-events" }>
>;

export async function expireSplitRedirectEvents(
  now = new Date(),
): Promise<{ rolledUp: number; purged: number }> {
  const cutoff = new Date(now.getTime() - SPLIT_EVENT_RETENTION_MS);
  return rollupEventsOlderThan(cutoff);
}

export async function processExpireSplitRedirectEventsJob(
  job: ExpireSplitRedirectEventsJob,
): Promise<void> {
  void job;
  await expireSplitRedirectEvents();
}
