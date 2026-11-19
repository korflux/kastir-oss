import "dotenv/config";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Verifies phase 18's new Redis-backed wiring against the real dev Redis
 * (docs/reference/database-schema.md / SPEC-FASE-18) — the parts unit tests
 * mock away: the telemetry rate limiter actually enforcing a window, and
 * the new expiration schedulers actually registering on BullMQ. Postgres
 * purge/rollup *logic* is already covered by fakes in split-tests-
 * aggregation/logs-purge/auth-purge tests; this file intentionally never
 * touches real Postgres rows to avoid risking shared dev data.
 *
 * Opt-in only: `PHASE18_VERIFY=1 pnpm test -- phase18-live-verification`.
 */
const liveEnabled = process.env.PHASE18_VERIFY === "1";
const redisUrl = process.env.REDIS_URL;
const describeLive = describe.skipIf(!liveEnabled || !redisUrl);

describeLive("Phase 18 wiring against the real dev Redis", () => {
  it("telemetry rate limiter allows up to the configured burst then denies, on a real Redis-backed window", async () => {
    const { isTelemetryWriteAllowed } =
      await import("@/lib/Modules/SplitTests/telemetryRateLimit");
    const { SPLIT_TELEMETRY_RATE_LIMIT } =
      await import("@/lib/Modules/SplitTests/constants");

    const probeKey = `phase18-live-verify-${Date.now()}`;
    const results: boolean[] = [];
    for (let i = 0; i < SPLIT_TELEMETRY_RATE_LIMIT.requests + 3; i += 1) {
      results.push(await isTelemetryWriteAllowed("203.0.113.1", probeKey));
    }

    const allowedCount = results.filter(Boolean).length;
    expect(allowedCount).toBe(SPLIT_TELEMETRY_RATE_LIMIT.requests);
    expect(results.slice(-3)).toEqual([false, false, false]);
  }, 20_000);

  it("registers every phase-18 expiration scheduler on the real BullMQ queue", async () => {
    const {
      createPublishingQueue,
      registerSplitEventsExpirationScheduler,
      registerLogEntriesExpirationScheduler,
      registerStaleNotificationsExpirationScheduler,
      registerSessionsExpirationScheduler,
      registerVerificationsExpirationScheduler,
      SPLIT_EVENTS_EXPIRATION_SCHEDULER_ID,
      LOG_ENTRIES_EXPIRATION_SCHEDULER_ID,
      SESSIONS_EXPIRATION_SCHEDULER_ID,
      VERIFICATIONS_EXPIRATION_SCHEDULER_ID,
    } = await import("@/lib/Publishing/queue");
    const { NOTIFICATION_STALE_EXPIRATION_SCHEDULER_ID } =
      await import("@/lib/Modules/Notifications/Types");

    const queue = createPublishingQueue(redisUrl!);
    const schedulerIds = [
      SPLIT_EVENTS_EXPIRATION_SCHEDULER_ID,
      LOG_ENTRIES_EXPIRATION_SCHEDULER_ID,
      NOTIFICATION_STALE_EXPIRATION_SCHEDULER_ID,
      SESSIONS_EXPIRATION_SCHEDULER_ID,
      VERIFICATIONS_EXPIRATION_SCHEDULER_ID,
    ];

    try {
      await registerSplitEventsExpirationScheduler(queue);
      await registerLogEntriesExpirationScheduler(queue);
      await registerStaleNotificationsExpirationScheduler(queue);
      await registerSessionsExpirationScheduler(queue);
      await registerVerificationsExpirationScheduler(queue);

      for (const id of schedulerIds) {
        await expect(queue.getJobScheduler(id)).resolves.toBeTruthy();
      }
    } finally {
      await Promise.all(schedulerIds.map((id) => queue.removeJobScheduler(id)));
      await queue.close();
    }
  }, 20_000);
});
