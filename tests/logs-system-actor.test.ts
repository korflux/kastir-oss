import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { LogsService } from "@/lib/Modules/Logs/Service";

describe("system retention actor in Logs", () => {
  it("renders the sentinel as a stable system actor without a User row", async () => {
    const database = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "admin-id",
          name: "Admin",
          role: "ADMIN",
          isMaster: false,
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      logEntry: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "log-id",
            userId: "system:expire-trashed-pages",
            action: "PAGE_PERMANENTLY_DELETED",
            objectType: "PAGE",
            objectLabel: "Landing (/landing)",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
          },
        ]),
      },
    };

    await expect(
      new LogsService(database).listLogs("admin-id", {
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          userId: "system:expire-trashed-pages",
          actor: {
            name: "System",
            role: null,
            removed: false,
          },
        },
      ],
    });
  });
});
