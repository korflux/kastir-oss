import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { PageService } from "@/lib/Modules/Pages/Service";

describe("pages countOverview", () => {
  it("counts active pages and those published in the last 7 days", async () => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const pages = [
      {
        id: "1",
        title: "A",
        slug: "a",
        content: "",
        seoTitle: null,
        seoDescription: null,
        seoKeyword: null,
        status: "PUBLISHED" as const,
        folderId: "f",
        authorId: "u",
        publishedAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "2",
        title: "B",
        slug: "b",
        content: "",
        seoTitle: null,
        seoDescription: null,
        seoKeyword: null,
        status: "DRAFT" as const,
        folderId: "f",
        authorId: "u",
        publishedAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "3",
        title: "Old",
        slug: "old",
        content: "",
        seoTitle: null,
        seoDescription: null,
        seoKeyword: null,
        status: "PUBLISHED" as const,
        folderId: "f",
        authorId: "u",
        publishedAt: new Date(now - weekMs - 1000),
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const database = {
      page: {
        count: vi.fn(
          async ({
            where,
          }: {
            where?: { publishedAt?: { gte: Date }; deletedAt?: null };
          }) => {
            return pages.filter((page) => {
              if (where?.deletedAt === null && page.deletedAt !== null)
                return false;
              if (where?.publishedAt?.gte) {
                return (
                  page.publishedAt != null &&
                  page.publishedAt >= where.publishedAt.gte
                );
              }
              return true;
            }).length;
          },
        ),
        findMany: vi.fn(async () => pages.filter((p) => p.deletedAt === null)),
      },
    };

    const service = new PageService(database as never);
    await expect(service.countOverview()).resolves.toEqual({
      total: 3,
      publishedThisWeek: 1,
    });
  });
});
