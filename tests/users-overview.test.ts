import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { UsersService } from "@/lib/Modules/Users/Service";

describe("users countOverview", () => {
  it("counts all users and ADMIN role excluding master", async () => {
    const database = {
      user: {
        count: vi.fn(
          async ({
            where,
          }: { where?: { role?: string; isMaster?: boolean } } = {}) => {
            if (where?.role === "ADMIN" && where.isMaster === false) return 3;
            return 6;
          },
        ),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      account: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      session: { deleteMany: vi.fn() },
      page: { updateMany: vi.fn() },
      inviteToken: {
        findUnique: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      logEntry: { create: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(database),
      ),
    };

    const service = new UsersService(database as never);
    await expect(service.countOverview()).resolves.toEqual({
      total: 6,
      adminCount: 3,
    });
  });
});
