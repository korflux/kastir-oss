import type { Job } from "bullmq";

import { expireStaleNotifications } from "@/lib/Modules/Notifications/Service";
import type { PublishingJob } from "@/lib/Publishing/queue";

export type ExpireStaleNotificationsJob = Job<
  Extract<PublishingJob, { type: "expire-stale-notifications" }>
>;

export async function processExpireStaleNotificationsJob(
  job: ExpireStaleNotificationsJob,
): Promise<void> {
  void job;
  await expireStaleNotifications();
}
