import type { Job } from "bullmq";

import { purgeExpiredVerifications } from "@/lib/Modules/Auth/Purge";
import type { PublishingJob } from "@/lib/Publishing/queue";

export type ExpireExpiredVerificationsJob = Job<
  Extract<PublishingJob, { type: "expire-expired-verifications" }>
>;

export async function expireExpiredVerifications(
  now = new Date(),
): Promise<number> {
  return purgeExpiredVerifications(now);
}

export async function processExpireExpiredVerificationsJob(
  job: ExpireExpiredVerificationsJob,
): Promise<void> {
  void job;
  await expireExpiredVerifications();
}
