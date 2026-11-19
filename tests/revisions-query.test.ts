import { describe, expect, it, vi } from "vitest";

import {
  RevisionService,
  type RevisionDatabase,
} from "@/lib/Modules/Revisions/Service";
import { RevisionsDomainError } from "@/lib/Modules/Revisions/Types";
import { pageSnapshotFingerprint } from "@/lib/Modules/Revisions/snapshot";
import type {
  PageSnapshot,
  SnippetRevisionRecord,
} from "@/lib/Modules/Revisions/Types";

const snapshot: PageSnapshot = {
  title: "About",
  slug: "about",
  content: "<p>About</p>",
  seoTitle: null,
  seoDescription: null,
  seoKeyword: null,
  folderId: "base",
};

type StoredPageRevision = {
  id: string;
  pageId: string;
  authorId: string;
  fingerprint: string;
  pinned: boolean;
  createdAt: Date;
} & PageSnapshot;

type SnippetRevisionStore = RevisionDatabase["snippetRevision"];

function createQueryDatabase(initial: StoredPageRevision[] = []) {
  const rows = [...initial];
  const database = {
    pageRevision: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { pageId?: string; fingerprint?: string };
        }) =>
          rows.find(
            (row) =>
              (!where.pageId || row.pageId === where.pageId) &&
              (!where.fingerprint || row.fingerprint === where.fingerprint),
          ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async ({
          where,
          skip = 0,
          take,
        }: {
          where: { pageId: string };
          skip?: number;
          take?: number;
        }) => {
          const filtered = rows
            .filter((row) => row.pageId === where.pageId)
            .sort(
              (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime(),
            );
          return filtered.slice(
            skip,
            take === undefined ? undefined : skip + take,
          );
        },
      ),
      count: vi.fn(
        async ({ where }: { where: { pageId: string } }) =>
          rows.filter((row) => row.pageId === where.pageId).length,
      ),
      create: vi.fn(),
    },
    // Tipado pelo contrato do Service: cada teste de script troca só o
    // comportamento (mockImplementation), nunca a assinatura do mock.
    snippetRevision: {
      findFirst: vi.fn<SnippetRevisionStore["findFirst"]>(async () => null),
      findUnique: vi.fn<SnippetRevisionStore["findUnique"]>(async () => null),
      findMany: vi.fn<NonNullable<SnippetRevisionStore["findMany"]>>(
        async () => [],
      ),
      count: vi.fn<NonNullable<SnippetRevisionStore["count"]>>(async () => 0),
      create: vi.fn<SnippetRevisionStore["create"]>(),
    },
  };
  return { database, rows };
}

function revision(
  id: string,
  pageId: string,
  createdAt: string,
  content = snapshot.content,
): StoredPageRevision {
  const body = { ...snapshot, content };
  return {
    id,
    pageId,
    authorId: "user-1",
    fingerprint: pageSnapshotFingerprint(body),
    pinned: id === "rev-pin",
    createdAt: new Date(createdAt),
    ...body,
  };
}

describe("RevisionService list/get/diff", () => {
  it("lists revisions for one page with pagination and published/draft flags", async () => {
    const { database } = createQueryDatabase([
      revision("rev-1", "page-a", "2026-08-01T00:00:00.000Z"),
      revision("rev-2", "page-a", "2026-08-02T00:00:00.000Z"),
      revision("rev-other", "page-b", "2026-08-03T00:00:00.000Z"),
    ]);
    const service = new RevisionService(database);

    const listed = await service.listPageRevisions({
      pageId: "page-a",
      publishedRevisionId: "rev-1",
      page: 1,
      pageSize: 1,
    });

    expect(listed.total).toBe(2);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      id: "rev-2",
      pageId: "page-a",
      authorId: "user-1",
      published: false,
      fingerprint: pageSnapshotFingerprint(snapshot),
    });
    expect(listed.page).toBe(1);
    expect(listed.pageSize).toBe(1);
  });

  it("rejects a pageSize above the allowed limit", async () => {
    const { database } = createQueryDatabase();
    const service = new RevisionService(database);

    await expect(
      service.listPageRevisions({
        pageId: "page-a",
        publishedRevisionId: null,
        page: 1,
        pageSize: 51,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a revision id that belongs to another page", async () => {
    const { database } = createQueryDatabase([
      revision("rev-1", "page-a", "2026-08-01T00:00:00.000Z"),
    ]);
    const service = new RevisionService(database);

    await expect(
      service.getPageRevisionForPage("rev-1", "page-b"),
    ).rejects.toBeInstanceOf(RevisionsDomainError);
  });

  it("diffs a revision against the current draft without leaking the other page", async () => {
    const { database } = createQueryDatabase([
      revision("rev-1", "page-a", "2026-08-01T00:00:00.000Z", "<p>Old</p>"),
      revision("rev-x", "page-b", "2026-08-01T00:00:00.000Z", "<p>Secret</p>"),
    ]);
    const service = new RevisionService(database);

    const diff = await service.diffPageRevision({
      pageId: "page-a",
      fromRevisionId: "rev-1",
      to: { kind: "draft", snapshot },
    });

    expect(diff.lines.some((line) => line.text.includes("Secret"))).toBe(false);
    expect(
      diff.lines.every((line) => ["+", "-", " "].includes(line.marker)),
    ).toBe(true);
    expect(diff.lines.some((line) => line.kind === "removed")).toBe(true);
    expect(diff.lines.some((line) => line.kind === "added")).toBe(true);

    await expect(
      service.diffPageRevision({
        pageId: "page-a",
        fromRevisionId: "rev-x",
        to: { kind: "draft", snapshot },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists and diffs snippet revisions scoped to the same script", async () => {
    const snippetRows: SnippetRevisionRecord[] = [
      {
        id: "srev-1",
        snippetId: "snip-a",
        authorId: "user-1",
        fingerprint: "a",
        pinned: false,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        name: "Tracker",
        location: "HEADER",
        content: "<script>old</script>",
        priority: null,
        scopeType: "ALL_PAGES",
        pageIds: [],
        triggerType: null,
        triggerConfig: null,
        maxDisplays: null,
        displayResetDays: null,
      },
    ];
    const { database } = createQueryDatabase();
    database.snippetRevision.findUnique.mockImplementation(
      async ({ where }) =>
        snippetRows.find((row) => row.id === where.id) ?? null,
    );
    database.snippetRevision.findMany.mockResolvedValue(snippetRows);
    database.snippetRevision.count.mockResolvedValue(snippetRows.length);
    const service = new RevisionService(database);

    const listed = await service.listSnippetRevisions({
      snippetId: "snip-a",
      publishedRevisionId: "srev-1",
      page: 1,
      pageSize: 20,
    });
    expect(listed.items[0]).toMatchObject({
      id: "srev-1",
      published: true,
      fingerprint: "a",
    });

    const diff = await service.diffSnippetRevision({
      snippetId: "snip-a",
      fromRevisionId: "srev-1",
      to: {
        kind: "draft",
        snapshot: {
          name: "Tracker",
          location: "HEADER",
          content: "<script>new</script>",
          priority: null,
          scopeType: "ALL_PAGES",
          pageIds: [],
          triggerType: null,
          triggerConfig: null,
          maxDisplays: null,
          displayResetDays: null,
        },
      },
    });
    expect(diff.lines.some((line) => line.kind === "added")).toBe(true);

    await expect(
      service.diffSnippetRevision({
        snippetId: "snip-b",
        fromRevisionId: "srev-1",
        to: { kind: "revision", revisionId: "srev-1" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
