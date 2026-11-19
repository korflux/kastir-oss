import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Modules/Settings/publicOrigin", () => ({
  getPublicOrigin: vi.fn(async () => "http://localhost:3000"),
}));
vi.mock("@/lib/Cdn/cloudflarePurge", () => ({ cloudflarePurge: vi.fn() }));
vi.mock("@/lib/Publishing/publicSiteArtifacts", () => ({
  regeneratePublicArtifacts: vi.fn(),
}));
vi.mock("@/lib/Publishing/settingsRebuild", () => ({
  rebuildSettings: vi.fn(),
}));
vi.mock("@/lib/SideEffects/onHomePageRemoved", () => ({
  onHomePageRemoved: vi.fn(),
}));
vi.mock("@/lib/SideEffects/onPageRemovedFromScope", () => ({
  onPageRemovedFromScope: vi.fn(),
}));

import { PageService } from "@/lib/Modules/Pages/Service";

describe("PageService listPages includeDescendants", () => {
  it("filters only direct folder without includeDescendants", async () => {
    const findMany = vi.fn(
      async ({ where }: { where?: { folderId?: unknown } }) => {
        expect(where?.folderId).toBe("root");
        return [];
      },
    );
    const service = new PageService({
      page: { findMany },
      pageFolder: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [
          { id: "root", parentId: null },
          { id: "child", parentId: "root" },
        ]),
      },
    } as never);

    await service.listPages({ folderId: "root" });
  });

  it("expands subtree when includeDescendants is true", async () => {
    const findMany = vi.fn(
      async ({ where }: { where?: { folderId?: unknown } }) => {
        expect(where?.folderId).toEqual({
          in: expect.arrayContaining(["root", "child", "grand"]),
        });
        return [];
      },
    );
    const service = new PageService({
      page: { findMany },
      pageFolder: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [
          { id: "root", parentId: null },
          { id: "child", parentId: "root" },
          { id: "grand", parentId: "child" },
          { id: "other", parentId: null },
        ]),
      },
    } as never);

    await service.listPages({ folderId: "root", includeDescendants: true });
  });
});
