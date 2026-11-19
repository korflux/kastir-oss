import { prisma } from "@/lib/prisma";
import {
  NOTIFICATION_RETENTION_MS,
  NOTIFICATION_STALE_PURGE_BATCH_SIZE,
  NOTIFICATION_STALE_RETENTION_MS,
  type NotificationCreateInput,
  type NotificationDatabase,
  type NotificationDto,
  NotificationDomainError,
  type NotificationListOptions,
  type NotificationListResult,
  type NotificationRecord,
  type NotificationWhere,
} from "@/lib/Modules/Notifications/Types";
import {
  isInternalNotificationLink,
  parseNotificationCreateInput,
  parseNotificationId,
} from "@/lib/Modules/Notifications/Schema";

const notificationSelect = {
  id: true,
  userId: true,
  message: true,
  link: true,
  readAt: true,
  createdAt: true,
} satisfies Record<keyof NotificationRecord, boolean>;

function toDto(notification: NotificationRecord): NotificationDto {
  return {
    id: notification.id,
    message: notification.message,
    // Defense in depth: never surface a non-internal link even if DB rows are tainted.
    link:
      notification.link && isInternalNotificationLink(notification.link)
        ? notification.link
        : null,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

function notFound(): NotificationDomainError {
  return new NotificationDomainError("NOT_FOUND", "Notification was not found");
}

/** Narrow shape used by the batched notification purges. */
type NotificationPurgeDatabase = {
  notification: {
    findMany(args: {
      where: { createdAt?: { lt: Date }; readAt?: { lt: Date } };
      orderBy: { createdAt: "asc" };
      take: number;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
};

export class NotificationsService {
  constructor(
    private readonly database: NotificationDatabase = prisma as unknown as NotificationDatabase,
  ) {}

  async notify(
    userId: string,
    message: string,
    link?: string,
  ): Promise<NotificationDto> {
    const input = parseNotificationCreateInput({
      userId,
      message,
      ...(link === undefined ? {} : { link }),
    });
    const created = await this.database.notification.create({
      data: {
        userId: input.userId,
        message: input.message,
        link: input.link ?? null,
      },
      select: notificationSelect,
    });

    return toDto(created);
  }

  async listNotifications(
    userId: string,
    options: NotificationListOptions,
  ): Promise<NotificationListResult> {
    const actorId = parseNotificationId(userId);
    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_MS);
    const where: NotificationWhere = {
      userId: actorId,
      OR: [{ readAt: null }, { readAt: { gte: cutoff } }],
    };

    const [total, notifications] = await Promise.all([
      this.database.notification.count({ where }),
      this.database.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: notificationSelect,
      }),
    ]);

    return {
      items: notifications.map(toDto),
      total,
      page: options.page,
      pageSize: options.pageSize,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.database.notification.count({
      where: { userId: parseNotificationId(userId), readAt: null },
    });
  }

  async markAsRead(
    userId: string,
    notificationId: string,
    now = new Date(),
  ): Promise<NotificationDto> {
    const actorId = parseNotificationId(userId);
    const id = parseNotificationId(notificationId);

    await this.database.notification.updateMany({
      where: { id, userId: actorId, readAt: null },
      data: { readAt: now },
    });

    const notification = await this.database.notification.findFirst({
      where: { id, userId: actorId },
      select: notificationSelect,
    });

    if (!notification) throw notFound();
    return toDto(notification);
  }

  async expireReadNotifications(
    now = new Date(),
    options: { batchSize?: number } = {},
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_MS);
    return this.purgeNotifications(
      { readAt: { lt: cutoff } },
      options.batchSize,
    );
  }

  /**
   * Backstop for notifications never read: expireReadNotifications only
   * covers `readAt`, so unread rows accumulate forever without this. Filters
   * by `createdAt` alone, so it catches stale unread and stale read rows
   * alike (the latter would already have been caught by the 30-day job).
   * Batched (find ids, delete by id, repeat) like every other purge job in
   * this phase — never a single unbounded deleteMany.
   */
  async expireStaleNotifications(
    now = new Date(),
    options: { batchSize?: number } = {},
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_STALE_RETENTION_MS);
    return this.purgeNotifications(
      { createdAt: { lt: cutoff } },
      options.batchSize,
    );
  }

  /** Find ids → delete by id → repeat. Never a single unbounded deleteMany. */
  private async purgeNotifications(
    where: { createdAt?: { lt: Date }; readAt?: { lt: Date } },
    batchSize = NOTIFICATION_STALE_PURGE_BATCH_SIZE,
  ): Promise<number> {
    const database = this.database as unknown as NotificationPurgeDatabase;
    let deleted = 0;
    for (;;) {
      const rows = await database.notification.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: batchSize,
        select: { id: true },
      });
      if (rows.length === 0) break;

      const result = await database.notification.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      deleted += result.count;

      if (rows.length < batchSize) break;
    }
    return deleted;
  }
}

export const notificationsService = new NotificationsService();

/** Server-side creation boundary for future event emitters. */
export function notify(
  userId: NotificationCreateInput["userId"],
  message: NotificationCreateInput["message"],
  link?: NotificationCreateInput["link"],
) {
  return notificationsService.notify(userId, message, link);
}

export function listNotifications(
  userId: string,
  options: NotificationListOptions,
) {
  return notificationsService.listNotifications(userId, options);
}

export function unreadCount(userId: string) {
  return notificationsService.unreadCount(userId);
}

export function markAsRead(userId: string, notificationId: string, now?: Date) {
  return notificationsService.markAsRead(userId, notificationId, now);
}

export function expireReadNotifications(
  now?: Date,
  options?: { batchSize?: number },
) {
  return notificationsService.expireReadNotifications(now, options);
}

export function expireStaleNotifications(
  now?: Date,
  options?: { batchSize?: number },
) {
  return notificationsService.expireStaleNotifications(now, options);
}
