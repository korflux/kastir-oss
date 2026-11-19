import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { expireRevisionHistory } from "@/lib/Jobs/expireRevisionHistory";
import { SYSTEM_REVISION_RETENTION_ACTOR_ID } from "@/lib/SideEffects/Types";

function revision(id: string, createdAt: string, pinned = false) {
  return { id, createdAt: new Date(createdAt), pinned };
}

function createRetentionDatabase(input: {
  limit: number;
  pages: Array<{
    id: string;
    title: string;
    publishedRevisionId: string | null;
    revisions: Array<{ id: string; createdAt: Date; pinned: boolean }>;
  }>;
  snippets?: Array<{
    id: string;
    name: string;
    publishedRevisionId: string | null;
    revisions: Array<{ id: string; createdAt: Date; pinned: boolean }>;
  }>;
}) {
  const pageRevisions = input.pages.flatMap((page) =>
    page.revisions.map((row) => ({ ...row, pageId: page.id })),
  );
  const snippetRevisions = (input.snippets ?? []).flatMap((snippet) =>
    snippet.revisions.map((row) => ({ ...row, snippetId: snippet.id })),
  );
  const deleted: string[] = [];
  const database = {
    siteSettings: {
      findUnique: vi.fn(async () => ({
        revisionRetentionLimit: input.limit,
      })),
    },
    page: {
      findMany: vi.fn(async (args: { skip?: number; take?: number } = {}) => {
        const rows = input.pages
          .map((page) => ({
            id: page.id,
            title: page.title,
            publishedRevisionId: page.publishedRevisionId,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        const skip = args?.skip ?? 0;
        return rows.slice(
          skip,
          args?.take === undefined ? undefined : skip + args.take,
        );
      }),
    },
    snippet: {
      findMany: vi.fn(async (args: { skip?: number; take?: number } = {}) => {
        const rows = (input.snippets ?? [])
          .map((snippet) => ({
            id: snippet.id,
            name: snippet.name,
            publishedRevisionId: snippet.publishedRevisionId,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        const skip = args?.skip ?? 0;
        return rows.slice(
          skip,
          args?.take === undefined ? undefined : skip + args.take,
        );
      }),
    },
    pageRevision: {
      findMany: vi.fn(async ({ where }: { where: { pageId: string } }) =>
        pageRevisions.filter((row) => row.pageId === where.pageId),
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => {
          deleted.push(...where.id.in);
          return { count: where.id.in.length };
        },
      ),
    },
    snippetRevision: {
      findMany: vi.fn(async ({ where }: { where: { snippetId: string } }) =>
        snippetRevisions.filter((row) => row.snippetId === where.snippetId),
      ),
      deleteMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => {
          deleted.push(...where.id.in);
          return { count: where.id.in.length };
        },
      ),
    },
    logEntry: { create: vi.fn(async () => ({ id: "log" })) },
  };
  return { database, deleted };
}

describe("expireRevisionHistory", () => {
  it("reads the live Settings limit and keeps live plus pinned revisions", async () => {
    const { database, deleted } = createRetentionDatabase({
      limit: 5,
      pages: [
        {
          id: "page-1",
          title: "Home",
          publishedRevisionId: "live",
          revisions: [
            revision("new-1", "2026-08-12"),
            revision("new-2", "2026-08-11"),
            revision("new-3", "2026-08-10"),
            revision("new-4", "2026-08-09"),
            revision("new-5", "2026-08-08"),
            revision("old-pinned", "2026-01-01", true),
            revision("live", "2025-12-01"),
            revision("old-drop", "2025-01-01"),
          ],
        },
      ],
    });

    const result = await expireRevisionHistory(database);

    expect(result.removed).toBe(1);
    expect(deleted).toEqual(["old-drop"]);
    expect(database.logEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: SYSTEM_REVISION_RETENTION_ACTOR_ID,
          action: "PAGE_REVISION_PURGED",
          objectId: "page-1",
          objectLabel: "Home",
        }),
      }),
    );
    const payload = JSON.stringify(database.logEntry.create.mock.calls[0]);
    expect(payload).not.toContain("<h1>");
    expect(payload).not.toContain("token");
  });

  it("applies a reduced limit only on the next job run", async () => {
    const pages = [
      {
        id: "page-1",
        title: "Home",
        publishedRevisionId: "rev-1",
        revisions: Array.from({ length: 8 }, (_, index) =>
          revision(
            `rev-${index + 1}`,
            `2026-08-${String(13 - index).padStart(2, "0")}`,
          ),
        ),
      },
    ];
    const first = createRetentionDatabase({ limit: 30, pages });
    await expireRevisionHistory(first.database);
    expect(first.deleted).toEqual([]);

    const second = createRetentionDatabase({ limit: 5, pages });
    await expireRevisionHistory(second.database);
    expect(second.deleted).toHaveLength(3);
    expect(second.deleted).not.toContain("rev-1");
  });

  it("pages through pages and snippets instead of loading the whole table", async () => {
    const extra = (prefix: string) => [
      revision(`${prefix}-live`, "2026-08-12"),
      revision(`${prefix}-2`, "2026-08-11"),
      revision(`${prefix}-3`, "2026-08-10"),
      revision(`${prefix}-4`, "2026-08-09"),
      revision(`${prefix}-5`, "2026-08-08"),
      revision(`${prefix}-old`, "2025-01-01"),
    ];
    const { database, deleted } = createRetentionDatabase({
      limit: 5,
      pages: [
        {
          id: "page-a",
          title: "A",
          publishedRevisionId: "a-live",
          revisions: extra("a"),
        },
        {
          id: "page-b",
          title: "B",
          publishedRevisionId: "b-live",
          revisions: extra("b"),
        },
      ],
      snippets: [
        {
          id: "snippet-a",
          name: "A",
          publishedRevisionId: "s-live",
          revisions: extra("s"),
        },
      ],
    });

    const result = await expireRevisionHistory(database, { batchSize: 1 });

    expect(result.removed).toBe(3);
    expect(deleted.sort()).toEqual(["a-old", "b-old", "s-old"]);
    expect(database.page.findMany).toHaveBeenCalledTimes(3);
    expect(database.snippet.findMany).toHaveBeenCalledTimes(2);
    expect(database.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
        select: { id: true, title: true, publishedRevisionId: true },
      }),
    );
  });
});
