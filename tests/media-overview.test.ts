import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { MediaService } from "@/lib/Modules/Media/Service";

describe("media countOverview", () => {
  it("returns total files and summed sizeBytes", async () => {
    const database = {
      mediaFile: {
        count: vi.fn(async () => 2),
        aggregate: vi.fn(async () => ({ _sum: { sizeBytes: 1024 } })),
        findMany: vi.fn(),
      },
      mediaFolder: { findUnique: vi.fn() },
      logEntry: { create: vi.fn() },
      $transaction: vi.fn(),
    };

    const service = new MediaService(database as never);
    await expect(service.countOverview()).resolves.toEqual({
      total: 2,
      totalSizeBytes: 1024,
    });
  });

  it("falls back to findMany when aggregate is missing", async () => {
    const database = {
      mediaFile: {
        findMany: vi.fn(async () => [{ sizeBytes: 10 }, { sizeBytes: 5 }]),
      },
      mediaFolder: { findUnique: vi.fn() },
      logEntry: { create: vi.fn() },
      $transaction: vi.fn(),
    };

    const service = new MediaService(database as never);
    await expect(service.countOverview()).resolves.toEqual({
      total: 2,
      totalSizeBytes: 15,
    });
  });
});
