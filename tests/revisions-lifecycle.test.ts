import { describe, expect, it } from "vitest";

/**
 * Ciclo de vida compartilhado de revisões (`Revisions/lifecycle`): guardas de
 * concorrência, recorte rascunho vs. publicado e RevisionService restrito ao
 * tipo do módulo. Também fixa o contrato dos dois módulos consumidores
 * (Pages e Custom Code): mesmo erro tipado e mesma mensagem de antes.
 *
 * Sem `vi.mock` de propósito: `Pages/lifecycle` e `CustomCode/lifecycle` são
 * carregados pelo backfill, pelas rotas de diff e pelas ferramentas MCP só
 * para ler snapshots. Se um deles passar a importar Prisma, fila ou
 * `server-only`, este arquivo deixa de carregar e acusa a regressão.
 */
import {
  assertSnippetActivatePointerUnchanged,
  assertSnippetExpectedUpdatedAt,
  assertSnippetUnpublishPointerUnchanged,
  attachSnippetLifecycle,
} from "@/lib/Modules/CustomCode/lifecycle";
import {
  CustomCodeDomainError,
  type SnippetRecord,
} from "@/lib/Modules/CustomCode/Types";
import {
  assertPageActivatePointerUnchanged,
  assertPageExpectedUpdatedAt,
  assertPageUnpublishPointerUnchanged,
  attachPageLifecycle,
  toPageSnapshot,
} from "@/lib/Modules/Pages/lifecycle";
import { PagesDomainError, type PageRecord } from "@/lib/Modules/Pages/Types";
import { isOptimisticSaveConflict } from "@/lib/Modules/Revisions/Components/revisionEditorState";
import {
  createRevisionLifecycleGuards,
  revisionServiceFor,
  type ScopedRevisionHost,
} from "@/lib/Modules/Revisions/lifecycle";
import {
  pageSnapshotFingerprint,
  snippetSnapshotFingerprint,
} from "@/lib/Modules/Revisions/snapshot";
import type {
  PageRevisionRecord,
  PageSnapshot,
  SnippetRevisionRecord,
  SnippetSnapshot,
} from "@/lib/Modules/Revisions/Types";
import { contentSha256 } from "@/lib/Modules/Shared/ContentPatch";

const T0 = new Date("2026-08-13T12:00:00.000Z");

/** Erro injetado pelos testes para provar que a guarda usa a fábrica do módulo. */
class TestDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: "CONFLICT" | "INVALID_STATE", message: string) =>
  new TestDomainError(code, message);

const pageSnapshot: PageSnapshot = {
  title: "Landing",
  slug: "landing",
  content: "<p>v1</p>",
  seoTitle: null,
  seoDescription: null,
  seoKeyword: null,
  folderId: "base",
};

function pageRecord(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: "page-1",
    ...pageSnapshot,
    status: "DRAFT",
    authorId: "user-1",
    publishedRevisionId: null,
    publishedAt: null,
    deletedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function snippetRecord(overrides: Partial<SnippetRecord> = {}): SnippetRecord {
  return {
    id: "snippet-1",
    name: "Header",
    location: "HEADER",
    content: "<script>a()</script>",
    status: "DRAFT",
    priority: null,
    scopeType: "SPECIFIC_PAGES",
    scopedPages: [{ pageId: "p2" }, { pageId: "p1" }],
    triggerType: null,
    triggerConfig: null,
    maxDisplays: null,
    displayResetDays: null,
    publishedRevisionId: null,
    deletedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe("createRevisionLifecycleGuards", () => {
  const guards = createRevisionLifecycleGuards({ resource: "Thing", fail });

  it("recusa versão esperada diferente com o erro e o rótulo do módulo", () => {
    expect(() => guards.assertExpectedUpdatedAt(undefined, T0)).not.toThrow();
    expect(() =>
      guards.assertExpectedUpdatedAt(new Date(T0.getTime()), T0),
    ).not.toThrow();

    const thrown = (() => {
      try {
        guards.assertExpectedUpdatedAt(new Date(T0.getTime() + 1), T0);
      } catch (error) {
        return error;
      }
    })();
    expect(thrown).toBeInstanceOf(TestDomainError);
    expect(thrown).toMatchObject({
      code: "CONFLICT",
      message: "Thing was updated by another request",
    });
  });

  it("Ativar exige ponteiro e recusa troca de ponteiro no meio da operação", () => {
    expect(() =>
      guards.assertActivatePointerUnchanged("r1", "r1"),
    ).not.toThrow();
    expect(() => guards.assertActivatePointerUnchanged(null, "r1")).toThrow(
      expect.objectContaining({
        code: "INVALID_STATE",
        message: "Thing has no published revision",
      }),
    );
    expect(() => guards.assertActivatePointerUnchanged("r2", "r1")).toThrow(
      expect.objectContaining({
        code: "CONFLICT",
        message: "Published revision changed during activate",
      }),
    );
  });

  it("Desativar exige ponteiro e recusa troca de ponteiro no meio da operação", () => {
    expect(() =>
      guards.assertUnpublishPointerUnchanged("r1", "r1"),
    ).not.toThrow();
    expect(() => guards.assertUnpublishPointerUnchanged(null, "r1")).toThrow(
      expect.objectContaining({
        code: "INVALID_STATE",
        message: "Thing has no published revision",
      }),
    );
    expect(() => guards.assertUnpublishPointerUnchanged("r2", "r1")).toThrow(
      expect.objectContaining({
        code: "CONFLICT",
        message: "Published revision changed during deactivate",
      }),
    );
  });
});

/**
 * Guarda de versão do save (`assertExpectedVersion`): com
 * `expectedContentSha256` confere só o hash do conteúdo atual (minúsculas) e
 * ignora `expectedUpdatedAt`; sem ele, vale `expectedUpdatedAt` como antes.
 * Fonte única para páginas e scripts (passos 2a e 2b da phase-5).
 */
describe("createRevisionLifecycleGuards: assertExpectedVersion", () => {
  const guards = createRevisionLifecycleGuards({ resource: "Thing", fail });
  const content = "<p>v1</p>";
  const hash = contentSha256(content);
  const actual = { updatedAt: T0, content };
  const staleUpdatedAt = new Date(T0.getTime() - 60_000);

  /** Chama a guarda e devolve o erro lançado (ou undefined se passou). */
  function versionError(
    expected: { updatedAt?: Date; contentSha256?: string },
    current: { updatedAt: Date; content: string } = actual,
  ): unknown {
    try {
      guards.assertExpectedVersion(expected, current);
    } catch (error) {
      return error;
    }
  }

  it("A9: hash igual passa mesmo com `expectedUpdatedAt` antigo (publish mudou só o `updatedAt`)", () => {
    expect(
      versionError({ contentSha256: hash, updatedAt: staleUpdatedAt }),
    ).toBeUndefined();
  });

  it("hash igual passa em maiúsculas, porque a comparação é feita em minúsculas", () => {
    expect(versionError({ contentSha256: hash.toUpperCase() })).toBeUndefined();
  });

  it("A5: hash diferente recusa com CONFLICT, a frase do painel e o hash atual", () => {
    const stale = contentSha256("<p>v0</p>");
    const thrown = versionError({ contentSha256: stale });
    expect(thrown).toBeInstanceOf(TestDomainError);
    expect(thrown).toMatchObject({
      code: "CONFLICT",
      message: `Thing was updated by another request (current contentSha256: ${hash})`,
    });
  });

  it("A5: o hash atual vem em minúsculas mesmo quando o esperado veio em maiúsculas", () => {
    const thrown = versionError({
      contentSha256: contentSha256("<p>v0</p>").toUpperCase(),
    });
    expect(thrown).toMatchObject({ code: "CONFLICT" });
    expect((thrown as Error).message).toContain(hash);
    expect((thrown as Error).message).not.toContain(hash.toUpperCase());
  });

  it("com hash presente só o hash é conferido: `expectedUpdatedAt` igual não salva hash diferente", () => {
    expect(
      versionError({
        contentSha256: contentSha256("<p>v0</p>"),
        updatedAt: new Date(T0.getTime()),
      }),
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("hash vazio não cai para a conferência por data: recusa", () => {
    expect(
      versionError({ contentSha256: "", updatedAt: new Date(T0.getTime()) }),
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("o hash é do conteúdo byte a byte (CRLF e espaço final contam)", () => {
    const crlf = { updatedAt: T0, content: "<p>\r\n</p> " };
    expect(
      versionError({ contentSha256: contentSha256("<p>\r\n</p> ") }, crlf),
    ).toBeUndefined();
    expect(
      versionError({ contentSha256: contentSha256("<p>\n</p> ") }, crlf),
    ).toMatchObject({ code: "CONFLICT" });
    expect(
      versionError({ contentSha256: contentSha256("<p>\r\n</p>") }, crlf),
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("sem hash vale `expectedUpdatedAt`: igual passa, diferente recusa sem hash na mensagem", () => {
    expect(versionError({ updatedAt: new Date(T0.getTime()) })).toBeUndefined();

    const thrown = versionError({
      updatedAt: new Date(T0.getTime() + 1),
    });
    expect(thrown).toBeInstanceOf(TestDomainError);
    expect(thrown).toMatchObject({
      code: "CONFLICT",
      message: "Thing was updated by another request",
    });
  });

  it("sem hash e sem `expectedUpdatedAt` não confere nada (create e primeira tela)", () => {
    expect(versionError({})).toBeUndefined();
  });

  it("a mensagem de conflito por hash segue reconhecida como conflito de versão do painel", () => {
    const thrown = versionError({ contentSha256: contentSha256("outro") });
    expect(
      isOptimisticSaveConflict(
        (thrown as TestDomainError).code,
        (thrown as Error).message,
      ),
    ).toBe(true);
  });
});

describe("guardas exportadas por Pages e Custom Code", () => {
  it("Pages lança PagesDomainError com as mensagens de sempre", () => {
    const expectPages = (run: () => void, code: string, message: string) => {
      expect(run).toThrow(PagesDomainError);
      expect(run).toThrow(expect.objectContaining({ code, message }));
    };

    expectPages(
      () => assertPageExpectedUpdatedAt(new Date(T0.getTime() + 1), T0),
      "CONFLICT",
      "Page was updated by another request",
    );
    expectPages(
      () => assertPageActivatePointerUnchanged(null, "r1"),
      "INVALID_STATE",
      "Page has no published revision",
    );
    expectPages(
      () => assertPageActivatePointerUnchanged("r2", "r1"),
      "CONFLICT",
      "Published revision changed during activate",
    );
    expectPages(
      () => assertPageUnpublishPointerUnchanged(null, "r1"),
      "INVALID_STATE",
      "Page has no published revision",
    );
    expectPages(
      () => assertPageUnpublishPointerUnchanged("r2", "r1"),
      "CONFLICT",
      "Published revision changed during deactivate",
    );
  });

  it("Custom Code lança CustomCodeDomainError com as mensagens de sempre", () => {
    const expectScript = (run: () => void, code: string, message: string) => {
      expect(run).toThrow(CustomCodeDomainError);
      expect(run).toThrow(expect.objectContaining({ code, message }));
    };

    expectScript(
      () => assertSnippetExpectedUpdatedAt(new Date(T0.getTime() + 1), T0),
      "CONFLICT",
      "Script was updated by another request",
    );
    expectScript(
      () => assertSnippetActivatePointerUnchanged(null, "r1"),
      "INVALID_STATE",
      "Script has no published revision",
    );
    expectScript(
      () => assertSnippetActivatePointerUnchanged("r2", "r1"),
      "CONFLICT",
      "Published revision changed during activate",
    );
    expectScript(
      () => assertSnippetUnpublishPointerUnchanged(null, "r1"),
      "INVALID_STATE",
      "Script has no published revision",
    );
    expectScript(
      () => assertSnippetUnpublishPointerUnchanged("r2", "r1"),
      "CONFLICT",
      "Published revision changed during deactivate",
    );
  });
});

describe("attachRevisionLifecycle via Pages e Custom Code", () => {
  it("sem revisão publicada o rascunho conta como alteração pendente", () => {
    const result = attachPageLifecycle(pageRecord(), null);

    expect(result).toMatchObject({
      published: null,
      hasUnpublishedChanges: true,
      activated: false,
      draftFingerprint: pageSnapshotFingerprint(pageSnapshot),
    });
    expect("activatedDuringPublish" in result).toBe(false);
  });

  it("compara rascunho e publicado pelo snapshot e deriva Ativado do status", () => {
    const live = pageRecord({ status: "PUBLISHED", publishedRevisionId: "r1" });
    const clean = attachPageLifecycle(live, toPageSnapshot(live));
    expect(clean.hasUnpublishedChanges).toBe(false);
    expect(clean.activated).toBe(true);

    const dirty = attachPageLifecycle(live, {
      ...pageSnapshot,
      content: "<p>no ar</p>",
    });
    expect(dirty.hasUnpublishedChanges).toBe(true);
    expect(dirty.published?.content).toBe("<p>no ar</p>");
  });

  it("só informa activatedDuringPublish quando o chamador define o valor", () => {
    const record = pageRecord();
    expect(
      attachPageLifecycle(record, null, { activatedDuringPublish: true }),
    ).toMatchObject({ activatedDuringPublish: true });
    expect(
      attachPageLifecycle(record, null, { activatedDuringPublish: false }),
    ).toMatchObject({ activatedDuringPublish: false });
    expect(
      "activatedDuringPublish" in attachPageLifecycle(record, null, {}),
    ).toBe(false);
  });

  it("Custom Code ignora a ordem das páginas do escopo ao comparar", () => {
    const record = snippetRecord({
      status: "PUBLISHED",
      publishedRevisionId: "r1",
    });
    const published: SnippetSnapshot = {
      name: "Header",
      location: "HEADER",
      content: "<script>a()</script>",
      priority: null,
      scopeType: "SPECIFIC_PAGES",
      pageIds: ["p1", "p2"],
      triggerType: null,
      triggerConfig: null,
      maxDisplays: null,
      displayResetDays: null,
    };

    const result = attachSnippetLifecycle(record, published);
    expect(result.hasUnpublishedChanges).toBe(false);
    expect(result.activated).toBe(true);
    expect(result.draftFingerprint).toBe(snippetSnapshotFingerprint(published));

    expect(
      attachSnippetLifecycle(record, {
        ...published,
        content: "<script>b()</script>",
      }).hasUnpublishedChanges,
    ).toBe(true);
  });
});

describe("revisionServiceFor", () => {
  const messages = {
    fail,
    unavailable: "Page revision store is unavailable",
    unused: "Snippet revisions are not used by Pages",
  };

  const baseRevision: PageRevisionRecord = {
    id: "rev-1",
    pageId: "page-1",
    authorId: "user-1",
    fingerprint: pageSnapshotFingerprint(pageSnapshot),
    pinned: false,
    createdAt: T0,
    ...pageSnapshot,
  };

  /** Loja de página em memória; `onUpdate` observa em qual loja o pin foi gravado. */
  function pageStore(onUpdate: (store: string) => void, label: string) {
    return {
      findFirst: async () => null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === baseRevision.id ? baseRevision : null,
      count: async () => 0,
      update: async ({ data }: { data: { pinned: boolean } }) => {
        onUpdate(label);
        return { ...baseRevision, ...data };
      },
      create: async () => baseRevision,
    };
  }

  it("falha com a mensagem do módulo quando o banco não tem a própria loja", () => {
    const host: ScopedRevisionHost<"pageRevision"> = {
      async $transaction(callback) {
        return callback({});
      },
    };

    expect(() => revisionServiceFor("pageRevision", host, messages)).toThrow(
      expect.objectContaining({
        code: "INVALID_STATE",
        message: "Page revision store is unavailable",
      }),
    );
  });

  it("lê pela loja do módulo e escopa a revisão à página", async () => {
    const host: ScopedRevisionHost<"pageRevision"> = {
      pageRevision: pageStore(() => undefined, "host"),
      async $transaction(callback) {
        return callback({});
      },
    };
    const service = revisionServiceFor("pageRevision", host, messages);

    await expect(
      service.getPageRevisionForPage("rev-1", "page-1"),
    ).resolves.toMatchObject({ id: "rev-1" });
    await expect(
      service.getPageRevisionForPage("rev-1", "other-page"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("recusa gravar no tipo de revisão que o módulo não usa", async () => {
    const updates: string[] = [];
    const pageHost: ScopedRevisionHost<"pageRevision"> = {
      pageRevision: pageStore((label) => updates.push(label), "host"),
      async $transaction(callback) {
        return callback({});
      },
    };
    const pages = revisionServiceFor("pageRevision", pageHost, messages);

    await expect(
      pages.persistSnippetSnapshot({
        snippetId: "snippet-1",
        authorId: "user-1",
        snapshot: {
          name: "Header",
          location: "HEADER",
          content: "<script>a()</script>",
          priority: null,
          scopeType: "ALL_PAGES",
          pageIds: [],
          triggerType: null,
          triggerConfig: null,
          maxDisplays: null,
          displayResetDays: null,
        } satisfies SnippetSnapshot,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Snippet revisions are not used by Pages",
    });

    const snippetHost: ScopedRevisionHost<"snippetRevision"> = {
      snippetRevision: {
        findFirst: async () => null,
        findUnique: async () => null as SnippetRevisionRecord | null,
        create: async () => {
          throw new Error("não deveria gravar");
        },
      },
      async $transaction(callback) {
        return callback({});
      },
    };
    const scripts = revisionServiceFor("snippetRevision", snippetHost, {
      fail,
      unavailable: "Snippet revision store is unavailable",
      unused: "Page revisions are not used by Custom Code",
    });

    await expect(
      scripts.persistPageSnapshot({
        pageId: "page-1",
        authorId: "user-1",
        snapshot: pageSnapshot,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Page revisions are not used by Custom Code",
    });
    expect(updates).toEqual([]);
  });

  it("grava o pin dentro da transação serializável, pela loja do tx", async () => {
    const updates: string[] = [];
    const isolation: Array<string | undefined> = [];
    const host: ScopedRevisionHost<"pageRevision"> = {
      pageRevision: pageStore((label) => updates.push(label), "host"),
      async $transaction(callback, options) {
        isolation.push(options?.isolationLevel);
        return callback({
          pageRevision: pageStore((label) => updates.push(label), "tx"),
        });
      },
    };
    const service = revisionServiceFor("pageRevision", host, messages);

    const pinned = await service.setPageRevisionPinned({
      pageId: "page-1",
      revisionId: "rev-1",
      pinned: true,
    });

    expect(pinned.pinned).toBe(true);
    expect(isolation).toEqual(["Serializable"]);
    expect(updates).toEqual(["tx"]);
  });

  it("falha com a mensagem do módulo quando o tx não traz a loja", async () => {
    const host: ScopedRevisionHost<"pageRevision"> = {
      pageRevision: pageStore(() => undefined, "host"),
      async $transaction(callback) {
        return callback({});
      },
    };
    const service = revisionServiceFor("pageRevision", host, messages);

    await expect(
      service.setPageRevisionPinned({
        pageId: "page-1",
        revisionId: "rev-1",
        pinned: true,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "Page revision store is unavailable",
    });
  });
});
