import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { PageService } from "@/lib/Modules/Pages/Service";

type StoredPage = {
  id: string;
  title: string;
  slug: string;
  content: string;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeyword: string | null;
  status: "DRAFT" | "PUBLISHED";
  folderId: string;
  authorId: string;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function createSearchDatabase() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const pages: StoredPage[] = [
    {
      id: "black-1",
      title: "Black Friday [01]",
      slug: "black-friday-01",
      content: "<p>A</p>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      status: "PUBLISHED",
      folderId: "folder-a",
      authorId: "master-id",
      publishedAt: now,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "natal-1",
      title: "Natal 2026",
      slug: "natal-2026",
      content: "<p>B</p>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      status: "DRAFT",
      folderId: "folder-b",
      authorId: "master-id",
      publishedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "black-2",
      title: "Other",
      slug: "promo-black",
      content: "<p>C</p>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      status: "DRAFT",
      folderId: "folder-a",
      authorId: "master-id",
      publishedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const database = {
    page: {
      findMany: vi.fn(
        async ({
          where = {},
        }: {
          where?: {
            deletedAt?: Date | null | { not: null };
            folderId?: string;
            OR?: Array<
              | { title: { contains: string; mode: string } }
              | { slug: { contains: string; mode: string } }
            >;
          };
        } = {}) =>
          pages.filter((page) => {
            if (where.deletedAt === null && page.deletedAt !== null)
              return false;
            if (
              where.deletedAt &&
              typeof where.deletedAt === "object" &&
              "not" in where.deletedAt &&
              page.deletedAt === null
            ) {
              return false;
            }
            if (where.folderId && page.folderId !== where.folderId)
              return false;
            if (where.OR?.length) {
              const term = (
                "title" in where.OR[0]
                  ? where.OR[0].title.contains
                  : where.OR[0].slug.contains
              ).toLocaleLowerCase();
              const hit =
                page.title.toLocaleLowerCase().includes(term) ||
                page.slug.toLocaleLowerCase().includes(term);
              if (!hit) return false;
            }
            return true;
          }),
      ),
    },
  };

  return { database, pages };
}

describe("pages search", () => {
  it("filters by title/slug case-insensitively when search is set", async () => {
    const { database } = createSearchDatabase();
    const service = new PageService(database as never);

    const hits = await service.listPages({ search: "black" });
    expect(hits.map((page) => page.id).sort()).toEqual(["black-1", "black-2"]);
  });

  it("returns the full active list when search is empty or omitted", async () => {
    const { database } = createSearchDatabase();
    const service = new PageService(database as never);

    await expect(service.listPages()).resolves.toHaveLength(3);
    await expect(service.listPages({ search: "   " })).resolves.toHaveLength(3);
  });

  it("combines folderId and search with AND", async () => {
    const { database } = createSearchDatabase();
    const service = new PageService(database as never);

    const hits = await service.listPages({
      folderId: "folder-a",
      search: "black",
    });
    expect(hits.map((page) => page.id).sort()).toEqual(["black-1", "black-2"]);

    const none = await service.listPages({
      folderId: "folder-b",
      search: "black",
    });
    expect(none).toEqual([]);
  });
});
