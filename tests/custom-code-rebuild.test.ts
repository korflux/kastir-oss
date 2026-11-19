import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { rebuildPublishedPage } from "@/lib/Publishing/rebuild";

describe("published page rebuild", () => {
  it("compiles only published snippets matching the page scope", async () => {
    const write = vi.fn(async () => undefined);
    const database = {
      page: {
        findUnique: vi.fn(async () => ({
          id: "page-1",
          title: "Landing",
          slug: "landing",
          content:
            "<!doctype html><html><head></head><body><main>Page</main></body></html>",
          seoTitle: null,
          seoDescription: null,
          seoKeyword: null,
          status: "PUBLISHED" as const,
          folderId: "folder-1",
          authorId: "user-1",
          publishedRevisionId: "page-1-rev",
          publishedRevision: {
            id: "page-1-rev",
            pageId: "page-1",
            title: "Landing",
            slug: "landing",
            content:
              "<!doctype html><html><head></head><body><main>Page</main></body></html>",
            seoTitle: null,
            seoDescription: null,
            seoKeyword: null,
          },
          publishedAt: new Date(),
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      snippet: {
        findMany: vi.fn(async () => [
          {
            id: "snippet-1",
            status: "PUBLISHED" as const,
            deletedAt: null,
            publishedRevisionId: "snippet-1-rev",
            publishedRevision: {
              id: "snippet-1-rev",
              snippetId: "snippet-1",
              name: "Tracker",
              location: "HEADER" as const,
              content: "<script>window.tracker = true;</script>",
              priority: 1,
              scopeType: "ALL_PAGES" as const,
              pageIds: [],
              triggerType: null,
              triggerConfig: null,
              maxDisplays: null,
              displayResetDays: null,
              createdAt: new Date("2026-01-01"),
            },
          },
        ]),
      },
    };

    await rebuildPublishedPage("page-1", {
      database,
      fileStore: { read: vi.fn(), write, remove: vi.fn() },
    });

    expect(database.snippet.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: "PUBLISHED",
        publishedRevisionId: { not: null },
      }),
      include: { publishedRevision: true },
    });
    expect(write).toHaveBeenCalledWith(
      "landing",
      expect.stringContaining(
        '<head><meta charset="UTF-8"><script>window.tracker = true;</script>\n</head>',
      ),
    );
    expect(write).toHaveBeenCalledWith(
      "landing",
      expect.stringContaining('data-kastir-admin-bar="1"'),
    );
  });

  it("does not write a file for a draft or deleted page", async () => {
    const write = vi.fn(async () => undefined);
    const database = {
      page: {
        findUnique: vi.fn(async () => ({
          id: "page-1",
          slug: "landing",
          content: "<main>Page</main>",
          status: "DRAFT",
          deletedAt: null,
        })),
      },
      snippet: { findMany: vi.fn() },
    };

    await rebuildPublishedPage("page-1", {
      database: database as never,
      fileStore: { read: vi.fn(), write, remove: vi.fn() },
    });

    expect(write).not.toHaveBeenCalled();
    expect(database.snippet.findMany).not.toHaveBeenCalled();
  });
});
