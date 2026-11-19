import type { Job } from "bullmq";

import { purgeExpiredSessions } from "@/lib/Modules/Auth/Purge";
import type { PublishingJob } from "@/lib/Publishing/queue";

export type ExpireExpiredSessionsJob = Job<
  Extract<PublishingJob, { type: "expire-expired-sessions" }>
>;

export async function expireExpiredSessions(now = new Date()): Promise<number> {
  return purgeExpiredSessions(now);
}

export async function processExpireExpiredSessionsJob(
  job: ExpireExpiredSessionsJob,
): Promise<void> {
  void job;
  await expireExpiredSessions();
}
