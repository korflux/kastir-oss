import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { SplitTestsService } from "@/lib/Modules/SplitTests/Service";

describe("split tests countOverview", () => {
  it("returns total campaigns and PAUSED count", async () => {
    const database = {
      splitCampaign: {
        count: vi.fn(async ({ where }: { where?: { status?: string } } = {}) =>
          where?.status === "PAUSED" ? 2 : 3,
        ),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      splitDestination: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      logEntry: { create: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(database),
      ),
    };

    const service = new SplitTestsService(database as never);
    await expect(service.countOverview()).resolves.toEqual({
      total: 3,
      inactiveCount: 2,
    });
  });
});
