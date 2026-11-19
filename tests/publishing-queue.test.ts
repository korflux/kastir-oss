import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BACKUP_AUTO_SCHEDULER_ID,
  PUBLISHING_QUEUE_NAME,
  assertRedisUrl,
  createPublishingQueue,
  registerNotificationExpirationScheduler,
  registerTrashExpirationScheduler,
  registerRevisionHistoryExpirationScheduler,
  registerSplitEventsExpirationScheduler,
  registerLogEntriesExpirationScheduler,
  registerStaleNotificationsExpirationScheduler,
  registerSessionsExpirationScheduler,
  registerVerificationsExpirationScheduler,
  registerMediaStuckSweepScheduler,
  registerBackupAutoSnapshotScheduler,
} from "@/lib/Publishing/queue";
import { dispatchPublishingJob } from "@/lib/Publishing/worker";

describe("publishing queue scaffold", () => {
  const queues: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.close()));
  });

  it("rejects Redis URLs that are not redis:// or rediss://", () => {
    expect(() => assertRedisUrl(undefined)).toThrow("REDIS_URL must use");
    expect(() => assertRedisUrl("http://localhost:6379")).toThrow(
      "REDIS_URL must use",
    );
    expect(assertRedisUrl("rediss://:secret@redis.example:6380")).toBe(
      "rediss://:secret@redis.example:6380",
    );
  });

  it("creates the shared queue lazily without registering a worker", async () => {
    const queue = createPublishingQueue("redis://:kastir@localhost:6379");
    queues.push(queue);

    expect(queue.name).toBe(PUBLISHING_QUEUE_NAME);
    expect(
      (queue.opts.connection as { options?: { lazyConnect?: boolean } }).options
        ?.lazyConnect,
    ).toBe(true);
  });

  it("dispatches a media job to its registered handler", async () => {
    const calls: string[] = [];

    await dispatchPublishingJob(
      {
        data: {
          type: "media-webp",
          mediaFileId: "media-id",
          processingToken: "token",
          stagingKey: "staging-key",
          userId: "user-id",
        },
      } as never,
      {
        "media-webp": async (job) => {
          calls.push(job.data.mediaFileId);
        },
      },
    );

    expect(calls).toEqual(["media-id"]);
  });

  it("dispatches a page rebuild job to its registered handler", async () => {
    const calls: string[] = [];

    await dispatchPublishingJob(
      { data: { type: "page-rebuild", pageId: "page-id" } } as never,
      {
        "page-rebuild": async (job) => {
          calls.push(job.data.pageId);
        },
      },
    );

    expect(calls).toEqual(["page-id"]);
  });

  it("rejects a job type without a registered handler", async () => {
    await expect(
      dispatchPublishingJob(
        {
          data: {
            type: "media-webp",
            mediaFileId: "media-id",
            processingToken: "token",
            stagingKey: "staging-key",
            userId: "user-id",
          },
        } as never,
        {},
      ),
    ).rejects.toThrow("No publishing handler registered for media-webp");
  });

  it("registers one fixed UTC scheduler through BullMQ upsert", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});

    await registerNotificationExpirationScheduler({ upsertJobScheduler });
    await registerNotificationExpirationScheduler({ upsertJobScheduler });

    expect(upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      "notifications-expire-read-daily",
      { pattern: "0 0 * * *", tz: "UTC" },
      expect.objectContaining({
        name: "expire-read-notifications",
        data: { type: "expire-read-notifications" },
        opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
      }),
    );
  });

  it("registers the trash scheduler with a distinct fixed UTC key", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});

    await registerTrashExpirationScheduler({ upsertJobScheduler });

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "trashed-pages-expire-daily",
      { pattern: "0 1 * * *", tz: "UTC" },
      expect.objectContaining({
        name: "expire-trashed-pages",
        data: { type: "expire-trashed-pages" },
        opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
      }),
    );
  });

  it("registers the revision retention scheduler with a distinct UTC key", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});

    await registerRevisionHistoryExpirationScheduler({ upsertJobScheduler });

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "revision-history-expire-daily",
      { pattern: "0 6 * * *", tz: "UTC" },
      expect.objectContaining({
        name: "expire-revision-history",
        data: { type: "expire-revision-history" },
        opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
      }),
    );
  });

  it("dispatches a trash expiration job to its registered handler", async () => {
    const handler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "expire-trashed-pages" } } as never,
      { "expire-trashed-pages": handler },
    );

    expect(handler).toHaveBeenCalledOnce();
  });

  it("registers the split events scheduler with a distinct fixed UTC key", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});

    await registerSplitEventsExpirationScheduler({ upsertJobScheduler });

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "split-redirect-events-expire-daily",
      { pattern: "0 2 * * *", tz: "UTC" },
      expect.objectContaining({
        name: "expire-split-redirect-events",
        data: { type: "expire-split-redirect-events" },
        opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
      }),
    );
  });

  it("dispatches a split events expiration job to its registered handler", async () => {
    const handler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "expire-split-redirect-events" } } as never,
      { "expire-split-redirect-events": handler },
    );

    expect(handler).toHaveBeenCalledOnce();
  });

  it("registers the log entries scheduler with a distinct fixed UTC key", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});

    await registerLogEntriesExpirationScheduler({ upsertJobScheduler });

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "log-entries-expire-daily",
      { pattern: "0 3 * * *", tz: "UTC" },
      expect.objectContaining({
        name: "expire-log-entries",
        data: { type: "expire-log-entries" },
        opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
      }),
    );
  });

  it("dispatches a log entries expiration job to its registered handler", async () => {
    const handler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "expire-log-entries" } } as never,
      { "expire-log-entries": handler },
    );

    expect(handler).toHaveBeenCalledOnce();
  });

  it("registers the stale notifications scheduler with a distinct fixed UTC key", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});

    await registerStaleNotificationsExpirationScheduler({ upsertJobScheduler });

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "notifications-expire-stale-daily",
      { pattern: "0 4 * * *", tz: "UTC" },
      expect.objectContaining({
        name: "expire-stale-notifications",
        data: { type: "expire-stale-notifications" },
        opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
      }),
    );
  });

  it("dispatches a stale notifications expiration job to its registered handler", async () => {
    const handler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "expire-stale-notifications" } } as never,
      { "expire-stale-notifications": handler },
    );

    expect(handler).toHaveBeenCalledOnce();
  });

  it("registers the sessions and verifications schedulers with distinct keys and cron times", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});

    await registerSessionsExpirationScheduler({ upsertJobScheduler });
    await registerVerificationsExpirationScheduler({ upsertJobScheduler });

    expect(upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      "sessions-expire-daily",
      { pattern: "0 5 * * *", tz: "UTC" },
      expect.objectContaining({
        name: "expire-expired-sessions",
        data: { type: "expire-expired-sessions" },
      }),
    );
    expect(upsertJobScheduler).toHaveBeenNthCalledWith(
      2,
      "verifications-expire-daily",
      { pattern: "30 5 * * *", tz: "UTC" },
      expect.objectContaining({
        name: "expire-expired-verifications",
        data: { type: "expire-expired-verifications" },
      }),
    );
    // The two schedulers must never share a cron minute — even though the
    // worker's concurrency:1 makes a collision harmless, firing them apart
    // avoids two daily jobs queuing back-to-back for no reason.
    const [, firstCron] = upsertJobScheduler.mock.calls[0];
    const [, secondCron] = upsertJobScheduler.mock.calls[1];
    expect(firstCron.pattern).not.toBe(secondCron.pattern);
  });

  it("dispatches sessions and verifications expiration jobs to their registered handlers", async () => {
    const sessionHandler = vi.fn();
    const verificationHandler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "expire-expired-sessions" } } as never,
      { "expire-expired-sessions": sessionHandler },
    );
    await dispatchPublishingJob(
      { data: { type: "expire-expired-verifications" } } as never,
      { "expire-expired-verifications": verificationHandler },
    );

    expect(sessionHandler).toHaveBeenCalledOnce();
    expect(verificationHandler).toHaveBeenCalledOnce();
  });

  it("registers the media stuck-processing sweep scheduler to repeat every 10 minutes", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});

    await registerMediaStuckSweepScheduler({ upsertJobScheduler });
    await registerMediaStuckSweepScheduler({ upsertJobScheduler });

    expect(upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      "media-stuck-processing-sweep",
      { every: 10 * 60 * 1000 },
      expect.objectContaining({
        name: "media-stuck-sweep",
        data: { type: "media-stuck-sweep" },
        opts: expect.objectContaining({ attempts: 3, removeOnFail: false }),
      }),
    );
  });

  it("dispatches a media stuck-processing sweep job to its registered handler", async () => {
    const handler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "media-stuck-sweep" } } as never,
      { "media-stuck-sweep": handler },
    );

    expect(handler).toHaveBeenCalledOnce();
  });

  it("removes the backup auto scheduler when disabled", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});
    const removeJobScheduler = vi.fn().mockResolvedValue(undefined);

    await registerBackupAutoSnapshotScheduler(
      {
        backupAutoEnabled: false,
        backupIntervalDays: 1,
        backupAutoHour: 3,
        backupAutoMinute: 0,
        timezone: "UTC",
      },
      { upsertJobScheduler, removeJobScheduler },
    );

    expect(removeJobScheduler).toHaveBeenCalledWith(BACKUP_AUTO_SCHEDULER_ID);
    expect(upsertJobScheduler).not.toHaveBeenCalled();
  });

  it("upserts the backup auto scheduler with every/startDate when enabled", async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({});
    const removeJobScheduler = vi.fn().mockResolvedValue(undefined);

    // Antes das 03:00 UTC → startDate é hoje 03:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T01:00:00.000Z"));

    await registerBackupAutoSnapshotScheduler(
      {
        backupAutoEnabled: true,
        backupIntervalDays: 3,
        backupAutoHour: 3,
        backupAutoMinute: 0,
        timezone: "UTC",
      },
      { upsertJobScheduler, removeJobScheduler },
    );

    expect(removeJobScheduler).not.toHaveBeenCalled();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      BACKUP_AUTO_SCHEDULER_ID,
      {
        every: 3 * 24 * 60 * 60 * 1000,
        startDate: new Date("2026-04-10T03:00:00.000Z"),
      },
      expect.objectContaining({
        name: "backup-auto-snapshot",
        data: { type: "backup-auto-snapshot" },
        opts: expect.objectContaining({ attempts: 1, removeOnFail: false }),
      }),
    );

    vi.useRealTimers();
  });

  it("dispatches a backup-auto-snapshot job to its registered handler", async () => {
    const handler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "backup-auto-snapshot" } } as never,
      { "backup-auto-snapshot": handler },
    );

    expect(handler).toHaveBeenCalledOnce();
  });
});
