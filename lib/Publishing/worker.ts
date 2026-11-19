import "server-only";

import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

import {
  PUBLISHING_QUEUE_NAME,
  assertRedisUrl,
  type PublishingJob,
} from "@/lib/Publishing/queue";

export type PublishingJobHandler<
  Type extends PublishingJob["type"] = PublishingJob["type"],
> = (job: Job<Extract<PublishingJob, { type: Type }>>) => Promise<void>;

export type PublishingJobHandlers = {
  [Type in PublishingJob["type"]]?: PublishingJobHandler<Type>;
};

function defaultPublishingJobHandlers(): PublishingJobHandlers {
  return {
    "page-rebuild": async (job) => {
      const { processPageRebuildJob } =
        await import("@/lib/Publishing/rebuild");
      await processPageRebuildJob(job.data.pageId);
    },
    "media-webp": async (job) => {
      const { processMediaWebpJob } =
        await import("@/lib/Processing/convertToWebp");
      await processMediaWebpJob(job as never);
    },
    "expire-read-notifications": async (job) => {
      const { processExpireReadNotificationsJob } =
        await import("@/lib/Jobs/expireReadNotifications");
      await processExpireReadNotificationsJob(job);
    },
    "expire-trashed-pages": async (job) => {
      const { processExpireTrashedPagesJob } =
        await import("@/lib/Jobs/expireTrashedPages");
      await processExpireTrashedPagesJob(job);
    },
    "expire-revision-history": async (job) => {
      const { processExpireRevisionHistoryJob } =
        await import("@/lib/Jobs/expireRevisionHistory");
      await processExpireRevisionHistoryJob(job);
    },
    "expire-split-redirect-events": async (job) => {
      const { processExpireSplitRedirectEventsJob } =
        await import("@/lib/Jobs/expireSplitRedirectEvents");
      await processExpireSplitRedirectEventsJob(job);
    },
    "expire-log-entries": async (job) => {
      const { processExpireLogEntriesJob } =
        await import("@/lib/Jobs/expireLogEntries");
      await processExpireLogEntriesJob(job);
    },
    "expire-stale-notifications": async (job) => {
      const { processExpireStaleNotificationsJob } =
        await import("@/lib/Jobs/expireStaleNotifications");
      await processExpireStaleNotificationsJob(job);
    },
    "expire-expired-sessions": async (job) => {
      const { processExpireExpiredSessionsJob } =
        await import("@/lib/Jobs/expireExpiredSessions");
      await processExpireExpiredSessionsJob(job);
    },
    "expire-expired-verifications": async (job) => {
      const { processExpireExpiredVerificationsJob } =
        await import("@/lib/Jobs/expireExpiredVerifications");
      await processExpireExpiredVerificationsJob(job);
    },
    "media-stuck-sweep": async () => {
      const { reconcileStuckMediaProcessing } =
        await import("@/lib/Modules/Media/Service");
      await reconcileStuckMediaProcessing();
    },
    "settings-rebuild": async (job) => {
      const { processSettingsRebuildJob } =
        await import("@/lib/Publishing/settingsRebuild");
      await processSettingsRebuildJob(job.data);
    },
    "backup-export": async (job) => {
      const { backupService } = await import("@/lib/Modules/Backup/Service");
      await backupService.runExportJob(job.data.jobId);
    },
    "backup-restore": async (job) => {
      const { backupService } = await import("@/lib/Modules/Backup/Service");
      await backupService.runRestoreJob(job.data.jobId);
    },
    "backup-import": async (job) => {
      const { backupService } = await import("@/lib/Modules/Backup/Service");
      await backupService.runImportJob(
        job.data.jobId,
        job.data.packagePath,
        job.data.sourceOrigin,
        job.data.targetOrigin,
      );
    },
    "backup-auto-snapshot": async (job) => {
      const { processBackupAutoSnapshotJob } =
        await import("@/lib/Jobs/backupAutoSnapshot");
      await processBackupAutoSnapshotJob(job);
    },
  };
}

export async function dispatchPublishingJob(
  job: Job<PublishingJob>,
  handlers: PublishingJobHandlers,
): Promise<void> {
  const handler = handlers[job.data.type] as PublishingJobHandler | undefined;
  if (!handler) {
    throw new Error(`No publishing handler registered for ${job.data.type}`);
  }

  await handler(job);
}

export function createPublishingWorker(
  redisUrl: string,
  handlers: PublishingJobHandlers,
): Worker<PublishingJob> {
  const connection = new IORedis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<PublishingJob>(
    PUBLISHING_QUEUE_NAME,
    async (job) => dispatchPublishingJob(job, handlers),
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("error", (error) => {
    console.error("Publishing worker error", error);
  });

  return worker;
}

let sharedWorker: Worker<PublishingJob> | undefined;

export function startPublishingWorker(
  redisUrl = process.env.REDIS_URL,
  handlers: PublishingJobHandlers = defaultPublishingJobHandlers(),
): Worker<PublishingJob> {
  if (sharedWorker) return sharedWorker;

  sharedWorker = createPublishingWorker(assertRedisUrl(redisUrl), handlers);
  return sharedWorker;
}

export async function stopPublishingWorker(): Promise<void> {
  if (!sharedWorker) return;

  const worker = sharedWorker;
  sharedWorker = undefined;
  await worker.close();
}
