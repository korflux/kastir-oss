import { describe, expect, it, vi } from "vitest";

import { REVISION_PIN_MAX } from "@/lib/Modules/Settings/revisionRetention";
import {
  RevisionService,
  type RevisionDatabase,
} from "@/lib/Modules/Revisions/Service";
import { RevisionsDomainError } from "@/lib/Modules/Revisions/Types";
import {
  pageSnapshotFingerprint,
  selectRevisionsToPurge,
} from "@/lib/Modules/Revisions/snapshot";
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

function revision(
  id: string,
  pageId: string,
  overrides: Partial<StoredPageRevision> = {},
): StoredPageRevision {
  const body = { ...snapshot, ...overrides };
  return {
    id,
    pageId,
    authorId: "user-1",
    fingerprint: pageSnapshotFingerprint(body),
    pinned: false,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...body,
  };
}

function createPinDatabase(initial: StoredPageRevision[] = []) {
  const rows = [...initial];
  const pageRevision = {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(
      async ({ where }: { where: { id: string } }) =>
        rows.find((row) => row.id === where.id) ?? null,
    ),
    findMany: vi.fn(),
    count: vi.fn(
      async ({ where }: { where: { pageId: string; pinned?: boolean } }) => {
        // Yield so two overlapping pins can both read the same count.
        await Promise.resolve();
        return rows.filter(
          (row) =>
            row.pageId === where.pageId &&
            (where.pinned === undefined || row.pinned === where.pinned),
        ).length;
      },
    ),
    create: vi.fn(),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { pinned: boolean };
      }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error("missing revision");
        row.pinned = data.pinned;
        return row;
      },
    ),
  };
  const snippetRevision = {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    count: vi.fn(async () => 0),
    create: vi.fn(),
    update: vi.fn(),
  };
  let lock = Promise.resolve();
  // Tipado pelo contrato do Service. O `$transaction` é método genérico real
  // (vi.fn apaga o genérico `<T>` e quebraria o contrato); o spy abaixo o
  // observa sem trocar a assinatura.
  const database: RevisionDatabase = {
    pageRevision,
    snippetRevision,
    async $transaction(callback) {
      const previous = lock;
      let release!: () => void;
      lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback(database);
      } finally {
        release();
      }
    },
  };
  const transaction = vi.spyOn(database, "$transaction");
  return { database, rows, transaction };
}

describe("RevisionService pin/unpin", () => {
  it("pins up to three revisions and rejects the fourth", async () => {
    const { database, rows } = createPinDatabase([
      revision("rev-1", "page-a"),
      revision("rev-2", "page-a"),
      revision("rev-3", "page-a"),
      revision("rev-4", "page-a"),
    ]);
    const service = new RevisionService(database);

    await service.setPageRevisionPinned({
      pageId: "page-a",
      revisionId: "rev-1",
      pinned: true,
    });
    await service.setPageRevisionPinned({
      pageId: "page-a",
      revisionId: "rev-2",
      pinned: true,
    });
    await service.setPageRevisionPinned({
      pageId: "page-a",
      revisionId: "rev-3",
      pinned: true,
    });

    expect(rows.filter((row) => row.pinned)).toHaveLength(REVISION_PIN_MAX);
    await expect(
      service.setPageRevisionPinned({
        pageId: "page-a",
        revisionId: "rev-4",
        pinned: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(rows.find((row) => row.id === "rev-4")?.pinned).toBe(false);
  });

  it("unpins a revision and rejects a pin from another page as not found", async () => {
    const { database, rows } = createPinDatabase([
      revision("rev-1", "page-a", { pinned: true }),
      revision("rev-2", "page-b"),
    ]);
    rows[0]!.pinned = true;
    const service = new RevisionService(database);

    const unpinned = await service.setPageRevisionPinned({
      pageId: "page-a",
      revisionId: "rev-1",
      pinned: false,
    });
    expect(unpinned.pinned).toBe(false);

    await expect(
      service.setPageRevisionPinned({
        pageId: "page-a",
        revisionId: "rev-2",
        pinned: true,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      name: RevisionsDomainError.name,
    });
    expect(database.pageRevision.update).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping pins so a fourth revision never sticks", async () => {
    const { database, rows, transaction } = createPinDatabase([
      revision("rev-1", "page-a", { pinned: true }),
      revision("rev-2", "page-a", { pinned: true }),
      revision("rev-3", "page-a"),
      revision("rev-4", "page-a"),
    ]);
    rows[0]!.pinned = true;
    rows[1]!.pinned = true;
    const service = new RevisionService(database);

    const results = await Promise.allSettled([
      service.setPageRevisionPinned({
        pageId: "page-a",
        revisionId: "rev-3",
        pinned: true,
      }),
      service.setPageRevisionPinned({
        pageId: "page-a",
        revisionId: "rev-4",
        pinned: true,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(rows.filter((row) => row.pinned)).toHaveLength(REVISION_PIN_MAX);
    expect(transaction).toHaveBeenCalled();
  });

  it("keeps pinned revisions out of the future retention purge set", () => {
    const purged = selectRevisionsToPurge({
      publishedRevisionId: "live",
      normalLimit: 5,
      revisions: [
        { id: "live", createdAt: new Date("2026-01-01"), pinned: false },
        { id: "old-1", createdAt: new Date("2025-01-01"), pinned: true },
        { id: "old-2", createdAt: new Date("2025-02-01"), pinned: false },
        { id: "new-1", createdAt: new Date("2026-06-01"), pinned: false },
        { id: "new-2", createdAt: new Date("2026-07-01"), pinned: false },
        { id: "new-3", createdAt: new Date("2026-08-01"), pinned: false },
        { id: "new-4", createdAt: new Date("2026-08-10"), pinned: false },
        { id: "new-5", createdAt: new Date("2026-08-12"), pinned: false },
      ],
    });
    expect(purged).toContain("old-2");
    expect(purged).not.toContain("old-1");
    expect(purged).not.toContain("live");
  });
});
