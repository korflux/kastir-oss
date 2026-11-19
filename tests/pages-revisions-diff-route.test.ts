/**
 * Testes de rota de `GET /api/admin/pages/[pageId]/revisions/diff`.
 *
 * O que está sob prova: a fronteira HTTP da comparação de versões de uma página
 * (sessão, papel, escopo da revisão ao recurso da URL, validação da query,
 * envelope de erro e corpo do caminho feliz). O `RevisionService` é o real,
 * ligado a um store em memória no lugar do Prisma, para que o anti-IDOR seja
 * provado pelo código de produção e não por um mock que já devolve 404.
 *
 * Seções deste arquivo:
 *   1. Dublês e fixtures (sessão, páginas, revisões, store em memória).
 *   2. Autenticação e papel.
 *   3. Anti-IDOR (revisão de outro recurso).
 *   4. Validação da query (400 VALIDATION_ERROR).
 *   5. Envelope de erro (404 de página, 500 genérico sem vazar detalhe).
 *   6. Caminho feliz (revisão -> revisão e revisão -> rascunho).
 *
 * Contrato observado hoje (não é decisão deste arquivo):
 *   - O envelope das rotas admin é `{ error, code }`, não `{ code, message }`.
 *     O 401 de sessão ausente é `{ error: "Unauthorized" }`, sem `code`.
 *   - Esta rota é só leitura e não filtra por papel: MASTER, ADMIN e EDITOR
 *     (todos com Pages e Scripts no menu) passam. Papel fora desse conjunto
 *     faz `getPageApiContext` devolver null, e a resposta é 401, não 403
 *     (o 403 de papel inválido existe só nas rotas de mutação).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, getPage, pageRevisionFindUnique } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPage: vi.fn(),
  pageRevisionFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/prisma", () => ({
  prisma: { pageRevision: { findUnique: pageRevisionFindUnique } },
}));
vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: { getPage },
}));

import { GET } from "@/app/api/admin/pages/[pageId]/revisions/diff/route";
import { visibleMenuItems } from "@/lib/Modules/Panel/Permissions";
import { PagesDomainError } from "@/lib/Modules/Pages/Types";
import type { PageRevisionRecord } from "@/lib/Modules/Revisions/Types";

/* -------------------------------------------------------------------------- */
/* 1. Dublês e fixtures                                                        */
/* -------------------------------------------------------------------------- */

const PAGE_ID = "page-a";
const OTHER_PAGE_ID = "page-b";

/** Marcador que jamais pode aparecer numa resposta sobre a página A. */
const FOREIGN_SECRET = "SEGREDO-DA-OUTRA-PAGINA";

const FROM_CONTENT = "<h1>A</h1>\n<p>old</p>\n<footer>x</footer>\n";
const TO_CONTENT = "<h1>A</h1>\n<footer>x</footer>\n<p>new</p>\n";
const DRAFT_CONTENT = "<h1>A</h1>\n<p>rascunho</p>\n";

const SESSIONS = {
  MASTER: { user: { id: "user-1", role: "ADMIN", isMaster: true } },
  ADMIN: { user: { id: "user-1", role: "ADMIN", isMaster: false } },
  EDITOR: { user: { id: "user-1", role: "EDITOR", isMaster: false } },
} as const;

function revision(
  id: string,
  pageId: string,
  content: string,
): PageRevisionRecord {
  return {
    id,
    pageId,
    authorId: "author-1",
    fingerprint: `fingerprint-${id}`,
    pinned: false,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    title: "Landing",
    slug: "landing",
    content,
    seoTitle: null,
    seoDescription: null,
    seoKeyword: null,
    folderId: "folder-1",
  };
}

/** Página como `pageService.getPage` a devolve: só os campos que a rota lê. */
function draftPage(overrides: Partial<{ title: string }> = {}) {
  return {
    id: PAGE_ID,
    title: "Landing",
    slug: "landing",
    content: DRAFT_CONTENT,
    seoTitle: null,
    seoDescription: null,
    seoKeyword: null,
    folderId: "folder-1",
    ...overrides,
  };
}

/** Store em memória: o `findUnique` não filtra por página, como o do Prisma. */
function seedRevisions(records: PageRevisionRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  pageRevisionFindUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null,
  );
}

function callDiff(query: string, pageId: string = PAGE_ID) {
  return GET(
    new Request(
      `http://localhost/api/admin/pages/${pageId}/revisions/diff${query}`,
    ),
    { params: Promise.resolve({ pageId }) },
  );
}

/** Lê status e corpo cru uma única vez, para checar vazamento no texto bruto. */
async function readResponse(response: Response) {
  const raw = await response.text();
  return { status: response.status, raw, body: JSON.parse(raw) as unknown };
}

describe("GET /api/admin/pages/[pageId]/revisions/diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue(SESSIONS.ADMIN);
    getPage.mockResolvedValue(draftPage());
    seedRevisions([
      revision("rev-a", PAGE_ID, FROM_CONTENT),
      revision("rev-b", PAGE_ID, TO_CONTENT),
      revision("rev-foreign", OTHER_PAGE_ID, `<h1>${FOREIGN_SECRET}</h1>\n`),
    ]);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Autenticação e papel                                                   */
  /* ------------------------------------------------------------------------ */

  describe("autenticação e papel", () => {
    it("recusa com 401 quando não há sessão e não consulta página nem revisão", async () => {
      getSession.mockResolvedValue(null);

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b"),
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
      expect(getPage).not.toHaveBeenCalled();
      expect(pageRevisionFindUnique).not.toHaveBeenCalled();
    });

    it("recusa com 401 quando a sessão não traz o id do usuário", async () => {
      getSession.mockResolvedValue({ user: { role: "ADMIN" } });

      const response = await callDiff("?from=rev-a&to=rev-b");

      expect(response.status).toBe(401);
      expect(getPage).not.toHaveBeenCalled();
      expect(pageRevisionFindUnique).not.toHaveBeenCalled();
    });

    it("trata papel desconhecido como sem contexto de painel (401) e não consulta nada", async () => {
      getSession.mockResolvedValue({
        user: { id: "user-1", role: "OWNER", isMaster: false },
      });

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b"),
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
      expect(getPage).not.toHaveBeenCalled();
      expect(pageRevisionFindUnique).not.toHaveBeenCalled();
    });

    it.each(["MASTER", "ADMIN", "EDITOR"] as const)(
      "libera %s, papel com Pages no menu (leitura de diff é aberta ao painel)",
      async (role) => {
        // Premissa vinda de Panel/Permissions: se Pages deixar de ser do papel,
        // a rota precisa ganhar um 403 e este teste deve mudar junto.
        expect(visibleMenuItems(role).map((item) => item.key)).toContain(
          "pages",
        );
        getSession.mockResolvedValue(SESSIONS[role]);

        const response = await callDiff("?from=rev-a&to=rev-b");

        expect(response.status).toBe(200);
      },
    );
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Anti-IDOR                                                              */
  /* ------------------------------------------------------------------------ */

  describe("anti-IDOR: revisão de outra página", () => {
    const notFound = {
      error: "Revision was not found",
      code: "NOT_FOUND",
    };

    it("recusa com 404 quando `from` pertence a outra página, sem vazar o conteúdo", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-foreign&to=rev-b"),
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound);
      expect(response.raw).not.toContain(FOREIGN_SECRET);
      // A revisão alheia foi de fato lida; quem a recusou foi o escopo por página.
      expect(pageRevisionFindUnique).toHaveBeenCalledWith({
        where: { id: "rev-foreign" },
      });
    });

    it("recusa com 404 quando `to` pertence a outra página, sem vazar o conteúdo", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-foreign"),
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound);
      expect(response.raw).not.toContain(FOREIGN_SECRET);
      expect(pageRevisionFindUnique).toHaveBeenCalledWith({
        where: { id: "rev-foreign" },
      });
    });

    it("recusa `from` de outra página também na comparação com o rascunho", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-foreign&to=draft"),
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound);
      expect(response.raw).not.toContain(FOREIGN_SECRET);
    });

    it("responde igual para revisão alheia e revisão inexistente (sem oráculo de existência)", async () => {
      const foreign = await readResponse(
        await callDiff("?from=rev-foreign&to=rev-b"),
      );
      const missing = await readResponse(
        await callDiff("?from=rev-inexistente&to=rev-b"),
      );

      expect(missing.status).toBe(404);
      expect(missing).toEqual(foreign);
    });

    it("controle: o 404 vem do escopo por página e o marcador de vazamento é detectável", async () => {
      // Mesmo conteúdo, mas agora de uma revisão da própria página: é comparado.
      seedRevisions([
        revision("rev-a", PAGE_ID, FROM_CONTENT),
        revision("rev-own", PAGE_ID, `<h1>${FOREIGN_SECRET}</h1>\n`),
      ]);

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-own"),
      );

      expect(response.status).toBe(200);
      expect(response.raw).toContain(FOREIGN_SECRET);
    });

    it("usa a revisão só dentro da página da URL: a página alheia não vira a página A", async () => {
      // A URL aponta a página B, mas a revisão A pertence à página A: 404.
      getPage.mockResolvedValue({ ...draftPage(), id: OTHER_PAGE_ID });

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b", OTHER_PAGE_ID),
      );

      expect(getPage).toHaveBeenCalledWith(OTHER_PAGE_ID);
      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Validação da query                                                     */
  /* ------------------------------------------------------------------------ */

  describe("parâmetros inválidos", () => {
    it.each([
      ["sem nenhum parâmetro", ""],
      ["sem `to`", "?from=rev-a"],
      ["sem `from`", "?to=rev-b"],
      ["`from` vazio", "?from=&to=rev-b"],
      ["`from` só com espaços", "?from=%20%20&to=rev-b"],
      ["`to` acima de 200 caracteres", `?from=rev-a&to=${"x".repeat(201)}`],
      ["campo de controle `role`", "?from=rev-a&to=rev-b&role=MASTER"],
      ["campo extra `authorId`", "?from=rev-a&to=rev-b&authorId=attacker"],
    ])(
      "recusa com 400 VALIDATION_ERROR: %s",
      async (_caso: string, query: string) => {
        const response = await readResponse(await callDiff(query));

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          error: "Invalid revision query",
          code: "VALIDATION_ERROR",
        });
        expect(pageRevisionFindUnique).not.toHaveBeenCalled();
      },
    );

    it("recusa com 400 um rascunho que não passa no schema de snapshot", async () => {
      getPage.mockResolvedValue(draftPage({ title: "" }));

      const response = await readResponse(
        await callDiff("?from=rev-a&to=draft"),
      );

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: "Invalid revision",
        code: "VALIDATION_ERROR",
      });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Envelope de erro                                                       */
  /* ------------------------------------------------------------------------ */

  describe("envelope de erro", () => {
    it("traduz página inexistente em 404 NOT_FOUND e não consulta revisões", async () => {
      getPage.mockRejectedValue(
        new PagesDomainError("NOT_FOUND", "Page was not found"),
      );

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b", "page-inexistente"),
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: "Page was not found",
        code: "NOT_FOUND",
      });
      expect(pageRevisionFindUnique).not.toHaveBeenCalled();
    });

    it("devolve 500 INTERNAL_ERROR genérico sem vazar o detalhe da falha do banco", async () => {
      pageRevisionFindUnique.mockRejectedValue(
        new Error("connect ECONNREFUSED postgres://kastir:senha-do-banco@db"),
      );

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b"),
      );

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: "Unable to complete the revision operation",
        code: "INTERNAL_ERROR",
      });
      expect(response.raw).not.toContain("senha-do-banco");
      expect(response.raw).not.toContain("ECONNREFUSED");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Caminho feliz                                                          */
  /* ------------------------------------------------------------------------ */

  describe("caminho feliz", () => {
    it("compara duas revisões da página e devolve só as linhas do diff", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b"),
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        lines: [
          { kind: "unchanged", marker: " ", text: "<h1>A</h1>" },
          { kind: "removed", marker: "-", text: "<p>old</p>" },
          { kind: "unchanged", marker: " ", text: "<footer>x</footer>" },
          { kind: "added", marker: "+", text: "<p>new</p>" },
        ],
      });
      // Nada além de `lines`: sem autor, fingerprint nem snapshot inteiro.
      expect(Object.keys(response.body as object)).toEqual(["lines"]);
      expect(response.raw).not.toContain("author-1");
      expect(response.raw).not.toContain("fingerprint-");
      expect(pageRevisionFindUnique).toHaveBeenNthCalledWith(1, {
        where: { id: "rev-a" },
      });
      expect(pageRevisionFindUnique).toHaveBeenNthCalledWith(2, {
        where: { id: "rev-b" },
      });
      expect(getPage).toHaveBeenCalledWith(PAGE_ID);
    });

    it("compara a revisão com o rascunho atual quando `to=draft`", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-a&to=draft"),
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        lines: [
          { kind: "unchanged", marker: " ", text: "<h1>A</h1>" },
          { kind: "removed", marker: "-", text: "<p>old</p>" },
          { kind: "removed", marker: "-", text: "<footer>x</footer>" },
          { kind: "added", marker: "+", text: "<p>rascunho</p>" },
        ],
      });
      // O rascunho vem da página, não do store de revisões: só `from` é lida.
      expect(pageRevisionFindUnique).toHaveBeenCalledTimes(1);
      expect(pageRevisionFindUnique).toHaveBeenCalledWith({
        where: { id: "rev-a" },
      });
    });
  });
});
