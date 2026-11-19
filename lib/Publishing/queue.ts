import "server-only";

import { Queue, type QueueOptions } from "bullmq";
import IORedis from "ioredis";

import { BACKUP_AUTO_INTERVAL_DAYS_MAX } from "@/lib/Modules/Backup/constants";
import { nextBackupRunAt } from "@/lib/Modules/Backup/Schedule";
import {
  NOTIFICATION_EXPIRATION_SCHEDULER_ID,
  NOTIFICATION_STALE_EXPIRATION_SCHEDULER_ID,
} from "@/lib/Modules/Notifications/Types";

export const PUBLISHING_QUEUE_NAME = "kastir-publishing";
export const TRASH_EXPIRATION_SCHEDULER_ID = "trashed-pages-expire-daily";
export const SPLIT_EVENTS_EXPIRATION_SCHEDULER_ID =
  "split-redirect-events-expire-daily";
export const LOG_ENTRIES_EXPIRATION_SCHEDULER_ID = "log-entries-expire-daily";
export const SESSIONS_EXPIRATION_SCHEDULER_ID = "sessions-expire-daily";
export const VERIFICATIONS_EXPIRATION_SCHEDULER_ID =
  "verifications-expire-daily";
export const MEDIA_STUCK_SWEEP_SCHEDULER_ID = "media-stuck-processing-sweep";
export const REVISION_HISTORY_EXPIRATION_SCHEDULER_ID =
  "revision-history-expire-daily";
/** Scheduler dinâmico de snapshot automático (re-registrado a cada save). */
export const BACKUP_AUTO_SCHEDULER_ID = "backup-auto-snapshot";

/** Campos de SiteSettings usados pelo agendamento de backup automático. */
export type BackupAutoScheduleSettings = {
  backupAutoEnabled: boolean;
  backupIntervalDays: number;
  backupAutoHour: number;
  backupAutoMinute: number;
  timezone: string;
};

export type PublishingAuditContext = {
  source?: "PANEL" | "MCP";
  tool?: string;
  resource?: string;
  requestId?: string;
  objectId?: string;
};

export type PublishingJob =
  | {
      type: "page-rebuild";
      pageId: string;
    }
  | {
      type: "media-webp";
      mediaFileId: string;
      processingToken: string;
      stagingKey: string;
      /** Actor for failure audit logs written by the worker. */
      userId: string;
      /** Context for tracing an MCP-triggered asynchronous operation. */
      audit?: PublishingAuditContext;
      /** Present when a manual conversion changes the stable file extension. */
      previousFileName?: string;
      previousUrl?: string;
      previousMimeType?: string;
      previousSizeBytes?: number;
    }
  | {
      type: "expire-read-notifications";
    }
  | {
      type: "expire-trashed-pages";
    }
  | {
      type: "expire-revision-history";
    }
  | {
      type: "expire-split-redirect-events";
    }
  | {
      type: "expire-log-entries";
    }
  | {
      type: "expire-stale-notifications";
    }
  | {
      type: "expire-expired-sessions";
    }
  | {
      type: "expire-expired-verifications";
    }
  | {
      type: "media-stuck-sweep";
    }
  | {
      type: "settings-rebuild";
      operationId: string;
      scope: "HOME" | "ARTIFACTS" | "GLOBAL";
      pageIds: string[];
      /** Actor for an MCP-triggered rebuild, so kastir_operation_get can scope lookups to it. */
      userId?: string;
      /** Context for tracing an MCP-triggered asynchronous operation. */
      audit?: PublishingAuditContext;
    }
  | {
      type: "backup-export";
      jobId: string;
    }
  | {
      type: "backup-restore";
      jobId: string;
      snapshotId: string;
    }
  | {
      type: "backup-import";
      jobId: string;
      packagePath: string;
      sourceOrigin: string;
      targetOrigin: string;
    }
  | {
      /** Snapshot automático agendado — sem userId de sessão. */
      type: "backup-auto-snapshot";
    };

export type PublishingQueue = Queue<PublishingJob>;

function queueOptions(redisUrl: string): QueueOptions {
  const connection = new IORedis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  // BullMQ surfaces operation failures to callers; keep lazy connection shutdowns
  // from becoming process-level unhandled events in short-lived commands/tests.
  connection.on("error", () => undefined);

  return {
    connection,
    // The lazy client should not be connected twice: BullMQ can otherwise
    // leave the explicit connect() promise rejected when a short-lived caller
    // closes the queue before Redis is available.
    skipWaitingForReady: true,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: false,
    },
  };
}

/**
 * Retencao dos jobs que kastir_operation_get consulta (media-webp e
 * settings-rebuild com operationId). Sem ela o BullMQ apaga o job ao concluir e
 * o polling do MCP nao distingue "terminou" de "id invalido" — os dois viram
 * NOT_FOUND.
 */
export const TRACKED_JOB_RETENTION = { age: 60 * 60, count: 1_000 } as const;

export function createPublishingQueue(redisUrl: string): PublishingQueue {
  const queue = new Queue<PublishingJob>(
    PUBLISHING_QUEUE_NAME,
    queueOptions(redisUrl),
  );
  queue.on("error", (error) => {
    console.error(
      "[Kastir] Publishing queue error",
      error instanceof Error ? error.message : "unknown error",
    );
  });
  return queue;
}

let sharedQueue: PublishingQueue | undefined;

/** Esquema redis(s) antes de abrir ioredis — canônico do canal de publicação. */
export function assertRedisUrl(redisUrl: string | undefined): string {
  if (!redisUrl || !/^rediss?:\/\//.test(redisUrl)) {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  return redisUrl;
}

export function getPublishingQueue(
  redisUrl = process.env.REDIS_URL,
): PublishingQueue {
  sharedQueue ??= createPublishingQueue(assertRedisUrl(redisUrl));
  return sharedQueue;
}

export async function registerNotificationExpirationScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    NOTIFICATION_EXPIRATION_SCHEDULER_ID,
    { pattern: "0 0 * * *", tz: "UTC" },
    {
      name: "expire-read-notifications",
      data: { type: "expire-read-notifications" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

export async function registerTrashExpirationScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    TRASH_EXPIRATION_SCHEDULER_ID,
    { pattern: "0 1 * * *", tz: "UTC" },
    {
      name: "expire-trashed-pages",
      data: { type: "expire-trashed-pages" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

export async function registerRevisionHistoryExpirationScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    REVISION_HISTORY_EXPIRATION_SCHEDULER_ID,
    { pattern: "0 6 * * *", tz: "UTC" },
    {
      name: "expire-revision-history",
      data: { type: "expire-revision-history" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

export async function registerSplitEventsExpirationScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    SPLIT_EVENTS_EXPIRATION_SCHEDULER_ID,
    { pattern: "0 2 * * *", tz: "UTC" },
    {
      name: "expire-split-redirect-events",
      data: { type: "expire-split-redirect-events" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

export async function registerLogEntriesExpirationScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    LOG_ENTRIES_EXPIRATION_SCHEDULER_ID,
    { pattern: "0 3 * * *", tz: "UTC" },
    {
      name: "expire-log-entries",
      data: { type: "expire-log-entries" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

export async function registerStaleNotificationsExpirationScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    NOTIFICATION_STALE_EXPIRATION_SCHEDULER_ID,
    { pattern: "0 4 * * *", tz: "UTC" },
    {
      name: "expire-stale-notifications",
      data: { type: "expire-stale-notifications" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

export async function registerSessionsExpirationScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    SESSIONS_EXPIRATION_SCHEDULER_ID,
    { pattern: "0 5 * * *", tz: "UTC" },
    {
      name: "expire-expired-sessions",
      data: { type: "expire-expired-sessions" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

export async function registerVerificationsExpirationScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    VERIFICATIONS_EXPIRATION_SCHEDULER_ID,
    { pattern: "30 5 * * *", tz: "UTC" },
    {
      name: "expire-expired-verifications",
      data: { type: "expire-expired-verifications" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

// Unlike the other schedulers (1x/day), stuck media needs to self-heal within
// minutes of the incident, not the next deploy — so this repeats every 10min
// instead of on a fixed daily cron slot.
export async function registerMediaStuckSweepScheduler(
  queue: Pick<PublishingQueue, "upsertJobScheduler"> = getPublishingQueue(),
) {
  return queue.upsertJobScheduler(
    MEDIA_STUCK_SWEEP_SCHEDULER_ID,
    { every: 10 * 60 * 1000 },
    {
      name: "media-stuck-sweep",
      data: { type: "media-stuck-sweep" },
      opts: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Scheduler dinâmico de backup automático.
 * Desligado → remove o scheduler; ligado → every N dias com startDate no
 * próximo horário no fuso do site (não cron fixo — evita drift de "a cada N dias").
 */
export async function registerBackupAutoSnapshotScheduler(
  settings: BackupAutoScheduleSettings,
  queue: Pick<
    PublishingQueue,
    "upsertJobScheduler" | "removeJobScheduler"
  > = getPublishingQueue(),
) {
  if (!settings.backupAutoEnabled) {
    await queue.removeJobScheduler(BACKUP_AUTO_SCHEDULER_ID);
    return;
  }

  const intervalDays = Math.min(
    BACKUP_AUTO_INTERVAL_DAYS_MAX,
    Math.max(1, Math.floor(settings.backupIntervalDays)),
  );
  const startDate = nextBackupRunAt(new Date(), {
    intervalDays,
    hour: settings.backupAutoHour,
    minute: settings.backupAutoMinute,
    timezone: settings.timezone,
  });

  // attempts:1 — runAutomaticSnapshot engole erro e só tenta no próximo ciclo
  // (spec fase 33); retry BullMQ seria config morta.
  return queue.upsertJobScheduler(
    BACKUP_AUTO_SCHEDULER_ID,
    { every: intervalDays * MS_PER_DAY, startDate },
    {
      name: "backup-auto-snapshot",
      data: { type: "backup-auto-snapshot" },
      opts: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    },
  );
}
