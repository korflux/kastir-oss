import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { createPageFileStore } from "@/lib/Publishing/fileStore";
import { PageService, type PageDatabase } from "@/lib/Modules/Pages/Service";
import type { PageRevisionRecord } from "@/lib/Modules/Revisions/Types";

// Adaptador de revisões exigido pelo PageDatabase; os mocks seguem a
// assinatura real para o PageService receber o banco sem cast.
type PageRevisionStore = NonNullable<PageDatabase["pageRevision"]>;

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
  publishedRevisionId?: string | null;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function createPublishingDatabase() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const pages: StoredPage[] = [
    {
      id: "page-id",
      title: "Landing",
      slug: "landing",
      content: "<h1>First</h1>",
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
    },
  ];
  // Critério único de findMany e count (páginas ativas, ignorando `where`): os
  // fluxos de publicação deste arquivo não paginam, então o total nunca diverge da lista.
  const activePages = () => pages.filter((page) => page.deletedAt === null);
  const database = {
    page: {
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) =>
          pages.find(
            (page) =>
              (!where.id || page.id === where.id) &&
              (!where.slug || page.slug === where.slug),
          ) ?? null,
      ),
      findMany: vi.fn(async () => activePages()),
      // Contrato obrigatório do PageDatabase (listagem paginada e overview contam no banco).
      count: vi.fn(async () => activePages().length),
      create: vi.fn(),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<StoredPage>;
        }) => {
          const page = pages.find((candidate) => candidate.id === where.id);
          if (!page) throw new Error("missing page");
          Object.assign(page, data, { updatedAt: now });
          return page;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = pages.findIndex((page) => page.id === where.id);
        if (index < 0) throw new Error("missing page");
        return pages.splice(index, 1)[0];
      }),
      deleteMany: vi.fn(
        async ({ where }: { where: { id: string; deletedAt?: unknown } }) => {
          const index = pages.findIndex(
            (page) => page.id === where.id && page.deletedAt,
          );
          if (index < 0) return { count: 0 };
          pages.splice(index, 1);
          return { count: 1 };
        },
      ),
    },
    pageFolder: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "base-id" ? { id: "base-id" } : null,
      ),
    },
    pageRevision: (() => {
      const rows: PageRevisionRecord[] = [];
      return {
        findFirst: vi.fn<PageRevisionStore["findFirst"]>(
          async ({ where }) =>
            rows.find(
              (row) =>
                (!where.pageId || row.pageId === where.pageId) &&
                (!where.fingerprint || row.fingerprint === where.fingerprint) &&
                (!where.slug || row.slug === where.slug),
            ) ?? null,
        ),
        findUnique: vi.fn<PageRevisionStore["findUnique"]>(
          async ({ where }) => rows.find((row) => row.id === where.id) ?? null,
        ),
        findMany: vi.fn<NonNullable<PageRevisionStore["findMany"]>>(
          async ({ where = {} } = {}) =>
            rows.filter(
              (row) =>
                (!where.pageId || row.pageId === where.pageId) &&
                (!where.slug || row.slug === where.slug),
            ),
        ),
        create: vi.fn<PageRevisionStore["create"]>(async ({ data }) => {
          const row: PageRevisionRecord = {
            id: `rev-${rows.length + 1}`,
            pinned: false,
            createdAt: now,
            ...data,
          };
          rows.push(row);
          return row;
        }),
      };
    })(),
    snippet: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
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
    logEntry: { create: vi.fn(async () => ({ id: "log-id" })) },
    // Trava de linha do Save (`lockRowForUpdate`); o banco falso não trava.
    $queryRaw: vi.fn(),
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };

  return { database, pages };
}

function compiledContent(content: string, pageId = "page-id") {
  return `${content}\n<script defer src="/_kastir/admin-bar.js" data-kastir-admin-bar="1" data-page-id="${pageId}"></script>`;
}

describe("PageService publishing lifecycle", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("publishes compiled content and unpublishes to a real 404 path", async () => {
    const { database, pages } = createPublishingDatabase();
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-publish-"));
    directories.push(publicDir);
    const service = new PageService(
      database,
      createPageFileStore(publicDir),
      undefined,
      undefined,
      publicDir,
    );

    await service.publishPage("master-id", "page-id");
    expect(pages[0]).toMatchObject({
      status: "PUBLISHED",
      publishedAt: expect.any(Date),
    });
    await expect(createPageFileStore(publicDir).read("landing")).resolves.toBe(
      compiledContent("<h1>First</h1>"),
    );

    await service.unpublishPage("master-id", "page-id");
    expect(pages[0]).toMatchObject({
      status: "DRAFT",
      publishedRevisionId: expect.any(String),
    });
    await expect(
      createPageFileStore(publicDir).read("landing"),
    ).resolves.toBeNull();
  });

  it("keeps the public file unchanged when saving a published page", async () => {
    const { database } = createPublishingDatabase();
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-publish-"));
    directories.push(publicDir);
    const service = new PageService(
      database,
      createPageFileStore(publicDir),
      undefined,
      undefined,
      publicDir,
    );

    await service.publishPage("master-id", "page-id");
    await service.updatePage("master-id", {
      id: "page-id",
      content: "<h1>Updated</h1>",
    });

    await expect(createPageFileStore(publicDir).read("landing")).resolves.toBe(
      compiledContent("<h1>First</h1>"),
    );
  });

  it("keeps the live slug on disk when the draft slug changes", async () => {
    const { database } = createPublishingDatabase();
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-publish-"));
    directories.push(publicDir);
    const store = createPageFileStore(publicDir);
    const service = new PageService(
      database,
      store,
      undefined,
      undefined,
      publicDir,
    );

    await service.publishPage("master-id", "page-id");
    await service.updatePage("master-id", {
      id: "page-id",
      slug: "new-landing",
    });

    await expect(store.read("landing")).resolves.toBe(
      compiledContent("<h1>First</h1>"),
    );
    await expect(store.read("new-landing")).resolves.toBeNull();
  });

  it("trashes a page out of access and restores it as a draft without publishing", async () => {
    const { database, pages } = createPublishingDatabase();
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-publish-"));
    directories.push(publicDir);
    const store = createPageFileStore(publicDir);
    const service = new PageService(
      database,
      store,
      undefined,
      undefined,
      publicDir,
    );

    await service.publishPage("master-id", "page-id");
    await service.trashPage("master-id", "page-id");
    expect(pages[0]).toMatchObject({
      status: "DRAFT",
      deletedAt: expect.any(Date),
      publishedAt: null,
    });
    await expect(store.read("landing")).resolves.toBeNull();
    await expect(service.getPage("page-id")).rejects.toThrow();

    await service.restorePage("master-id", "page-id");
    expect(pages[0]).toMatchObject({
      status: "DRAFT",
      deletedAt: null,
      publishedAt: null,
    });
    await expect(store.read("landing")).resolves.toBeNull();
  });

  it("only permits permanent deletion after trash and blocks Editor", async () => {
    const { database } = createPublishingDatabase();
    const publicDir = await mkdtemp(join(tmpdir(), "kastir-publish-"));
    directories.push(publicDir);
    const service = new PageService(
      database,
      createPageFileStore(publicDir),
      undefined,
      undefined,
      publicDir,
    );

    await expect(
      service.permanentlyDeletePage("master-id", "page-id", "MASTER"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    await service.trashPage("master-id", "page-id");
    await expect(
      service.permanentlyDeletePage("editor-id", "page-id", "EDITOR"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
