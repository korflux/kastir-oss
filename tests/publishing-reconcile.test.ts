import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { reconcilePublishedSite } from "@/lib/Publishing/reconcile";
import type { PageFileStore } from "@/lib/Publishing/fileStore";

function publishedPage(id: string, slug: string) {
  return {
    id,
    status: "PUBLISHED" as const,
    deletedAt: null,
    publishedRevisionId: `${id}-rev`,
    publishedRevision: {
      id: `${id}-rev`,
      pageId: id,
      title: slug,
      slug,
      content: "<main>Live</main>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
    },
  };
}

function fileStoreWith(present: Set<string>): PageFileStore {
  return {
    read: vi.fn(async (slug: string) =>
      present.has(slug) ? "<html></html>" : null,
    ),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
}

describe("reconcilePublishedSite", () => {
  it("does nothing when there are no published pages", async () => {
    const rebuildGlobal = vi.fn();
    const result = await reconcilePublishedSite({
      database: { page: { findMany: vi.fn(async () => []) } },
      fileStore: fileStoreWith(new Set()),
      rebuildGlobal,
    });

    expect(result).toEqual({ checked: 0, missing: 0, rebuilt: false });
    expect(rebuildGlobal).not.toHaveBeenCalled();
  });

  it("does not rebuild when every published page still has its static output", async () => {
    const rebuildGlobal = vi.fn();
    const result = await reconcilePublishedSite({
      database: {
        page: {
          findMany: vi.fn(async () => [
            publishedPage("1", "home"),
            publishedPage("2", "about"),
          ]),
        },
      },
      fileStore: fileStoreWith(new Set(["home", "about"])),
      rebuildGlobal,
    });

    expect(result).toEqual({ checked: 2, missing: 0, rebuilt: false });
    expect(rebuildGlobal).not.toHaveBeenCalled();
  });

  it("rebuilds the whole site when any published page is missing its static output", async () => {
    const rebuildGlobal = vi.fn().mockResolvedValue(undefined);
    const result = await reconcilePublishedSite({
      database: {
        page: {
          findMany: vi.fn(async () => [
            publishedPage("1", "home"),
            publishedPage("2", "about"),
            publishedPage("3", "pricing"),
          ]),
        },
      },
      fileStore: fileStoreWith(new Set(["home"])),
      rebuildGlobal,
    });

    expect(result).toEqual({ checked: 3, missing: 2, rebuilt: true });
    expect(rebuildGlobal).toHaveBeenCalledOnce();
  });
});
