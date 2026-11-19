import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backfillPublishedRevisions,
  type RevisionBackfillDatabase,
} from "@/lib/Modules/Revisions/backfill";
import {
  pageSnapshotFingerprint,
  snippetSnapshotFingerprint,
} from "@/lib/Modules/Revisions/snapshot";

/**
 * Backfill de revisões publicadas no boot (`reconcile`).
 *
 * Sem `vi.mock` de propósito: o módulo só recebe o banco por injeção e não
 * pode importar Prisma, fila nem `server-only`. Se importar, este arquivo
 * deixa de carregar e acusa a regressão.
 *
 * O fake de banco imita o formato real do Prisma para `Snippet`: a linha NÃO
 * tem `authorId` nem `pageIds`, e as páginas de escopo vivem numa tabela
 * separada (`SnippetPageScope`) que só chega na linha com
 * `include: { scopedPages }`. Ler um campo inexistente ou esquecer o include
 * faz estes testes falharem.
 */

// Linhas lidas pelo backfill, derivadas do contrato do banco: o ponteiro
// publishedRevisionId precisa ser `string | null` mesmo quando todas as linhas
// do fixture começam em null.
type BackfillPage = Awaited<
  ReturnType<RevisionBackfillDatabase["page"]["findMany"]>
>[number];
type BackfillSnippet = Awaited<
  ReturnType<RevisionBackfillDatabase["snippet"]["findMany"]>
>[number];
// Linha de `Snippet` como o model guarda: sem as linhas de escopo.
type StoredSnippet = Omit<BackfillSnippet, "scopedPages">;

const MASTER_ID = "master-1";

function livePage(overrides: Partial<BackfillPage> = {}): BackfillPage {
  return {
    id: "page-live",
    title: "Home",
    slug: "home",
    content: "<h1>Live</h1>",
    seoTitle: null,
    seoDescription: null,
    seoKeyword: null,
    folderId: "base",
    authorId: "author-1",
    status: "PUBLISHED",
    publishedRevisionId: null,
    ...overrides,
  };
}

function storedSnippet(overrides: Partial<StoredSnippet> = {}): StoredSnippet {
  return {
    id: "snip-live",
    name: "Tracker",
    location: "HEADER",
    content: "<script>1</script>",
    priority: null,
    scopeType: "ALL_PAGES",
    triggerType: null,
    triggerConfig: null,
    maxDisplays: null,
    displayResetDays: null,
    status: "PUBLISHED",
    publishedRevisionId: null,
    ...overrides,
  };
}

/** Monta o banco fake; `master: null` simula instalação sem usuário Master. */
function createDatabase(input: {
  pages?: BackfillPage[];
  snippets?: StoredSnippet[];
  scopes?: Array<{ snippetId: string; pageId: string }>;
  master?: { id: string } | null;
  failSnippetRevisionFor?: string;
  /** Revisões que já existem no banco (unique por recurso + fingerprint). */
  existingPageRevisions?: Array<{
    id: string;
    pageId: string;
    fingerprint: string;
  }>;
  existingSnippetRevisions?: Array<{
    id: string;
    snippetId: string;
    fingerprint: string;
  }>;
}) {
  const pages = input.pages ?? [];
  const snippets = input.snippets ?? [];
  const scopes = input.scopes ?? [];
  const master = input.master === undefined ? { id: MASTER_ID } : input.master;
  const existingPageRevisions = input.existingPageRevisions ?? [];
  const existingSnippetRevisions = input.existingSnippetRevisions ?? [];
  const createdPages: Array<Record<string, unknown>> = [];
  const createdSnippets: Array<Record<string, unknown>> = [];

  const database = {
    page: {
      findMany: vi.fn(async () => pages),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { publishedRevisionId: string };
        }) => {
          const page = pages.find((row) => row.id === where.id);
          if (page) page.publishedRevisionId = data.publishedRevisionId;
          return page;
        },
      ),
    },
    user: {
      findFirst: vi.fn(
        async (args: { where: { isMaster: true }; select: { id: true } }) =>
          args.where.isMaster ? master : null,
      ),
    },
    snippet: {
      // Como o Prisma: `scopedPages` só existe na linha quando pedido no include.
      findMany: vi.fn(
        async (args: {
          include: { scopedPages: { select: { pageId: true } } };
        }) =>
          snippets.map((row) => ({
            ...row,
            scopedPages: args.include.scopedPages
              ? scopes
                  .filter((scope) => scope.snippetId === row.id)
                  .map((scope) => ({ pageId: scope.pageId }))
              : [],
          })),
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { publishedRevisionId: string };
        }) => {
          const snippet = snippets.find((row) => row.id === where.id);
          if (snippet) snippet.publishedRevisionId = data.publishedRevisionId;
          return snippet;
        },
      ),
    },
    pageRevision: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { pageId: string; fingerprint: string };
          select: { id: true };
        }) => {
          const found = existingPageRevisions.find(
            (row) =>
              row.pageId === where.pageId &&
              row.fingerprint === where.fingerprint,
          );
          return found ? { id: found.id } : null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdPages.push(data);
        return { id: "rev-page-1" };
      }),
    },
    snippetRevision: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { snippetId: string; fingerprint: string };
          select: { id: true };
        }) => {
          const found = existingSnippetRevisions.find(
            (row) =>
              row.snippetId === where.snippetId &&
              row.fingerprint === where.fingerprint,
          );
          return found ? { id: found.id } : null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.snippetId === input.failSnippetRevisionFor) {
          throw new Error("boom: <script>secret()</script>");
        }
        createdSnippets.push(data);
        return { id: `rev-${String(data.snippetId)}` };
      }),
    },
  };

  return { database, pages, snippets, createdPages, createdSnippets };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backfillPublishedRevisions", () => {
  it("creates a live revision and pointer for published pages and snippets only", async () => {
    const { database, pages, snippets, createdPages, createdSnippets } =
      createDatabase({
        pages: [
          livePage(),
          livePage({
            id: "page-draft",
            title: "Draft",
            slug: "draft",
            content: "<h1>Draft</h1>",
            status: "DRAFT",
          }),
          livePage({
            id: "page-already",
            title: "Already",
            slug: "already",
            content: "<h1>Already</h1>",
            publishedRevisionId: "rev-existing",
          }),
        ],
        snippets: [
          storedSnippet(),
          storedSnippet({
            id: "snip-draft",
            name: "Draft",
            content: "<script>2</script>",
            status: "DRAFT",
          }),
          storedSnippet({
            id: "snip-already",
            name: "Already",
            publishedRevisionId: "rev-snip-existing",
          }),
        ],
      });

    const result = await backfillPublishedRevisions(database);

    expect(result.pages).toBe(1);
    expect(result.snippets).toBe(1);
    expect(pages[0]!.publishedRevisionId).toBe("rev-page-1");
    expect(pages[0]!.content).toBe("<h1>Live</h1>");
    expect(pages[1]!.publishedRevisionId).toBeNull();
    expect(pages[2]!.publishedRevisionId).toBe("rev-existing");
    expect(createdPages).toHaveLength(1);
    expect(createdPages[0]).toMatchObject({
      pageId: "page-live",
      authorId: "author-1",
      fingerprint: pageSnapshotFingerprint({
        title: "Home",
        slug: "home",
        content: "<h1>Live</h1>",
        seoTitle: null,
        seoDescription: null,
        seoKeyword: null,
        folderId: "base",
      }),
    });
    expect(snippets[0]!.publishedRevisionId).toBe("rev-snip-live");
    expect(snippets[1]!.publishedRevisionId).toBeNull();
    // Script que já tinha versão publicada continua intocado.
    expect(snippets[2]!.publishedRevisionId).toBe("rev-snip-existing");
    expect(createdSnippets).toHaveLength(1);
    expect(database.snippet.update).toHaveBeenCalledTimes(1);
  });

  it("authors script revisions as the Master and scopes them to the real scope rows", async () => {
    const { database, snippets, createdSnippets } = createDatabase({
      snippets: [
        storedSnippet({
          id: "snip-scoped",
          scopeType: "SPECIFIC_PAGES",
          location: "BODY_END",
          priority: 3,
        }),
        storedSnippet({ id: "snip-global" }),
      ],
      scopes: [
        { snippetId: "snip-scoped", pageId: "page-b" },
        { snippetId: "snip-scoped", pageId: "page-a" },
      ],
    });

    const result = await backfillPublishedRevisions(database);

    expect(result.snippets).toBe(2);
    expect(database.user.findFirst).toHaveBeenCalledTimes(1);
    expect(database.user.findFirst).toHaveBeenCalledWith({
      where: { isMaster: true },
      select: { id: true },
    });
    expect(database.snippet.findMany).toHaveBeenCalledWith({
      include: { scopedPages: { select: { pageId: true } } },
    });

    // O model Snippet não tem autor: a revisão leva o id do Master.
    expect(createdSnippets[0]).toMatchObject({
      snippetId: "snip-scoped",
      authorId: MASTER_ID,
      scopeType: "SPECIFIC_PAGES",
      pageIds: ["page-b", "page-a"],
      fingerprint: snippetSnapshotFingerprint({
        name: "Tracker",
        location: "BODY_END",
        content: "<script>1</script>",
        priority: 3,
        scopeType: "SPECIFIC_PAGES",
        pageIds: ["page-a", "page-b"],
        triggerType: null,
        triggerConfig: null,
        maxDisplays: null,
        displayResetDays: null,
      }),
    });
    expect(createdSnippets[1]).toMatchObject({
      snippetId: "snip-global",
      authorId: MASTER_ID,
      pageIds: [],
    });
    // Campos do snapshot só; nada de campo inexistente vazando para o banco.
    expect(createdSnippets[0]).not.toHaveProperty("scopedPages");
    expect(snippets.map((row) => row.publishedRevisionId)).toEqual([
      "rev-snip-scoped",
      "rev-snip-global",
    ]);
  });

  it("skips script revisions and logs the reason when there is no Master, without breaking the boot", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { database, pages, snippets, createdSnippets } = createDatabase({
      pages: [livePage()],
      snippets: [storedSnippet()],
      master: null,
    });

    const result = await backfillPublishedRevisions(database);

    // Páginas seguem normalmente; scripts ficam sem revisão e sem ponteiro.
    expect(result).toEqual({ pages: 1, snippets: 0 });
    expect(pages[0]!.publishedRevisionId).toBe("rev-page-1");
    expect(createdSnippets).toHaveLength(0);
    expect(database.snippetRevision.create).not.toHaveBeenCalled();
    expect(database.snippet.update).not.toHaveBeenCalled();
    expect(snippets[0]!.publishedRevisionId).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0]!.join(" ");
    expect(logged).toContain("[Kastir]");
    expect(logged).toContain("no Master user");
    // Log técnico sem conteúdo do script nem dado de usuário.
    expect(logged).not.toContain("<script>");
    expect(logged).not.toContain("snip-live");
  });

  it("points a script to its existing identical revision instead of failing on the unique every boot", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sameContent = snippetSnapshotFingerprint({
      name: "Tracker",
      location: "HEADER",
      content: "<script>1</script>",
      priority: null,
      scopeType: "ALL_PAGES",
      pageIds: [],
      triggerType: null,
      triggerConfig: null,
      maxDisplays: null,
      displayResetDays: null,
    });
    const { database, snippets, createdSnippets } = createDatabase({
      snippets: [storedSnippet(), storedSnippet({ id: "snip-new" })],
      existingSnippetRevisions: [
        // Sobra de um boot interrompido entre create e update do ponteiro.
        {
          id: "rev-leftover",
          snippetId: "snip-live",
          fingerprint: sameContent,
        },
        // Mesmo fingerprint, mas de outro script: não pode ser reaproveitada.
        { id: "rev-other", snippetId: "snip-other", fingerprint: sameContent },
        // Mesmo script, conteúdo diferente: não casa.
        {
          id: "rev-old",
          snippetId: "snip-new",
          fingerprint: "old-fingerprint",
        },
      ],
    });

    const result = await backfillPublishedRevisions(database);

    expect(result.snippets).toBe(2);
    expect(database.snippetRevision.findFirst).toHaveBeenCalledWith({
      where: { snippetId: "snip-live", fingerprint: sameContent },
      select: { id: true },
    });
    // O script com revisão idêntica só ganha o ponteiro; nada é criado para ele.
    expect(snippets[0]!.publishedRevisionId).toBe("rev-leftover");
    expect(createdSnippets).toHaveLength(1);
    expect(createdSnippets[0]).toMatchObject({ snippetId: "snip-new" });
    expect(snippets[1]!.publishedRevisionId).toBe("rev-snip-new");
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("points a page to its existing identical revision instead of creating a duplicate", async () => {
    const sameContent = pageSnapshotFingerprint({
      title: "Home",
      slug: "home",
      content: "<h1>Live</h1>",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      folderId: "base",
    });
    const { database, pages, createdPages } = createDatabase({
      pages: [livePage(), livePage({ id: "page-new", slug: "new" })],
      existingPageRevisions: [
        { id: "rev-leftover", pageId: "page-live", fingerprint: sameContent },
        { id: "rev-other", pageId: "page-other", fingerprint: sameContent },
      ],
    });

    const result = await backfillPublishedRevisions(database);

    expect(result.pages).toBe(2);
    expect(database.pageRevision.findFirst).toHaveBeenCalledWith({
      where: { pageId: "page-live", fingerprint: sameContent },
      select: { id: true },
    });
    expect(pages[0]!.publishedRevisionId).toBe("rev-leftover");
    expect(createdPages).toHaveLength(1);
    expect(createdPages[0]).toMatchObject({ pageId: "page-new" });
    expect(pages[1]!.publishedRevisionId).toBe("rev-page-1");
  });

  it("does not look up the Master or warn when no script needs a backfill", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { database } = createDatabase({
      snippets: [
        storedSnippet({ status: "DRAFT" }),
        storedSnippet({ id: "snip-2", publishedRevisionId: "rev-existing" }),
      ],
      master: null,
    });

    const result = await backfillPublishedRevisions(database);

    expect(result).toEqual({ pages: 0, snippets: 0 });
    expect(database.user.findFirst).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps backfilling the other scripts when one revision fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { database, snippets, createdSnippets } = createDatabase({
      snippets: [
        storedSnippet({ id: "snip-bad" }),
        storedSnippet({ id: "snip-good" }),
      ],
      failSnippetRevisionFor: "snip-bad",
    });

    const result = await backfillPublishedRevisions(database);

    expect(result.snippets).toBe(1);
    expect(snippets[0]!.publishedRevisionId).toBeNull();
    expect(snippets[1]!.publishedRevisionId).toBe("rev-snip-good");
    expect(createdSnippets).toHaveLength(1);

    expect(error).toHaveBeenCalledTimes(1);
    const logged = error.mock.calls[0]!.join(" ");
    expect(logged).toContain("snip-bad");
    // A mensagem do erro pode carregar o conteúdo do script: não vai para o log.
    expect(logged).not.toContain("secret()");
  });
});
