import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, listNotifications, markAsRead, unreadCount } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    listNotifications: vi.fn(),
    markAsRead: vi.fn(),
    unreadCount: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Modules/Notifications/Service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/Modules/Notifications/Service")
  >("@/lib/Modules/Notifications/Service");
  return {
    ...actual,
    notificationsService: { listNotifications, markAsRead, unreadCount },
  };
});

import { GET } from "@/app/api/admin/notifications/route";
import { POST } from "@/app/api/admin/notifications/[notificationId]/read/route";
import { NotificationDomainError } from "@/lib/Modules/Notifications/Types";

const notification = {
  id: "notification-id",
  message: "Review the affected script.",
  link: "/admin/custom-code/snippet-id",
  readAt: null,
  createdAt: new Date("2026-07-17T12:00:00.000Z"),
};

describe("notifications HTTP contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });
    listNotifications.mockResolvedValue({
      items: [notification],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    unreadCount.mockResolvedValue(1);
    markAsRead.mockResolvedValue({ ...notification, readAt: new Date() });
  });

  it("requires a session and exposes the same protected headers", async () => {
    getSession.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://localhost/api/admin/notifications"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each([
    ["MASTER", true],
    ["ADMIN", false],
    ["EDITOR", false],
  ] as const)(
    "allows %s to read only the session user's data",
    async (role, isMaster) => {
      getSession.mockResolvedValueOnce({
        user: {
          id: `${role.toLowerCase()}-id`,
          role: role === "MASTER" ? "ADMIN" : role,
          isMaster,
        },
      });

      const response = await GET(
        new Request(
          "http://localhost/api/admin/notifications?page=2&pageSize=10",
        ),
      );

      expect(response.status).toBe(200);
      expect(listNotifications).toHaveBeenCalledWith(
        `${role.toLowerCase()}-id`,
        {
          page: 2,
          pageSize: 10,
        },
      );
      await expect(response.json()).resolves.toMatchObject({
        items: [expect.objectContaining({ id: "notification-id" })],
        unreadCount: 1,
      });
    },
  );

  it("rejects client user filters and invalid pagination", async () => {
    const withUserFilter = await GET(
      new Request("http://localhost/api/admin/notifications?userId=other-id"),
    );
    expect(withUserFilter.status).toBe(422);
    expect(listNotifications).not.toHaveBeenCalled();

    const invalidPageSize = await GET(
      new Request("http://localhost/api/admin/notifications?pageSize=51"),
    );
    expect(invalidPageSize.status).toBe(422);
  });

  it("marks a notification with the session owner and returns the refreshed count", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/admin/notifications/notification-id/read",
        {
          method: "POST",
          headers: { origin: "http://localhost" },
        },
      ),
      { params: Promise.resolve({ notificationId: "notification-id" }) },
    );

    expect(response.status).toBe(200);
    expect(markAsRead).toHaveBeenCalledWith("admin-id", "notification-id");
    expect(unreadCount).toHaveBeenCalledWith("admin-id");
    await expect(response.json()).resolves.toMatchObject({ unreadCount: 1 });
  });

  it("does not accept a client body and hides ownership/not-found details", async () => {
    const body = await POST(
      new Request(
        "http://localhost/api/admin/notifications/notification-id/read",
        {
          method: "POST",
          headers: { origin: "http://localhost" },
          body: JSON.stringify({ userId: "other-id", readAt: "now" }),
        },
      ),
      { params: Promise.resolve({ notificationId: "notification-id" }) },
    );
    expect(body.status).toBe(422);
    expect(markAsRead).not.toHaveBeenCalled();

    markAsRead.mockRejectedValueOnce(
      new NotificationDomainError("NOT_FOUND", "Notification was not found"),
    );
    const notFound = await POST(
      new Request("http://localhost/api/admin/notifications/other-id/read", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      { params: Promise.resolve({ notificationId: "other-id" }) },
    );
    expect(notFound.status).toBe(404);
    await expect(notFound.json()).resolves.not.toMatchObject({
      error: expect.stringContaining("other-id"),
    });
  });

  it("maps unexpected failures without leaking internals", async () => {
    listNotifications.mockRejectedValueOnce(new Error("database internals"));

    const response = await GET(
      new Request("http://localhost/api/admin/notifications"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.not.toMatchObject({
      error: "database internals",
    });
  });
});
