import { describe, expect, it, vi } from "vitest";

import {
  RevisionService,
  type RevisionDatabase,
} from "@/lib/Modules/Revisions/Service";
import { RevisionsDomainError } from "@/lib/Modules/Revisions/Types";
import { pageSnapshotFingerprint } from "@/lib/Modules/Revisions/snapshot";
import type { PageSnapshot } from "@/lib/Modules/Revisions/Types";

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

function createRevisionDatabase(initial: StoredPageRevision[] = []) {
  const rows = [...initial];
  const database = {
    pageRevision: {
      findFirst: vi.fn(
        async ({ where }: { where: { pageId: string; fingerprint: string } }) =>
          rows.find(
            (row) =>
              row.pageId === where.pageId &&
              row.fingerprint === where.fingerprint,
          ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id) ?? null,
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<StoredPageRevision, "id" | "createdAt" | "pinned"> & {
            pinned?: boolean;
          };
        }) => {
          const row: StoredPageRevision = {
            id: `rev-${rows.length + 1}`,
            createdAt: new Date("2026-08-13T12:00:00.000Z"),
            pinned: false,
            ...data,
          };
          rows.push(row);
          return row;
        },
      ),
      update: vi.fn(async () => {
        throw new Error("revisions are immutable");
      }),
    },
    // O contrato exige o adaptador de scripts; estes testes só exercitam Pages.
    snippetRevision: {
      findFirst: vi.fn<SnippetRevisionStore["findFirst"]>(async () => null),
      findUnique: vi.fn<SnippetRevisionStore["findUnique"]>(async () => null),
      create: vi.fn<SnippetRevisionStore["create"]>(),
    },
  };
  return { database, rows };
}

describe("RevisionService persistPageSnapshot", () => {
  it("creates a full snapshot when none matches and reuses an identical one", async () => {
    const { database, rows } = createRevisionDatabase();
    const service = new RevisionService(database);

    const created = await service.persistPageSnapshot({
      pageId: "page-1",
      authorId: "user-1",
      snapshot,
    });
    const reused = await service.persistPageSnapshot({
      pageId: "page-1",
      authorId: "user-2",
      snapshot: { ...snapshot },
    });

    expect(created.reused).toBe(false);
    expect(created.revision.fingerprint).toBe(
      pageSnapshotFingerprint(snapshot),
    );
    expect(reused.reused).toBe(true);
    expect(reused.revision.id).toBe(created.revision.id);
    expect(rows).toHaveLength(1);
    expect(database.pageRevision.create).toHaveBeenCalledOnce();
    expect(database.pageRevision.update).not.toHaveBeenCalled();
  });

  it("rejects a revision that belongs to another page", async () => {
    const { database } = createRevisionDatabase([
      {
        id: "rev-1",
        pageId: "page-a",
        authorId: "user-1",
        fingerprint: pageSnapshotFingerprint(snapshot),
        pinned: false,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        ...snapshot,
      },
    ]);
    const service = new RevisionService(database);

    await expect(
      service.getPageRevisionForPage("rev-1", "page-b"),
    ).rejects.toBeInstanceOf(RevisionsDomainError);
    await expect(
      service.getPageRevisionForPage("rev-1", "page-b"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects control fields and oversized payload at the persist boundary", async () => {
    const { database } = createRevisionDatabase();
    const service = new RevisionService(database);

    await expect(
      service.persistPageSnapshot({
        pageId: "page-1",
        authorId: "user-1",
        snapshot: {
          ...snapshot,
          publishedRevisionId: "nope",
        } as never,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.persistPageSnapshot({
        pageId: "page-1",
        authorId: "user-1",
        snapshot: {
          ...snapshot,
          content: "x".repeat(2 * 1024 * 1024 + 1),
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(database.pageRevision.create).not.toHaveBeenCalled();
  });
});
