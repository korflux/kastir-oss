import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaClient } from "@/app/generated/prisma/client";
import {
  notify,
  NotificationsService,
} from "@/lib/Modules/Notifications/Service";
import { NOTIFICATION_EXPIRATION_SCHEDULER_ID } from "@/lib/Modules/Notifications/Types";
import {
  createPublishingQueue,
  registerNotificationExpirationScheduler,
} from "@/lib/Publishing/queue";
import { processExpireReadNotificationsJob } from "@/lib/Jobs/expireReadNotifications";

const integrationEnabled = process.env.NOTIFICATIONS_TEST === "1";
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const describeIntegration = describe.skipIf(
  !integrationEnabled || !databaseUrl || !redisUrl,
);

describeIntegration(
  "Notifications against the development Postgres and Redis",
  () => {
    let database: PrismaClient;
    let service: NotificationsService;
    let actorId: string;
    let markerIds: string[] = [];
    let queue: ReturnType<typeof createPublishingQueue>;

    beforeAll(async () => {
      database = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl! }),
      });
      const actor = await database.user.findFirst({
        where: { isMaster: true },
        select: { id: true },
      });
      if (!actor) throw new Error("DATABASE_URL has no master user");
      actorId = actor.id;
      service = new NotificationsService(database as never);

      const unreadOld = await notify(
        actorId,
        `notifications-integration-unread-${Date.now()}`,
        "/admin",
      );
      const readRecent = await notify(
        actorId,
        `notifications-integration-recent-${Date.now()}`,
      );
      const readExpired = await notify(
        actorId,
        `notifications-integration-expired-${Date.now()}`,
      );
      markerIds = [unreadOld.id, readRecent.id, readExpired.id];

      const now = new Date();
      await database.notification.updateMany({
        where: { id: unreadOld.id },
        data: { createdAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000) },
      });
      await database.notification.update({
        where: { id: readRecent.id },
        data: { readAt: new Date(now.getTime() - 1_000) },
      });
      await database.notification.update({
        where: { id: readExpired.id },
        data: { readAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000) },
      });

      queue = createPublishingQueue(redisUrl!);
      await registerNotificationExpirationScheduler(queue);
      await expect(
        queue.getJobScheduler(NOTIFICATION_EXPIRATION_SCHEDULER_ID),
      ).resolves.toBeTruthy();
    });

    afterAll(async () => {
      if (markerIds.length) {
        await database.notification.deleteMany({
          where: { id: { in: markerIds } },
        });
      }
      await queue?.removeJobScheduler(NOTIFICATION_EXPIRATION_SCHEDULER_ID);
      await Promise.all([queue?.close(), database?.$disconnect()]);
    });

    it("keeps old unread notifications, hides recent reads, and expires only old reads", async () => {
      const before = await service.listNotifications(actorId, {
        page: 1,
        pageSize: 20,
      });
      expect(before.items.map((item) => item.id)).toEqual(
        expect.arrayContaining([markerIds[0], markerIds[1]]),
      );
      expect(before.items.map((item) => item.id)).not.toContain(markerIds[2]);

      await processExpireReadNotificationsJob({} as never);

      await expect(
        database.notification.findUnique({ where: { id: markerIds[2] } }),
      ).resolves.toBeNull();
      await expect(
        database.notification.findUnique({ where: { id: markerIds[0] } }),
      ).resolves.toMatchObject({ readAt: null });
      await expect(
        database.notification.findUnique({ where: { id: markerIds[1] } }),
      ).resolves.toBeTruthy();
    });
  },
);
