export const NOTIFICATION_RETENTION_DAYS = 30;
export const NOTIFICATION_RETENTION_MS =
  NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Backstop for unread notifications, which the 30-day read-only purge never touches. */
export const NOTIFICATION_STALE_RETENTION_DAYS = 90;
export const NOTIFICATION_STALE_RETENTION_MS =
  NOTIFICATION_STALE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Max notifications processed per stale-expiration job batch query. */
export const NOTIFICATION_STALE_PURGE_BATCH_SIZE = 500;
export const DEFAULT_NOTIFICATION_PAGE_SIZE = 20;
export const MAX_NOTIFICATION_PAGE_SIZE = 50;
export const MAX_NOTIFICATION_MESSAGE_LENGTH = 2_000;
export const MAX_NOTIFICATION_LINK_LENGTH = 2_048;
export const NOTIFICATION_EXPIRATION_SCHEDULER_ID =
  "notifications-expire-read-daily";
export const NOTIFICATION_STALE_EXPIRATION_SCHEDULER_ID =
  "notifications-expire-stale-daily";

export type NotificationDto = {
  id: string;
  message: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export type NotificationListOptions = {
  page: number;
  pageSize: number;
  now?: Date;
};

export type NotificationListResult = {
  items: NotificationDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type NotificationCreateInput = {
  userId: string;
  message: string;
  link?: string;
};

export type NotificationWhere = {
  id?: string;
  userId?: string;
  readAt?: null | { lt?: Date; gte?: Date };
  createdAt?: { lt?: Date };
  OR?: NotificationWhere[];
};

export type NotificationRecord = NotificationDto & { userId: string };

export type NotificationDatabase = {
  notification: {
    create(args: {
      data: {
        userId: string;
        message: string;
        link?: string | null;
      };
      select: Record<keyof NotificationRecord, boolean>;
    }): Promise<NotificationRecord>;
    findMany(args: {
      where: NotificationWhere;
      orderBy: Array<{ createdAt: "desc" } | { id: "desc" }>;
      skip: number;
      take: number;
      select: Record<keyof NotificationRecord, boolean>;
    }): Promise<NotificationRecord[]>;
    findFirst(args: {
      where: NotificationWhere;
      select: Record<keyof NotificationRecord, boolean>;
    }): Promise<NotificationRecord | null>;
    count(args: { where: NotificationWhere }): Promise<number>;
    updateMany(args: {
      where: NotificationWhere;
      data: { readAt: Date };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: NotificationWhere }): Promise<{ count: number }>;
  };
};

export type NotificationDomainErrorCode = "VALIDATION_ERROR" | "NOT_FOUND";

export class NotificationDomainError extends Error {
  constructor(
    public readonly code: NotificationDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotificationDomainError";
  }
}
