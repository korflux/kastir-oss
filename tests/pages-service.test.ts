import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("server-only", () => ({}));

import { MAX_PAGE_CONTENT_BYTES } from "@/lib/Modules/Pages/Schema";
import { PageService, type PageDatabase } from "@/lib/Modules/Pages/Service";
import { pageSnapshotFingerprint } from "@/lib/Modules/Revisions/snapshot";
import { CONTENT_PATCH_MAX_OPERATIONS } from "@/lib/Modules/Shared/ContentPatchContract";

// Adaptador de revisões exigido pelo PageDatabase; os mocks abaixo seguem a
// assinatura real para que o PageService receba o banco sem cast.
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

function createPageDatabase() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const pages: StoredPage[] = [
    {
      id: "source-id",
      title: "Original",
      slug: "original",
      content: "<h1>Original</h1>",
      seoTitle: "SEO title",
      seoDescription: "SEO description",
      seoKeyword: "original",
      status: "DRAFT",
      folderId: "base-id",
      authorId: "master-id",
      publishedRevisionId: null,
      publishedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "trashed-id",
      title: "Trashed",
      slug: "trashed",
      content: "<p>Trash</p>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      status: "DRAFT",
      folderId: "base-id",
      authorId: "master-id",
      publishedAt: null,
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];
  let nextId = 1;
  const folders = [{ id: "base-id", isBase: true }];
  // Recorte de `where` suportado pelo mock; findMany e count passam pelo mesmo
  // filtro para que o total contado nunca divirja da lista devolvida.
  type PageWhereMock = {
    deletedAt?: Date | null | { not: null };
    folderId?: string;
  };
  const filterPages = (where: PageWhereMock = {}) =>
    pages
      .filter((page) => {
        if (where.deletedAt === null) return page.deletedAt === null;
        if (
          where.deletedAt &&
          typeof where.deletedAt === "object" &&
          "not" in where.deletedAt
        ) {
          return page.deletedAt !== null;
        }
        return true;
      })
      .filter((page) => !where.folderId || page.folderId === where.folderId);
  const database = {
    page: {
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) =>
          pages.find(
            (page) =>
              (where.id ? page.id === where.id : true) &&
              (where.slug ? page.slug === where.slug : true),
          ) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where?: PageWhereMock } = {}) =>
        filterPages(where).map((page) => ({
          ...page,
          author: { id: page.authorId, name: "Master" },
        })),
      ),
      // Contrato obrigatório do PageDatabase (listagem paginada e overview contam no banco).
      count: vi.fn(
        async ({ where }: { where?: PageWhereMock } = {}) =>
          filterPages(where).length,
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<StoredPage, "id" | "createdAt" | "updatedAt">;
        }) => {
          const page: StoredPage = {
            ...data,
            id: `created-${nextId++}`,
            createdAt: now,
            updatedAt: now,
          };
          pages.push(page);
          return page;
        },
      ),
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
    },
    pageFolder: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          folders.find((folder) => folder.id === where.id) ?? null,
      ),
    },
    pageRevision: {
      findFirst: vi.fn<PageRevisionStore["findFirst"]>(async () => null),
      findUnique: vi.fn<PageRevisionStore["findUnique"]>(async () => null),
      findMany: vi.fn<NonNullable<PageRevisionStore["findMany"]>>(
        async () => [],
      ),
      create: vi.fn<PageRevisionStore["create"]>(async ({ data }) => ({
        id: `rev-${pages.length}`,
        pinned: false,
        createdAt: now,
        ...data,
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

describe("PageService CRUD", () => {
  it("creates a draft with an automatic slug and session author", async () => {
    const { database } = createPageDatabase();
    const service = new PageService(database);

    const page = await service.createPage("master-id", {
      title: "Minha Página",
      slug: "",
      content: "<h1>Olá</h1>",
      folderId: "base-id",
      seoTitle: "Título SEO",
    });

    expect(page).toMatchObject({
      title: "Minha Página",
      slug: "minha-pagina",
      content: "<h1>Olá</h1>",
      folderId: "base-id",
      authorId: "master-id",
      status: "DRAFT",
      seoTitle: "Título SEO",
    });
    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PAGE_CREATED",
        objectType: "PAGE",
      }),
    });
  });

  it("blocks a manually duplicated slug before creating a row", async () => {
    const { database } = createPageDatabase();
    const service = new PageService(database);

    await expect(
      service.createPage("master-id", {
        title: "Another",
        slug: "original",
        content: "<p>Another</p>",
        folderId: "base-id",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(database.page.create).not.toHaveBeenCalled();
  });

  it("duplicates content, SEO and folder as a new draft", async () => {
    const { database } = createPageDatabase();
    const service = new PageService(database);

    const copy = await service.duplicatePage("editor-id", "source-id");

    expect(copy).toMatchObject({
      title: "Original",
      slug: "original-copia",
      content: "<h1>Original</h1>",
      seoTitle: "SEO title",
      seoDescription: "SEO description",
      seoKeyword: "original",
      folderId: "base-id",
      authorId: "editor-id",
      status: "DRAFT",
      publishedAt: null,
      deletedAt: null,
    });
  });

  it("excludes trashed pages from normal list and lookup", async () => {
    const { database } = createPageDatabase();
    const service = new PageService(database);

    await expect(service.listPages()).resolves.toHaveLength(1);
    await expect(service.getPage("trashed-id")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lists only soft-deleted pages when trash mode is requested", async () => {
    const { database } = createPageDatabase();
    const service = new PageService(database);

    const trash = await service.listPages({ includeDeleted: true });

    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({
      id: "trashed-id",
      deletedAt: expect.any(Date),
      author: { id: "master-id", name: "Master" },
    });
    expect(database.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: { not: null } }),
        include: { author: { select: { id: true, name: true } } },
      }),
    );
  });

  it("records page events with title and slug snapshot labels", async () => {
    const { database } = createPageDatabase();
    const service = new PageService(database);

    await service.createPage("master-id", {
      title: "Landing Promo",
      slug: "landing-promo",
      content: "<p>Hi</p>",
      folderId: "base-id",
    });

    expect(database.logEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PAGE_CREATED",
        objectLabel: "Landing Promo (/landing-promo)",
      }),
    });
  });

  it("keeps a manually chosen slug when a later save omits the slug", async () => {
    const { database, pages } = createPageDatabase();
    pages[0]!.slug = "manual-slug";
    const service = new PageService(database);

    await service.updatePage("master-id", {
      id: "source-id",
      content: "<h1>Changed</h1>",
    });

    expect(pages[0]).toMatchObject({
      slug: "manual-slug",
      content: "<h1>Changed</h1>",
    });
  });
});

describe("PageService private preview lookup", () => {
  it("returns draft pages by slug and hides trashed pages", async () => {
    const { database, pages } = createPageDatabase();
    pages[0]!.slug = "draft-preview";
    const service = new PageService(database);

    await expect(
      service.getPreviewBySlug("draft-preview"),
    ).resolves.toMatchObject({
      id: "source-id",
      slug: "draft-preview",
    });
    await expect(service.getPreviewBySlug("trashed")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.getPreviewBySlug("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("compiles preview HTML without writing public files or admin bar", async () => {
    const { database, pages } = createPageDatabase();
    pages[0]!.content =
      "<html><head></head><body><p>Draft body</p></body></html>";
    const fileStore = {
      read: vi.fn(),
      write: vi.fn(),
      remove: vi.fn(),
    };
    const service = new PageService(database, fileStore as never);

    const html = await service.compilePreviewHtml(pages[0]!);

    expect(html).toContain("Draft body");
    expect(html).not.toContain("admin-bar.js");
    expect(fileStore.write).not.toHaveBeenCalled();
  });

  it("redirects preview to public only when the live snapshot matches the draft", async () => {
    const { database, pages } = createPageDatabase();
    const service = new PageService(database);
    const draft = pages[0]!;

    await expect(service.shouldRedirectPreviewToPublic(draft)).resolves.toBe(
      false,
    );

    draft.status = "PUBLISHED";
    draft.publishedRevisionId = "rev-live";
    await expect(service.shouldRedirectPreviewToPublic(draft)).resolves.toBe(
      false,
    );

    const liveSnapshot = {
      title: draft.title,
      slug: draft.slug,
      content: draft.content,
      seoTitle: draft.seoTitle,
      seoDescription: draft.seoDescription,
      seoKeyword: draft.seoKeyword,
      folderId: draft.folderId,
    };
    database.pageRevision.findUnique.mockResolvedValue({
      id: "rev-live",
      pageId: draft.id,
      authorId: draft.authorId,
      fingerprint: pageSnapshotFingerprint(liveSnapshot),
      pinned: false,
      createdAt: draft.createdAt,
      ...liveSnapshot,
    });
    await expect(service.shouldRedirectPreviewToPublic(draft)).resolves.toBe(
      true,
    );

    draft.content = "<p>Unpublished draft</p>";
    await expect(service.shouldRedirectPreviewToPublic(draft)).resolves.toBe(
      false,
    );
  });
});

describe("PageService publish media references", () => {
  it("blocks publish when an internal /uploads reference is missing from the library", async () => {
    const { database, pages } = createPageDatabase();
    pages[0]!.content =
      '<img src="/uploads/missing-id/hero.webp" alt="hero" />';
    const mediaFile = {
      findUnique: vi.fn().mockResolvedValue(null),
    };
    Object.assign(database, { mediaFile });
    const fileStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn(),
      remove: vi.fn(),
    };
    const service = new PageService(
      database,
      fileStore as never,
      async (page) => page.content,
    );

    await expect(
      service.publishPage("master-id", "source-id"),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("was not found"),
    });
    expect(fileStore.write).not.toHaveBeenCalled();
  });

  it("allows external image URLs without library lookup", async () => {
    const { database, pages } = createPageDatabase();
    pages[0]!.content =
      '<img src="https://cdn.example/hero.webp" alt="hero" />';
    const mediaFile = {
      findUnique: vi.fn(),
    };
    Object.assign(database, { mediaFile });
    const fileStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn(),
    };
    const service = new PageService(
      database,
      fileStore as never,
      async (page) => page.content,
    );

    await expect(
      service.publishPage("master-id", "source-id"),
    ).resolves.toMatchObject({
      status: "PUBLISHED",
    });
    expect(mediaFile.findUnique).not.toHaveBeenCalled();
    expect(fileStore.write).toHaveBeenCalled();
  });
});

describe("PageService version and patch input validation", () => {
  const validHash = "a".repeat(64);
  const validPatch = {
    id: "source-id",
    expectedContentSha256: validHash,
    operations: [{ old: "Original", new: "Changed" }],
  };

  it.each([
    [
      "sem expectedContentSha256",
      { ...validPatch, expectedContentSha256: undefined },
    ],
    ["hash inválido", { ...validPatch, expectedContentSha256: "abc" }],
    ["sem operations", { ...validPatch, operations: undefined }],
    ["operations vazio", { ...validPatch, operations: [] }],
    [
      "51 operações",
      {
        ...validPatch,
        operations: Array.from(
          { length: CONTENT_PATCH_MAX_OPERATIONS + 1 },
          () => ({
            old: "a",
            new: "b",
          }),
        ),
      },
    ],
    ["old vazio", { ...validPatch, operations: [{ old: "", new: "x" }] }],
    ["new ausente", { ...validPatch, operations: [{ old: "a" }] }],
    [
      "campo extra na operação",
      { ...validPatch, operations: [{ old: "a", new: "b", all: true }] },
    ],
    ["campo extra no patch", { ...validPatch, content: "<h1>Other</h1>" }],
    [
      "old acima do limite de bytes",
      {
        ...validPatch,
        operations: [{ old: "a".repeat(MAX_PAGE_CONTENT_BYTES + 1), new: "b" }],
      },
    ],
  ])(
    "recusa o patch %s antes da transação, sem gravar",
    async (_name, input) => {
      const { database, pages } = createPageDatabase();
      const service = new PageService(database);

      await expect(
        service.patchPageContent("master-id", input),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Invalid page data",
      });
      expect(database.$transaction).not.toHaveBeenCalled();
      expect(pages[0]!.content).toBe("<h1>Original</h1>");
    },
  );

  it("aceita 50 operações e old e new no limite de bytes da página", async () => {
    const { database } = createPageDatabase();
    const service = new PageService(database);
    const oldAtLimit = "a".repeat(MAX_PAGE_CONTENT_BYTES);
    const newAtLimit = "b".repeat(MAX_PAGE_CONTENT_BYTES);

    // Passa pela borda e falha só na guarda (hash de `a`*64 não é o do rascunho).
    await expect(
      service.patchPageContent("master-id", {
        ...validPatch,
        operations: Array.from(
          { length: CONTENT_PATCH_MAX_OPERATIONS },
          () => ({
            old: oldAtLimit,
            new: newAtLimit,
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
