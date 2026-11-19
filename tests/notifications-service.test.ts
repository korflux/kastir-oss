import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  NOTIFICATION_RETENTION_MS,
  NOTIFICATION_STALE_RETENTION_MS,
  type NotificationDatabase,
  type NotificationRecord,
  type NotificationWhere,
} from "@/lib/Modules/Notifications/Types";
import { NotificationsService } from "@/lib/Modules/Notifications/Service";

function record(
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord {
  return {
    id: "notification-id",
    userId: "user-id",
    message: "Review the affected script.",
    link: "/admin/custom-code/snippet-id",
    readAt: null,
    createdAt: new Date("2026-07-17T12:00:00.000Z"),
    ...overrides,
  };
}

function createDatabase(initial: NotificationRecord[] = []) {
  const records = [...initial];
  const database: NotificationDatabase = {
    notification: {
      create: vi.fn(async ({ data }) => {
        const created = record({
          id: `created-${records.length + 1}`,
          userId: data.userId,
          message: data.message,
          link: data.link ?? null,
        });
        records.push(created);
        return created;
      }),
      findMany: vi.fn(
        async ({
          where,
          skip,
          take,
          orderBy,
        }: {
          where: NotificationWhere;
          skip?: number;
          take: number;
          orderBy?:
            | Array<{ createdAt: "desc" } | { id: "desc" }>
            | { createdAt: "asc" };
        }) => {
          const matching = records.filter((item) => {
            const userMatches = !where.userId || item.userId === where.userId;
            const readMatches =
              where.readAt === undefined ||
              (where.readAt === null
                ? item.readAt === null
                : item.readAt !== null &&
                  (!where.readAt.gte || item.readAt >= where.readAt.gte) &&
                  (!where.readAt.lt || item.readAt < where.readAt.lt));
            const createdAtMatches =
              where.createdAt?.lt === undefined ||
              item.createdAt < where.createdAt.lt;
            const orMatches =
              !where.OR ||
              where.OR.some((condition) => {
                if (condition.readAt === null) return item.readAt === null;
                return (
                  condition.readAt?.gte !== undefined &&
                  item.readAt !== null &&
                  item.readAt >= condition.readAt.gte
                );
              });
            return userMatches && readMatches && createdAtMatches && orMatches;
          });
          const sorted =
            !Array.isArray(orderBy) && orderBy?.createdAt === "asc"
              ? [...matching].sort(
                  (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
                )
              : matching;
          return sorted.slice(skip ?? 0, (skip ?? 0) + take);
        },
      ),
      findFirst: vi.fn(
        async ({ where }) =>
          records.find(
            (item) =>
              (!where.id || item.id === where.id) &&
              (!where.userId || item.userId === where.userId),
          ) ?? null,
      ),
      count: vi.fn(
        async ({ where }) =>
          records.filter(
            (item) =>
              (!where.userId || item.userId === where.userId) &&
              (where.readAt === undefined ||
                (where.readAt === null ? item.readAt === null : false)),
          ).length,
      ),
      updateMany: vi.fn(async ({ where, data }) => {
        const matching = records.filter(
          (item) =>
            item.id === where.id &&
            item.userId === where.userId &&
            (where.readAt === null ? item.readAt === null : true),
        );
        for (const item of matching) item.readAt = data.readAt;
        return { count: matching.length };
      }),
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: NotificationWhere & { id?: { in?: string[] } };
        }) => {
          const before = records.length;
          for (let index = records.length - 1; index >= 0; index -= 1) {
            const item = records[index];
            const matchesReadAt =
              where.readAt?.lt !== undefined &&
              item.readAt !== null &&
              item.readAt < where.readAt.lt;
            const matchesCreatedAt =
              where.createdAt?.lt !== undefined &&
              item.createdAt < where.createdAt.lt;
            const matchesIds =
              where.id?.in !== undefined && where.id.in.includes(item.id);
            if (matchesReadAt || matchesCreatedAt || matchesIds) {
              records.splice(index, 1);
            }
          }
          return { count: before - records.length };
        },
      ),
    },
  };

  return { database, records };
}

describe("NotificationsService", () => {
  it("creates notifications through notify and exposes a safe DTO", async () => {
    const { database } = createDatabase();
    const service = new NotificationsService(database);

    const result = await service.notify(
      "user-id",
      "  Review the affected script.  ",
      "/admin/custom-code/snippet-id",
    );

    expect(result).toEqual({
      id: "created-1",
      message: "Review the affected script.",
      link: "/admin/custom-code/snippet-id",
      readAt: null,
      createdAt: expect.any(Date),
    });
    expect(result).not.toHaveProperty("userId");
  });

  it("nulls non-internal links when mapping records to DTOs", async () => {
    const { database } = createDatabase([
      record({
        id: "tainted",
        link: "https://evil.example/phish",
      }),
    ]);
    const service = new NotificationsService(database);

    const result = await service.listNotifications("user-id", {
      page: 1,
      pageSize: 20,
      now: new Date("2026-07-17T12:00:00.000Z"),
    });

    expect(result.items).toEqual([
      expect.objectContaining({ id: "tainted", link: null }),
    ]);
  });

  it("lists only the session user, hides expired reads, and keeps stable pagination", async () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    const { database } = createDatabase([
      record({ id: "new", createdAt: new Date("2026-07-17T11:00:00.000Z") }),
      record({
        id: "other-user",
        userId: "other-id",
        createdAt: new Date("2026-07-17T10:00:00.000Z"),
      }),
      record({
        id: "expired",
        readAt: new Date(now.getTime() - NOTIFICATION_RETENTION_MS - 1),
      }),
    ]);
    const service = new NotificationsService(database);

    const result = await service.listNotifications("user-id", {
      page: 1,
      pageSize: 20,
      now,
    });

    expect(result.items.map((item) => item.id)).toEqual(["new"]);
    expect(result.items[0]).not.toHaveProperty("userId");
    expect(database.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-id",
          OR: [
            { readAt: null },
            {
              readAt: {
                gte: new Date(now.getTime() - NOTIFICATION_RETENTION_MS),
              },
            },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("counts all unread notifications, including very old ones", async () => {
    const { database } = createDatabase([
      record({ id: "old-unread", createdAt: new Date("2020-01-01") }),
      record({ id: "read", readAt: new Date("2026-07-17T11:00:00.000Z") }),
    ]);
    const service = new NotificationsService(database);

    await expect(service.unreadCount("user-id")).resolves.toBe(1);
    expect(database.notification.count).toHaveBeenCalledWith({
      where: { userId: "user-id", readAt: null },
    });
  });

  it("marks only owned notifications and preserves the first read time", async () => {
    const firstReadAt = new Date("2026-07-17T10:00:00.000Z");
    const { database, records } = createDatabase([
      record({ id: "owned", readAt: null }),
      record({ id: "already-read", readAt: firstReadAt }),
      record({ id: "other", userId: "other-id" }),
    ]);
    const service = new NotificationsService(database);
    const now = new Date("2026-07-17T12:00:00.000Z");

    await expect(
      service.markAsRead("user-id", "owned", now),
    ).resolves.toMatchObject({
      id: "owned",
      readAt: now,
    });
    await expect(
      service.markAsRead(
        "user-id",
        "already-read",
        new Date("2026-07-17T13:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ id: "already-read", readAt: firstReadAt });
    await expect(
      service.markAsRead("user-id", "other", now),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(records.find((item) => item.id === "other")?.readAt).toBeNull();
  });

  it("expires only read notifications older than the retention cutoff", async () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    const { database, records } = createDatabase([
      record({ id: "unread-old", createdAt: new Date("2020-01-01") }),
      record({ id: "read-recent", readAt: new Date(now.getTime() - 1) }),
      record({
        id: "read-expired",
        readAt: new Date(now.getTime() - NOTIFICATION_RETENTION_MS - 1),
      }),
    ]);
    const service = new NotificationsService(database);

    await expect(service.expireReadNotifications(now)).resolves.toBe(1);
    expect(records.map((item) => item.id)).toEqual([
      "unread-old",
      "read-recent",
    ]);
    expect(database.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["read-expired"] } },
    });
  });

  it("expires read notifications in batches instead of one unbounded deleteMany", async () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    const old = new Date(now.getTime() - NOTIFICATION_RETENTION_MS - 1);
    const { database, records } = createDatabase([
      record({ id: "read-old-1", readAt: old, createdAt: old }),
      record({ id: "read-old-2", readAt: old, createdAt: old }),
      record({ id: "unread-old", readAt: null, createdAt: old }),
    ]);
    const service = new NotificationsService(database);

    await expect(
      service.expireReadNotifications(now, { batchSize: 1 }),
    ).resolves.toBe(2);
    expect(records.map((item) => item.id)).toEqual(["unread-old"]);
    expect(database.notification.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("expires stale notifications regardless of read state, closing the unread gap, in batches", async () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    const staleCutoff = new Date(
      now.getTime() - NOTIFICATION_STALE_RETENTION_MS,
    );
    const { database, records } = createDatabase([
      record({
        id: "unread-stale-1",
        readAt: null,
        createdAt: new Date(staleCutoff.getTime() - 3_000),
      }),
      record({
        id: "unread-stale-2",
        readAt: null,
        createdAt: new Date(staleCutoff.getTime() - 2_000),
      }),
      record({
        id: "read-stale",
        readAt: new Date(staleCutoff.getTime() - 1_000),
        createdAt: new Date(staleCutoff.getTime() - 1_000),
      }),
      record({
        id: "unread-fresh",
        readAt: null,
        createdAt: new Date(now.getTime() - 1_000),
      }),
      record({
        id: "read-fresh",
        readAt: new Date(now.getTime() - 1_000),
        createdAt: new Date(now.getTime() - 2_000),
      }),
    ]);
    const service = new NotificationsService(database);

    // batchSize: 1 forces the loop to paginate across 3 iterations instead
    // of relying on a single unbounded deleteMany.
    await expect(
      service.expireStaleNotifications(now, { batchSize: 1 }),
    ).resolves.toBe(3);
    expect(records.map((item) => item.id).sort()).toEqual([
      "read-fresh",
      "unread-fresh",
    ]);
    expect(database.notification.deleteMany).toHaveBeenCalledTimes(3);
    expect(database.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: expect.any(Array) } },
    });
  });
});
