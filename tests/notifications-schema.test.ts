import { describe, expect, it } from "vitest";

import {
  MAX_NOTIFICATION_LINK_LENGTH,
  MAX_NOTIFICATION_MESSAGE_LENGTH,
} from "@/lib/Modules/Notifications/Types";
import {
  isInternalNotificationLink,
  notificationCreateSchema,
  parseNotificationId,
  parseNotificationsQuery,
} from "@/lib/Modules/Notifications/Schema";

describe("Notifications schema", () => {
  it("accepts safe server-side notification input and query defaults", () => {
    expect(
      notificationCreateSchema.safeParse({
        userId: "user-id",
        message: "Review the affected script.",
        link: "/admin/custom-code/snippet-id?tab=scope",
      }).success,
    ).toBe(true);
    expect(parseNotificationsQuery(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 20,
    });
  });

  it("rejects client-controlled fields, invalid ids, blank messages, and bad pagination", () => {
    expect(
      notificationCreateSchema.safeParse({
        userId: "user-id",
        message: "message",
        role: "ADMIN",
      }).success,
    ).toBe(false);
    expect(() => parseNotificationId(" ")).toThrow();
    expect(() =>
      parseNotificationsQuery(new URLSearchParams({ page: "0" })),
    ).toThrow();
    expect(() =>
      notificationCreateSchema.parse({ userId: "user-id", message: " " }),
    ).toThrow();
  });

  it("rejects external, protocol-relative, escaped, and overlong links", () => {
    for (const link of [
      "https://example.com/admin",
      "//example.com/admin",
      "javascript:alert(1)",
      "/admin\\\\example.com",
    ]) {
      expect(isInternalNotificationLink(link)).toBe(false);
    }

    expect(
      notificationCreateSchema.safeParse({
        userId: "user-id",
        message: "message",
        link: `/${"a".repeat(MAX_NOTIFICATION_LINK_LENGTH)}`,
      }).success,
    ).toBe(false);
  });

  it("enforces message and page-size limits", () => {
    expect(
      notificationCreateSchema.safeParse({
        userId: "user-id",
        message: "a".repeat(MAX_NOTIFICATION_MESSAGE_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      notificationCreateSchema.safeParse({
        userId: "user-id",
        message: "a".repeat(MAX_NOTIFICATION_MESSAGE_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(() =>
      parseNotificationsQuery(new URLSearchParams({ pageSize: "51" })),
    ).toThrow();
  });
});
