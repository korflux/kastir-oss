import { z } from "zod";

import {
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_LINK_LENGTH,
  MAX_NOTIFICATION_MESSAGE_LENGTH,
  MAX_NOTIFICATION_PAGE_SIZE,
  type NotificationCreateInput,
  type NotificationListOptions,
} from "@/lib/Modules/Notifications/Types";

const notificationIdSchema = z.string().trim().min(1).max(191);

const internalLinkSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTIFICATION_LINK_LENGTH)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("\\") &&
      !/^[a-z][a-z\d+.-]*:/i.test(value) &&
      !/[\u0000-\u001f\u007f]/.test(value),
    "Link must be a relative internal path",
  );

export const notificationCreateSchema = z
  .object({
    userId: notificationIdSchema,
    message: z.string().trim().min(1).max(MAX_NOTIFICATION_MESSAGE_LENGTH),
    link: internalLinkSchema.optional(),
  })
  .strict() satisfies z.ZodType<NotificationCreateInput>;

const notificationsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_NOTIFICATION_PAGE_SIZE)
      .default(DEFAULT_NOTIFICATION_PAGE_SIZE),
  })
  .strict();

export function parseNotificationsQuery(
  params: URLSearchParams,
): NotificationListOptions {
  const parsed = notificationsQuerySchema.parse(Object.fromEntries(params));

  return { page: parsed.page, pageSize: parsed.pageSize };
}

export function parseNotificationId(id: string): string {
  return notificationIdSchema.parse(id);
}

export function parseNotificationCreateInput(
  input: unknown,
): NotificationCreateInput {
  return notificationCreateSchema.parse(input);
}

export function isInternalNotificationLink(value: string): boolean {
  return internalLinkSchema.safeParse(value).success;
}
