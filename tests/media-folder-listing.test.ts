import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Modules/Settings/publicOrigin", () => ({
  getPublicOrigin: vi.fn(async () => "http://localhost:3000"),
}));
vi.mock("@/lib/Cdn/cloudflarePurge", () => ({ cloudflarePurge: vi.fn() }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(() => ({ add: vi.fn() })),
}));

import { MediaService } from "@/lib/Modules/Media/Service";

describe("MediaService listMedia includeDescendants", () => {
  it("filters only direct folder without includeDescendants", async () => {
    const findMany = vi.fn(
      async ({ where }: { where?: { folderId?: unknown } }) => {
        expect(where?.folderId).toBe("root");
        return [];
      },
    );
    const service = new MediaService({
      mediaFile: { findMany },
      mediaFolder: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [
          { id: "root", parentId: null },
          { id: "child", parentId: "root" },
        ]),
      },
    } as never);

    await service.listMedia({ folderId: "root" });
  });

  it("expands subtree when includeDescendants is true", async () => {
    const findMany = vi.fn(
      async ({ where }: { where?: { folderId?: unknown } }) => {
        expect(where?.folderId).toEqual({
          in: expect.arrayContaining(["root", "child"]),
        });
        return [];
      },
    );
    const service = new MediaService({
      mediaFile: { findMany },
      mediaFolder: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [
          { id: "root", parentId: null },
          { id: "child", parentId: "root" },
        ]),
      },
    } as never);

    await service.listMedia({ folderId: "root", includeDescendants: true });
  });
});
