import type { Job } from "bullmq";

import { expireReadNotifications } from "@/lib/Modules/Notifications/Service";
import type { PublishingJob } from "@/lib/Publishing/queue";

export type ExpireReadNotificationsJob = Job<
  Extract<PublishingJob, { type: "expire-read-notifications" }>
>;

export async function processExpireReadNotificationsJob(
  job: ExpireReadNotificationsJob,
): Promise<void> {
  void job;
  await expireReadNotifications();
}
