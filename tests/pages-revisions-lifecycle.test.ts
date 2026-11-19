import { describe, expect, it, vi } from "vitest";

import { assertPageExpectedUpdatedAt } from "@/lib/Modules/Pages/lifecycle";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { PageService } from "@/lib/Modules/Pages/Service";
import { MAX_PAGE_CONTENT_BYTES } from "@/lib/Modules/Pages/Schema";
import { PagesDomainError } from "@/lib/Modules/Pages/Types";
import { pageSnapshotFingerprint } from "@/lib/Modules/Revisions/snapshot";
import type { PageSnapshot } from "@/lib/Modules/Revisions/Types";
import { contentSha256 } from "@/lib/Modules/Shared/ContentPatch";

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
  publishedRevisionId: string | null;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type StoredRevision = PageSnapshot & {
  id: string;
  pageId: string;
  authorId: string;
  fingerprint: string;
  pinned: boolean;
  createdAt: Date;
};

function snapshotOf(page: StoredPage): PageSnapshot {
  return {
    title: page.title,
    slug: page.slug,
    content: page.content,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    seoKeyword: page.seoKeyword,
    folderId: page.folderId,
  };
}

function createLifecycleDatabase(
  overrides: Partial<StoredPage> = {},
  extraPages: StoredPage[] = [],
) {
  const now = new Date("2026-08-13T12:00:00.000Z");
  const page: StoredPage = {
    id: "page-1",
    title: "Landing",
    slug: "landing",
    content: "<h1>Draft</h1>",
    seoTitle: "SEO",
    seoDescription: null,
    seoKeyword: null,
    status: "DRAFT",
    folderId: "base-id",
    authorId: "master-id",
    publishedRevisionId: null,
    publishedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const pages: StoredPage[] = [page, ...extraPages];
  const revisions: StoredRevision[] = [];
  let nextRevision = 1;

  const database = {
    page: {
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) =>
          pages.find(
            (row) =>
              (!where.id || row.id === where.id) &&
              (!where.slug || row.slug === where.slug),
          ) ?? null,
      ),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where?: {
            id?: { not?: string };
            deletedAt?: null;
            publishedRevision?: { slug?: string };
          };
        }) =>
          pages.find((row) => {
            if (where?.id?.not && row.id === where.id.not) return false;
            if (where?.deletedAt === null && row.deletedAt !== null)
              return false;
            if (where?.publishedRevision?.slug) {
              const live = revisions.find(
                (revision) => revision.id === row.publishedRevisionId,
              );
              if (!live || live.slug !== where.publishedRevision.slug) {
                return false;
              }
            }
            return true;
          }) ?? null,
      ),
      findMany: vi.fn(async () =>
        pages.filter((row) => row.deletedAt === null),
      ),
      create: vi.fn(),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<StoredPage>;
        }) => {
          const row = pages.find((candidate) => candidate.id === where.id);
          if (!row) throw new Error("missing page");
          Object.assign(row, data, { updatedAt: now });
          return { ...row };
        },
      ),
      delete: vi.fn(),
    },
    pageFolder: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "base-id" ? { id: "base-id" } : null,
      ),
    },
    pageRevision: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { pageId?: string; fingerprint?: string; slug?: string };
        }) =>
          revisions.find(
            (row) =>
              (!where.pageId || row.pageId === where.pageId) &&
              (!where.fingerprint || row.fingerprint === where.fingerprint) &&
              (!where.slug || row.slug === where.slug),
          ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          revisions.find((row) => row.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async ({
          where = {},
        }: {
          where?: { pageId?: string; slug?: string };
        } = {}) =>
          revisions.filter(
            (row) =>
              (!where.pageId || row.pageId === where.pageId) &&
              (!where.slug || row.slug === where.slug),
          ),
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: PageSnapshot & {
            pageId: string;
            authorId: string;
            fingerprint: string;
          };
        }) => {
          const row: StoredRevision = {
            id: `rev-${nextRevision++}`,
            pinned: false,
            createdAt: now,
            ...data,
          };
          revisions.push(row);
          return row;
        },
      ),
      count: vi.fn(
        async ({ where }: { where: { pageId?: string; pinned?: boolean } }) =>
          revisions.filter(
            (row) =>
              (!where.pageId || row.pageId === where.pageId) &&
              (where.pinned === undefined || row.pinned === where.pinned),
          ).length,
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { pinned: boolean };
        }) => {
          const row = revisions.find((candidate) => candidate.id === where.id);
          if (!row) throw new Error("missing revision");
          row.pinned = data.pinned;
          return row;
        },
      ),
    },
    logEntry: { create: vi.fn(async () => ({ id: "log-id" })) },
    // Trava de linha do Save (`lockRowForUpdate`); o banco falso não trava.
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };

  return { database, pages, page, revisions };
}

function createService(
  database: ReturnType<typeof createLifecycleDatabase>["database"],
  fileStore?: {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  },
  compiler?: (page: { content: string }) => Promise<string>,
) {
  const store = fileStore ?? {
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  const service = new PageService(
    database as never,
    store as never,
    compiler ?? (async (page) => `compiled:${page.content}`),
  );
  return { service, store };
}

describe("page lifecycle guards", () => {
  it("rejects a stale expectedUpdatedAt and accepts a matching one", () => {
    expect(() =>
      assertPageExpectedUpdatedAt(
        new Date("2026-08-13T12:00:00.000Z"),
        new Date("2026-08-13T16:00:00.000Z"),
      ),
    ).toThrow(PagesDomainError);
    expect(() =>
      assertPageExpectedUpdatedAt(
        new Date("2026-08-13T12:00:00.000Z"),
        new Date("2026-08-13T12:00:00.000Z"),
      ),
    ).not.toThrow();
  });
});

describe("PageService Save draft-only", () => {
  it("updates the draft without creating a revision", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const { service, store } = createService(database);

    const changed = await service.updatePage("master-id", {
      id: "page-1",
      content: "<h1>Changed</h1>",
    });

    expect(page.content).toBe("<h1>Changed</h1>");
    expect(revisions).toHaveLength(0);
    expect(database.pageRevision.create).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(changed.hasUnpublishedChanges).toBe(true);
    expect(changed.activated).toBe(false);
    expect(changed.published).toBeNull();
  });

  it("returns success without a new revision when Save is a no-op", async () => {
    const { database, revisions } = createLifecycleDatabase();
    const { service, store } = createService(database);

    const result = await service.updatePage("master-id", {
      id: "page-1",
      title: "Landing",
      content: "<h1>Draft</h1>",
    });

    expect(revisions).toHaveLength(0);
    expect(database.page.update).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(result.hasUnpublishedChanges).toBe(true);
  });

  it("does not create a revision on Save even when a snapshot already exists", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const { service } = createService(database);
    const previous = snapshotOf(page);
    revisions.push({
      id: "rev-existing",
      pageId: "page-1",
      authorId: "editor-id",
      fingerprint: pageSnapshotFingerprint(previous),
      pinned: false,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      ...previous,
    });

    await service.updatePage("master-id", {
      id: "page-1",
      content: "<h1>Changed</h1>",
    });

    expect(revisions).toHaveLength(1);
    expect(database.pageRevision.create).not.toHaveBeenCalled();
  });

  it("rejects a draft slug that collides with another page's live published slug", async () => {
    const other: StoredPage = {
      id: "page-2",
      title: "Other",
      slug: "other-draft",
      content: "<p>Other</p>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      status: "PUBLISHED",
      folderId: "base-id",
      authorId: "master-id",
      publishedRevisionId: "rev-live-other",
      publishedAt: new Date("2026-08-01T00:00:00.000Z"),
      deletedAt: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const { database, revisions } = createLifecycleDatabase({}, [other]);
    revisions.push({
      id: "rev-live-other",
      pageId: "page-2",
      authorId: "master-id",
      fingerprint: "other",
      pinned: false,
      createdAt: other.createdAt,
      title: "Other",
      slug: "reserved-live",
      content: "<p>Live</p>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      folderId: "base-id",
    });
    const { service } = createService(database);

    await expect(
      service.updatePage("master-id", {
        id: "page-1",
        slug: "reserved-live",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(database.page.update).not.toHaveBeenCalled();
  });

  it("rejects a concurrent Save without overwriting the newer draft", async () => {
    const { database, page } = createLifecycleDatabase({
      updatedAt: new Date("2026-08-13T15:00:00.000Z"),
    });
    const { service } = createService(database);

    await expect(
      service.updatePage("master-id", {
        id: "page-1",
        expectedUpdatedAt: new Date("2026-08-13T12:00:00.000Z"),
        content: "<h1>Stale</h1>",
      }),
    ).rejects.toBeInstanceOf(PagesDomainError);
    await expect(
      service.updatePage("master-id", {
        id: "page-1",
        expectedUpdatedAt: new Date("2026-08-13T12:00:00.000Z"),
        content: "<h1>Stale</h1>",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(page.content).toBe("<h1>Draft</h1>");
  });
});

describe("PageService Save lock and version guard", () => {
  const draft = "<h1>Draft</h1>";

  it("locks the page row before reading it, binding the id as a parameter", async () => {
    const { database } = createLifecycleDatabase();
    const { service } = createService(database);

    await service.updatePage("master-id", {
      id: "page-1",
      content: "<h1>Changed</h1>",
    });

    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = database.$queryRaw.mock
      .calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const text = strings.join("$");
    expect(text).toContain('FROM "Page"');
    expect(text).toContain("FOR UPDATE");
    expect(values).toEqual(["page-1"]);
    // A leitura que decide o conflito só pode vir depois da trava.
    expect(database.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      database.page.findUnique.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the no-op inside the locked transaction without writing or auditing", async () => {
    const { database } = createLifecycleDatabase();
    const { service } = createService(database);

    await service.updatePage("master-id", { id: "page-1", content: draft });

    expect(database.$queryRaw).toHaveBeenCalledTimes(1);
    expect(database.page.update).not.toHaveBeenCalled();
    expect(database.logEntry.create).not.toHaveBeenCalled();
  });

  it("accepts the expected hash in any case even when expectedUpdatedAt is stale", async () => {
    // Publicar, ativar e desativar mudam o updatedAt sem mudar o conteúdo.
    const { database, page } = createLifecycleDatabase();
    const { service } = createService(database);

    await service.updatePage("master-id", {
      id: "page-1",
      expectedContentSha256: contentSha256(draft).toUpperCase(),
      expectedUpdatedAt: new Date("2026-08-13T10:00:00.000Z"),
      content: "<h1>Changed</h1>",
    });

    expect(page.content).toBe("<h1>Changed</h1>");
  });

  it("rejects a stale expected hash with the current hash and writes nothing", async () => {
    const { database, page } = createLifecycleDatabase();
    const { service } = createService(database);

    await expect(
      service.updatePage("master-id", {
        id: "page-1",
        expectedContentSha256: contentSha256("<h1>Older</h1>"),
        content: "<h1>Stale</h1>",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(contentSha256(draft)),
    });
    expect(page.content).toBe(draft);
    expect(database.page.update).not.toHaveBeenCalled();
    expect(database.logEntry.create).not.toHaveBeenCalled();
  });

  it("does not lock or write when the Save input is invalid", async () => {
    const { database } = createLifecycleDatabase();
    const { service } = createService(database);

    await expect(
      service.updatePage("master-id", {
        id: "page-1",
        expectedContentSha256: "not-a-hash",
        content: "<h1>Changed</h1>",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});

describe("PageService patchPageContent", () => {
  const paletteDraft = "fill:#111;fill:#222";

  it("A1: replaces the matched text, audits as an update and keeps the fingerprint formula", async () => {
    const { database, page, revisions } = createLifecycleDatabase({
      content: paletteDraft,
    });
    const { service, store } = createService(database);

    const patched = await service.patchPageContent(
      "master-id",
      {
        id: "page-1",
        expectedContentSha256: contentSha256(paletteDraft),
        operations: [{ old: "#111", new: "#0A0" }],
      },
      { source: "MCP", tool: "kastir_pages_patch" },
    );

    expect(page.content).toBe("fill:#0A0;fill:#222");
    expect(patched.content).toBe("fill:#0A0;fill:#222");
    // A18: o fingerprint segue a fórmula do snapshot (título, slug, conteúdo,
    // SEO e pasta), não o hash do conteúdo.
    expect(patched.draftFingerprint).toBe(
      pageSnapshotFingerprint(snapshotOf(page)),
    );
    expect(revisions).toHaveLength(0);
    expect(store.write).not.toHaveBeenCalled();
    expect(database.logEntry.create).toHaveBeenCalledTimes(1);
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PAGE_UPDATED",
        objectId: "page-1",
        source: "MCP",
        tool: "kastir_pages_patch",
      }),
    });
  });

  it("A2: an operation without exactly one match gives VALIDATION_ERROR with the index and count, and nothing is written or audited", async () => {
    const { database, page, revisions } = createLifecycleDatabase({
      content: "AB",
    });
    const updatedAt = page.updatedAt;
    const { service } = createService(database);

    await expect(
      service.patchPageContent("master-id", {
        id: "page-1",
        expectedContentSha256: contentSha256("AB"),
        operations: [
          { old: "A", new: "X" },
          { old: "Z", new: "Y" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringMatching(/Operation 1.*0 times/),
    });

    expect(page.content).toBe("AB");
    expect(page.updatedAt).toBe(updatedAt);
    expect(revisions).toHaveLength(0);
    expect(database.page.update).not.toHaveBeenCalled();
    expect(database.logEntry.create).not.toHaveBeenCalled();
  });

  it("A2: a result identical to the current content ends without writing or auditing", async () => {
    const { database, page } = createLifecycleDatabase({ content: "AB" });
    const updatedAt = page.updatedAt;
    const { service } = createService(database);

    const result = await service.patchPageContent("master-id", {
      id: "page-1",
      expectedContentSha256: contentSha256("AB"),
      operations: [{ old: "A", new: "A" }],
    });

    expect(result.content).toBe("AB");
    expect(page.updatedAt).toBe(updatedAt);
    expect(database.page.update).not.toHaveBeenCalled();
    expect(database.logEntry.create).not.toHaveBeenCalled();
  });

  it("A10: a result above the page byte limit gives VALIDATION_ERROR citing the limit and writes nothing", async () => {
    // Exatamente no limite: um byte a mais no resultado já estoura.
    const atLimit = `<!--X-->${"a".repeat(MAX_PAGE_CONTENT_BYTES - 8)}`;
    const { database, page } = createLifecycleDatabase({ content: atLimit });
    const { service } = createService(database);

    await expect(
      service.patchPageContent("master-id", {
        id: "page-1",
        expectedContentSha256: contentSha256(atLimit),
        operations: [{ old: "<!--X-->", new: "<!--XY-->" }],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining(String(MAX_PAGE_CONTENT_BYTES)),
    });
    expect(page.content).toBe(atLimit);
    expect(database.page.update).not.toHaveBeenCalled();

    // Mesmo tamanho (no limite) passa: o limite é inclusivo.
    await service.patchPageContent("master-id", {
      id: "page-1",
      expectedContentSha256: contentSha256(atLimit),
      operations: [{ old: "<!--X-->", new: "<!--Y-->" }],
    });
    expect(page.content.startsWith("<!--Y-->")).toBe(true);
  });

  it("A5: a stale hash gives CONFLICT with the current hash and nothing is written", async () => {
    const { database, page } = createLifecycleDatabase({ content: "second" });
    const { service } = createService(database);

    await expect(
      service.patchPageContent("master-id", {
        id: "page-1",
        expectedContentSha256: contentSha256("first"),
        operations: [{ old: "second", new: "third" }],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(contentSha256("second")),
    });
    expect(page.content).toBe("second");
    expect(database.page.update).not.toHaveBeenCalled();
    expect(database.logEntry.create).not.toHaveBeenCalled();
  });

  it("refuses a missing or trashed page before checking the hash", async () => {
    const { database } = createLifecycleDatabase({
      deletedAt: new Date("2026-08-13T11:00:00.000Z"),
    });
    const { service } = createService(database);

    await expect(
      service.patchPageContent("master-id", {
        id: "page-1",
        expectedContentSha256: contentSha256(""),
        operations: [{ old: "a", new: "b" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.patchPageContent("master-id", {
        id: "missing",
        expectedContentSha256: contentSha256(""),
        operations: [{ old: "a", new: "b" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("locks the row and patches against the content read after the lock", async () => {
    // A transação concorrente grava entre o início do request e a trava: o
    // patch tem de operar sobre o conteúdo já confirmado, nunca sobre um antigo.
    const { database, page } = createLifecycleDatabase({ content: "one" });
    const { service } = createService(database);
    database.$queryRaw.mockImplementationOnce(async () => {
      page.content = "one two";
      return [];
    });

    await expect(
      service.patchPageContent("master-id", {
        id: "page-1",
        expectedContentSha256: contentSha256("one"),
        operations: [{ old: "one", new: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(contentSha256("one two")),
    });
    expect(page.content).toBe("one two");
  });
});

describe("PageService Publish and Ativado/Desativado", () => {
  it("publishes the first draft by materializing a revision and writing only then", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const { service, store } = createService(database);

    const published = await service.publishPage("master-id", "page-1");

    expect(revisions).toHaveLength(1);
    expect(page).toMatchObject({
      status: "PUBLISHED",
      publishedRevisionId: revisions[0]!.id,
    });
    expect(store.write).toHaveBeenCalledWith(
      "landing",
      "compiled:<h1>Draft</h1>",
    );
    expect(published.activated).toBe(true);
    expect(published.hasUnpublishedChanges).toBe(false);
    expect(published.published).toMatchObject({ content: "<h1>Draft</h1>" });
    expect(published.activatedDuringPublish).toBe(false);
  });

  it("leaves the public file intact after Save and updates it only after Publish", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const files = new Map<string, string>();
    const store = {
      read: vi.fn(async (slug: string) => files.get(slug) ?? null),
      write: vi.fn(async (slug: string, html: string) => {
        files.set(slug, html);
      }),
      remove: vi.fn(async (slug: string) => {
        files.delete(slug);
      }),
    };
    const { service } = createService(database, store);

    await service.publishPage("master-id", "page-1");
    await service.updatePage("master-id", {
      id: "page-1",
      content: "<h1>Next</h1>",
    });

    expect(files.get("landing")).toBe("compiled:<h1>Draft</h1>");
    expect(page.content).toBe("<h1>Next</h1>");
    expect(revisions).toHaveLength(1);

    const republished = await service.publishPage("master-id", "page-1");

    expect(files.get("landing")).toBe("compiled:<h1>Next</h1>");
    expect(revisions).toHaveLength(2);
    expect(republished.hasUnpublishedChanges).toBe(false);
    expect(page.publishedRevisionId).toBe(revisions[1]!.id);
  });

  it("refuses Publish when the draft already matches the live revision", async () => {
    const { database, revisions } = createLifecycleDatabase();
    const { service, store } = createService(database);
    await service.publishPage("master-id", "page-1");
    store.write.mockClear();
    const count = revisions.length;

    await expect(
      service.publishPage("master-id", "page-1"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(revisions).toHaveLength(count);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("activates a deactivated page on Publish and signals the non-blocking toast", async () => {
    const { database, page } = createLifecycleDatabase();
    const { service } = createService(database);
    await service.publishPage("master-id", "page-1");
    await service.unpublishPage("master-id", "page-1");
    await service.updatePage("master-id", {
      id: "page-1",
      content: "<h1>After off</h1>",
    });

    const published = await service.publishPage("master-id", "page-1");

    expect(page.status).toBe("PUBLISHED");
    expect(published.activatedDuringPublish).toBe(true);
    expect(published.activated).toBe(true);
  });

  it("does not confirm pointer, status or file when compilation fails", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const store = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const { service } = createService(database, store, async () => {
      throw new Error("compile exploded");
    });

    await expect(service.publishPage("master-id", "page-1")).rejects.toThrow(
      "compile exploded",
    );
    expect(page.status).toBe("DRAFT");
    expect(page.publishedRevisionId).toBeNull();
    expect(revisions).toHaveLength(0);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("keeps publishedRevisionId when deactivating and recompiles only the pointer on activate", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const files = new Map<string, string>();
    const store = {
      read: vi.fn(async (slug: string) => files.get(slug) ?? null),
      write: vi.fn(async (slug: string, html: string) => {
        files.set(slug, html);
      }),
      remove: vi.fn(async (slug: string) => {
        files.delete(slug);
      }),
    };
    const { service } = createService(database, store);
    await service.publishPage("master-id", "page-1");
    const liveId = page.publishedRevisionId;
    await service.updatePage("master-id", {
      id: "page-1",
      content: "<h1>Dirty draft</h1>",
      slug: "draft-slug",
    });

    await service.unpublishPage("master-id", "page-1");

    expect(page.status).toBe("DRAFT");
    expect(page.publishedRevisionId).toBe(liveId);
    expect(files.has("landing")).toBe(false);
    expect(page.content).toBe("<h1>Dirty draft</h1>");

    await service.activatePage("master-id", "page-1");

    expect(page.status).toBe("PUBLISHED");
    expect(page.publishedRevisionId).toBe(liveId);
    expect(files.get("landing")).toBe("compiled:<h1>Draft</h1>");
    expect(files.has("draft-slug")).toBe(false);
    expect(revisions[0]!.content).toBe("<h1>Draft</h1>");
  });

  it("leaves the Ativado control inert when the page was never published", async () => {
    const { database } = createLifecycleDatabase();
    const { service, store } = createService(database);

    await expect(
      service.activatePage("master-id", "page-1"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      service.unpublishPage("master-id", "page-1"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(store.write).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("rejects activate when another publish moves the pointer before the tx", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const files = new Map<string, string>();
    const store = {
      read: vi.fn(async (slug: string) => files.get(slug) ?? null),
      write: vi.fn(async (slug: string, html: string) => {
        files.set(slug, html);
      }),
      remove: vi.fn(async (slug: string) => {
        files.delete(slug);
      }),
    };
    const { service } = createService(database, store);
    await service.publishPage("master-id", "page-1");
    const compiledPointer = page.publishedRevisionId;
    await service.unpublishPage("master-id", "page-1");

    const innerTransaction = database.$transaction.getMockImplementation()!;
    database.$transaction.mockImplementationOnce(async (callback) => {
      page.publishedRevisionId = "rev-from-concurrent-publish";
      revisions.push({
        id: "rev-from-concurrent-publish",
        pageId: "page-1",
        authorId: "other-id",
        fingerprint: "concurrent",
        pinned: false,
        createdAt: new Date("2026-08-13T13:00:00.000Z"),
        title: "Landing",
        slug: "landing",
        content: "<h1>Concurrent publish</h1>",
        seoTitle: "SEO",
        seoDescription: null,
        seoKeyword: null,
        folderId: "base-id",
      });
      return innerTransaction(callback);
    });

    await expect(
      service.activatePage("master-id", "page-1"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(page.status).toBe("DRAFT");
    expect(page.publishedRevisionId).toBe("rev-from-concurrent-publish");
    expect(files.has("landing")).toBe(false);
    expect(compiledPointer).toBeTruthy();
  });

  it("rejects unpublish when the pointer moved before the tx", async () => {
    const { database, page } = createLifecycleDatabase();
    const files = new Map<string, string>();
    const store = {
      read: vi.fn(async (slug: string) => files.get(slug) ?? null),
      write: vi.fn(async (slug: string, html: string) => {
        files.set(slug, html);
      }),
      remove: vi.fn(async (slug: string) => {
        files.delete(slug);
      }),
    };
    const { service } = createService(database, store);
    await service.publishPage("master-id", "page-1");
    const liveId = page.publishedRevisionId;

    const innerTransaction = database.$transaction.getMockImplementation()!;
    database.$transaction.mockImplementationOnce(async (callback) => {
      page.publishedRevisionId = "rev-from-concurrent-publish";
      return innerTransaction(callback);
    });

    await expect(
      service.unpublishPage("master-id", "page-1"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(page.status).toBe("PUBLISHED");
    expect(page.publishedRevisionId).toBe("rev-from-concurrent-publish");
    expect(files.get("landing")).toBe("compiled:<h1>Draft</h1>");
    expect(liveId).toBeTruthy();
  });
});

describe("PageService Restore and pin", () => {
  it("restores a published revision into the draft without creating another snapshot", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const { service, store } = createService(database);

    await service.publishPage("master-id", "page-1");
    const liveId = revisions[0]!.id;
    await service.updatePage("master-id", {
      id: "page-1",
      content: "<h1>Changed</h1>",
    });
    const expectedUpdatedAt = page.updatedAt;

    const restored = await service.restorePageRevision(
      "master-id",
      "page-1",
      liveId,
      expectedUpdatedAt,
    );

    expect(page.content).toBe("<h1>Draft</h1>");
    expect(revisions).toHaveLength(1);
    expect(database.pageRevision.create).toHaveBeenCalledTimes(1);
    expect(restored.hasUnpublishedChanges).toBe(false);
    expect(page.publishedRevisionId).toBe(liveId);
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(database.logEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PAGE_REVISION_RESTORED",
          objectType: "PAGE",
          objectId: "page-1",
          objectLabel: expect.not.stringContaining("<h1>"),
        }),
      }),
    );
  });

  it("rejects a stale restore without overwriting the newer draft", async () => {
    const { database, page, revisions } = createLifecycleDatabase();
    const { service } = createService(database);
    await service.publishPage("master-id", "page-1");
    const liveId = revisions[0]!.id;
    page.content = "<h1>Newer</h1>";
    page.updatedAt = new Date("2026-08-13T16:00:00.000Z");

    await expect(
      service.restorePageRevision(
        "master-id",
        "page-1",
        liveId,
        new Date("2026-08-13T12:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(page.content).toBe("<h1>Newer</h1>");
    expect(revisions).toHaveLength(1);
  });

  it("rejects a revision from another page and does not pin a fourth revision", async () => {
    const { database, revisions } = createLifecycleDatabase();
    const { service } = createService(database);
    revisions.push({
      id: "rev-other",
      pageId: "page-other",
      authorId: "master-id",
      fingerprint: "other",
      pinned: false,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      title: "Other",
      slug: "other",
      content: "<p>Other</p>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      folderId: "base-id",
    });

    await expect(
      service.restorePageRevision(
        "master-id",
        "page-1",
        "rev-other",
        new Date("2026-08-13T12:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    for (const id of ["rev-a", "rev-b", "rev-c", "rev-d"]) {
      revisions.push({
        id,
        pageId: "page-1",
        authorId: "master-id",
        fingerprint: id,
        pinned: false,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        ...snapshotOf(
          database.page
            ? (await database.page.findUnique({ where: { id: "page-1" } }))!
            : ({} as StoredPage),
        ),
      });
    }
    await service.setPageRevisionPinned("master-id", "page-1", "rev-a", true);
    await service.setPageRevisionPinned("master-id", "page-1", "rev-b", true);
    await service.setPageRevisionPinned("master-id", "page-1", "rev-c", true);
    await expect(
      service.setPageRevisionPinned("master-id", "page-1", "rev-d", true),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(database.logEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PAGE_REVISION_PINNED",
          objectId: "page-1",
        }),
      }),
    );
  });
});
