import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { CustomCodeService } from "@/lib/Modules/CustomCode/Service";

describe("scripts countOverview", () => {
  it("returns total snippets and draft count", async () => {
    const database = {
      snippet: {
        count: vi.fn(async ({ where }: { where?: { status?: string } } = {}) =>
          where?.status === "DRAFT" ? 2 : 5,
        ),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      snippetPageScope: { deleteMany: vi.fn(), createMany: vi.fn() },
      page: { findUnique: vi.fn(), findMany: vi.fn() },
      logEntry: { create: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(database),
      ),
    };

    const service = new CustomCodeService(database as never);
    await expect(service.countOverview()).resolves.toEqual({
      total: 5,
      draftCount: 2,
    });
  });
});
