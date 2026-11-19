import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { onPageRemovedFromScope, onHomePageRemoved } = vi.hoisted(() => ({
  onPageRemovedFromScope: vi.fn().mockResolvedValue(undefined),
  onHomePageRemoved: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/SideEffects/onPageRemovedFromScope", () => ({
  onPageRemovedFromScope,
}));
vi.mock("@/lib/SideEffects/onHomePageRemoved", () => ({ onHomePageRemoved }));
// This suite asserts side-effect *ordering*, not artifact content — the fake
// fileStore below isn't disk-backed, so without this mock a mock database
// that includes siteSettings would make refreshPublicArtifacts() write real
// sitemap.xml/llms.txt/robots.txt files into the repo's public/ directory.
vi.mock("@/lib/Publishing/publicSiteArtifacts", () => ({
  regeneratePublicArtifacts: vi.fn().mockResolvedValue(undefined),
}));

import { PageService } from "@/lib/Modules/Pages/Service";

function makePage(
  overrides: Partial<{
    id: string;
    title: string;
    slug: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: overrides.id ?? "page-id",
    title: overrides.title ?? "Landing",
    slug: overrides.slug ?? "landing",
    content: "<h1>Landing</h1>",
    seoTitle: null,
    seoDescription: null,
    seoKeyword: null,
    status: "PUBLISHED" as const,
    folderId: "base-id",
    authorId: "master-id",
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: overrides.deletedAt ?? null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function databaseForRemoval(page: ReturnType<typeof makePage>) {
  const calls: string[] = [];
  const fileOps: string[] = [];
  const database = {
    page: {
      findUnique: vi.fn(async () => page),
      findMany: vi.fn(async () => [page]),
      create: vi.fn(),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(page, data);
        return page;
      }),
      delete: vi.fn(),
      deleteMany: vi.fn(async () => {
        calls.push("delete");
        return { count: 1 };
      }),
    },
    pageFolder: { findUnique: vi.fn() },
    snippet: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    snippetPageScope: {
      findMany: vi.fn(async () => {
        calls.push("capture-scope");
        return [{ snippetId: "snippet-id" }];
      }),
      deleteMany: vi.fn(async () => {
        calls.push("delete-scope");
        return { count: 1 };
      }),
    },
    siteSettings: {
      findUnique: vi.fn(async () => ({
        homePageId: "page-id",
        siteUrl: "http://localhost",
        siteTitle: "Kastir",
        seoDescription: null,
        siteLanguage: "en",
        indexable: true,
        faviconMediaId: null,
      })),
    },
    logEntry: { create: vi.fn(async () => undefined) },
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };
  const fileStore = {
    read: vi.fn(async () => null as string | null),
    write: vi.fn(async () => {
      fileOps.push("write");
    }),
    remove: vi.fn(async () => {
      fileOps.push("remove");
    }),
  };
  return { database, calls, fileStore, fileOps };
}

describe("PageService removal ordering", () => {
  it("captures scopes before trash mutation and awaits listeners in canonical order", async () => {
    const page = makePage();
    const { database, calls } = databaseForRemoval(page);
    onPageRemovedFromScope.mockClear();
    onHomePageRemoved.mockClear();
    onPageRemovedFromScope.mockImplementationOnce(async () => {
      calls.push("orphan-listener");
    });
    onHomePageRemoved.mockImplementationOnce(async () => {
      calls.push("home-listener");
      return false;
    });

    const service = new PageService(
      database as never,
      { read: async () => null, write: vi.fn(), remove: vi.fn() },
      vi.fn() as never,
    );

    await service.trashPage("master-id", "page-id");

    expect(calls).toEqual([
      "capture-scope",
      "delete-scope",
      "orphan-listener",
      "home-listener",
    ]);
    expect(onPageRemovedFromScope).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "page-id",
        snippetIds: ["snippet-id"],
        isHome: true,
        actorId: "master-id",
      }),
      expect.anything(),
    );
    expect(onHomePageRemoved).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "page-id", isHome: true }),
      expect.objectContaining({ rebuild: expect.any(Function) }),
    );
  });

  it("reconciles scopes and listeners before hard delete so retries remain possible", async () => {
    const page = makePage({ deletedAt: new Date("2026-01-01T00:00:00.000Z") });
    const { database, calls } = databaseForRemoval(page);
    onPageRemovedFromScope.mockClear();
    onHomePageRemoved.mockClear();
    onPageRemovedFromScope.mockImplementationOnce(async () => {
      calls.push("orphan-listener");
    });
    onHomePageRemoved.mockImplementationOnce(async () => {
      calls.push("home-listener");
      return false;
    });

    const service = new PageService(
      database as never,
      { read: async () => null, write: vi.fn(), remove: vi.fn() },
      vi.fn() as never,
    );

    await expect(
      service.permanentlyDeletePage("master-id", "page-id", "MASTER"),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      "capture-scope",
      "delete-scope",
      "orphan-listener",
      "home-listener",
      "delete",
    ]);
  });

  it("expires only old trash rows through the system actor and is idempotent", async () => {
    const page = makePage({ deletedAt: new Date("2026-01-01T00:00:00.000Z") });
    const { database } = databaseForRemoval(page);
    onPageRemovedFromScope.mockClear();
    onHomePageRemoved.mockClear();
    onPageRemovedFromScope.mockResolvedValue(undefined);
    onHomePageRemoved.mockResolvedValue(false);

    const service = new PageService(
      database as never,
      { read: async () => null, write: vi.fn(), remove: vi.fn() },
      vi.fn() as never,
    );
    const now = new Date("2026-02-01T00:00:00.000Z");

    await expect(service.expireTrashedPages(now)).resolves.toBe(1);
    expect(database.page.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "page-id",
        deletedAt: { lt: expect.any(Date) },
      }),
    });
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "system:expire-trashed-pages" }),
    });
  });

  it("propagates a durable post-commit listener failure after residual refresh", async () => {
    const page = makePage();
    const { database } = databaseForRemoval(page);
    onPageRemovedFromScope.mockClear();
    onHomePageRemoved.mockClear();
    const listenerError = new Error("listener failed");
    const homeCallsBefore = onHomePageRemoved.mock.calls.length;
    onPageRemovedFromScope.mockRejectedValueOnce(listenerError);
    const service = new PageService(
      database as never,
      { read: async () => null, write: vi.fn(), remove: vi.fn() },
      vi.fn() as never,
    );

    await expect(service.trashPage("master-id", "page-id")).rejects.toBe(
      listenerError,
    );
    expect(onHomePageRemoved).toHaveBeenCalledTimes(homeCallsBefore);
  });

  it("does not remove a concurrent publish when permanent delete loses the race", async () => {
    const page = makePage({ deletedAt: new Date("2026-01-01T00:00:00.000Z") });
    const { database, fileStore, fileOps } = databaseForRemoval(page);
    database.page.deleteMany = vi.fn(async () => {
      return { count: 0 };
    });
    fileStore.read = vi.fn(async () => null);
    onPageRemovedFromScope.mockResolvedValue(undefined);
    onHomePageRemoved.mockResolvedValue(false);

    const service = new PageService(
      database as never,
      fileStore,
      vi.fn() as never,
    );
    await expect(
      service.permanentlyDeletePageAsSystem("page-id", {
        now: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ).resolves.toBe(false);

    expect(fileOps).not.toContain("remove");
    expect(fileStore.write).not.toHaveBeenCalled();
  });

  it("batches trash expiration and continues after a per-page failure", async () => {
    const oldA = makePage({
      id: "a",
      slug: "a",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const oldB = makePage({
      id: "b",
      slug: "b",
      deletedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const pages = [oldA, oldB];
    const database = {
      page: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            pages.find((item) => item.id === where.id) ?? null,
        ),
        findMany: vi.fn(async () => pages),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === "a") throw new Error("db flake");
          return { count: 1 };
        }),
      },
      pageFolder: { findUnique: vi.fn() },
      snippetPageScope: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      siteSettings: {
        findUnique: vi.fn(async () => ({
          homePageId: null,
          siteUrl: "http://localhost",
          siteTitle: "Kastir",
          seoDescription: null,
          siteLanguage: "en",
          indexable: true,
          faviconMediaId: null,
          allowAiCrawlers: false,
        })),
      },
      logEntry: { create: vi.fn(async () => undefined) },
      $transaction: vi.fn(async <T>(callback: (tx: unknown) => Promise<T>) =>
        callback(database),
      ),
    };
    onPageRemovedFromScope.mockResolvedValue(undefined);
    onHomePageRemoved.mockResolvedValue(false);

    const service = new PageService(
      database as never,
      { read: async () => null, write: vi.fn(), remove: vi.fn() },
      vi.fn() as never,
    );

    await expect(
      service.expireTrashedPages(new Date("2026-02-15T00:00:00.000Z"), {
        batchSize: 10,
      }),
    ).rejects.toThrow(/1 failure\(s\); deleted 1/);
    expect(database.page.deleteMany).toHaveBeenCalled();
  });
});
