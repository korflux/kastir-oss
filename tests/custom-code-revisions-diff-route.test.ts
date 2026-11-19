/**
 * Testes de rota de `GET /api/admin/custom-code/[snippetId]/revisions/diff`.
 *
 * O que está sob prova: a fronteira HTTP da comparação de versões de um script
 * (sessão, papel, escopo da revisão ao recurso da URL, validação da query,
 * envelope de erro e corpo do caminho feliz). O `RevisionService` é o real,
 * ligado a um store em memória no lugar do Prisma, para que o anti-IDOR seja
 * provado pelo código de produção e não por um mock que já devolve 404.
 *
 * Seções deste arquivo:
 *   1. Dublês e fixtures (sessão, scripts, revisões, store em memória).
 *   2. Autenticação e papel.
 *   3. Anti-IDOR (revisão de outro recurso).
 *   4. Validação da query (400 VALIDATION_ERROR).
 *   5. Envelope de erro (404 de script, 500 genérico sem vazar detalhe).
 *   6. Caminho feliz (revisão -> revisão e revisão -> rascunho).
 *
 * Contrato observado hoje (não é decisão deste arquivo):
 *   - O envelope das rotas admin é `{ error, code }`, não `{ code, message }`.
 *     O 401 de sessão ausente é `{ error: "Unauthorized" }`, sem `code`.
 *   - Esta rota é só leitura e não filtra por papel: MASTER, ADMIN e EDITOR
 *     (todos com Scripts no menu) passam. Papel fora desse conjunto faz
 *     `getCustomCodeApiContext` devolver null, e a resposta é 401, não 403
 *     (o 403 de papel inválido existe só nas rotas de mutação).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, getSnippet, snippetRevisionFindUnique } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    getSnippet: vi.fn(),
    snippetRevisionFindUnique: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/prisma", () => ({
  prisma: { snippetRevision: { findUnique: snippetRevisionFindUnique } },
}));
vi.mock("@/lib/Modules/CustomCode/Service", () => ({
  customCodeService: { getSnippet },
}));

import { GET } from "@/app/api/admin/custom-code/[snippetId]/revisions/diff/route";
import { CustomCodeDomainError } from "@/lib/Modules/CustomCode/Types";
import { visibleMenuItems } from "@/lib/Modules/Panel/Permissions";
import type { SnippetRevisionRecord } from "@/lib/Modules/Revisions/Types";

/* -------------------------------------------------------------------------- */
/* 1. Dublês e fixtures                                                        */
/* -------------------------------------------------------------------------- */

const SNIPPET_ID = "snippet-a";
const OTHER_SNIPPET_ID = "snippet-b";

/** Marcador que jamais pode aparecer numa resposta sobre o script A. */
const FOREIGN_SECRET = "SEGREDO-DO-OUTRO-SCRIPT";

const FROM_CONTENT = 'init();\nconsole.log("old");\ntrack();\n';
const TO_CONTENT = 'init();\ntrack();\nconsole.log("new");\n';
const DRAFT_CONTENT = 'init();\nconsole.log("rascunho");\n';

const SESSIONS = {
  MASTER: { user: { id: "user-1", role: "ADMIN", isMaster: true } },
  ADMIN: { user: { id: "user-1", role: "ADMIN", isMaster: false } },
  EDITOR: { user: { id: "user-1", role: "EDITOR", isMaster: false } },
} as const;

function revision(
  id: string,
  snippetId: string,
  content: string,
): SnippetRevisionRecord {
  return {
    id,
    snippetId,
    authorId: "author-1",
    fingerprint: `fingerprint-${id}`,
    pinned: false,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    name: "Analytics",
    location: "HEADER",
    content,
    priority: null,
    scopeType: "ALL_PAGES",
    pageIds: [],
    triggerType: null,
    triggerConfig: null,
    maxDisplays: null,
    displayResetDays: null,
  };
}

/** Script como `customCodeService.getSnippet` o devolve: só o que a rota lê. */
function draftSnippet(overrides: Partial<{ name: string }> = {}) {
  return {
    id: SNIPPET_ID,
    name: "Analytics",
    location: "HEADER",
    content: DRAFT_CONTENT,
    priority: null,
    scopeType: "ALL_PAGES",
    pageIds: [],
    triggerType: null,
    triggerConfig: null,
    maxDisplays: null,
    displayResetDays: null,
    ...overrides,
  };
}

/** Store em memória: o `findUnique` não filtra por script, como o do Prisma. */
function seedRevisions(records: SnippetRevisionRecord[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  snippetRevisionFindUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null,
  );
}

function callDiff(query: string, snippetId: string = SNIPPET_ID) {
  return GET(
    new Request(
      `http://localhost/api/admin/custom-code/${snippetId}/revisions/diff${query}`,
    ),
    { params: Promise.resolve({ snippetId }) },
  );
}

/** Lê status e corpo cru uma única vez, para checar vazamento no texto bruto. */
async function readResponse(response: Response) {
  const raw = await response.text();
  return { status: response.status, raw, body: JSON.parse(raw) as unknown };
}

describe("GET /api/admin/custom-code/[snippetId]/revisions/diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue(SESSIONS.ADMIN);
    getSnippet.mockResolvedValue(draftSnippet());
    seedRevisions([
      revision("rev-a", SNIPPET_ID, FROM_CONTENT),
      revision("rev-b", SNIPPET_ID, TO_CONTENT),
      revision(
        "rev-foreign",
        OTHER_SNIPPET_ID,
        `console.log("${FOREIGN_SECRET}");\n`,
      ),
    ]);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Autenticação e papel                                                   */
  /* ------------------------------------------------------------------------ */

  describe("autenticação e papel", () => {
    it("recusa com 401 quando não há sessão e não consulta script nem revisão", async () => {
      getSession.mockResolvedValue(null);

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b"),
      );

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
      expect(getSnippet).not.toHaveBeenCalled();
      expect(snippetRevisionFindUnique).not.toHaveBeenCalled();
    });

    it("recusa com 401 quando a sessão não traz o id do usuário", async () => {
      getSession.mockResolvedValue({ user: { role: "ADMIN" } });

      const response = await callDiff("?from=rev-a&to=rev-b");

      expect(response.status).toBe(401);
      expect(getSnippet).not.toHaveBeenCalled();
      expect(snippetRevisionFindUnique).not.toHaveBeenCalled();
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
      expect(getSnippet).not.toHaveBeenCalled();
      expect(snippetRevisionFindUnique).not.toHaveBeenCalled();
    });

    it.each(["MASTER", "ADMIN", "EDITOR"] as const)(
      "libera %s, papel com Scripts no menu (leitura de diff é aberta ao painel)",
      async (role) => {
        // Premissa vinda de Panel/Permissions: se Scripts deixar de ser do
        // papel, a rota precisa ganhar um 403 e este teste deve mudar junto.
        expect(visibleMenuItems(role).map((item) => item.key)).toContain(
          "scripts",
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

  describe("anti-IDOR: revisão de outro script", () => {
    const notFound = {
      error: "Revision was not found",
      code: "NOT_FOUND",
    };

    it("recusa com 404 quando `from` pertence a outro script, sem vazar o conteúdo", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-foreign&to=rev-b"),
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound);
      expect(response.raw).not.toContain(FOREIGN_SECRET);
      // A revisão alheia foi de fato lida; quem a recusou foi o escopo por script.
      expect(snippetRevisionFindUnique).toHaveBeenCalledWith({
        where: { id: "rev-foreign" },
      });
    });

    it("recusa com 404 quando `to` pertence a outro script, sem vazar o conteúdo", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-foreign"),
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual(notFound);
      expect(response.raw).not.toContain(FOREIGN_SECRET);
      expect(snippetRevisionFindUnique).toHaveBeenCalledWith({
        where: { id: "rev-foreign" },
      });
    });

    it("recusa `from` de outro script também na comparação com o rascunho", async () => {
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

    it("controle: o 404 vem do escopo por script e o marcador de vazamento é detectável", async () => {
      // Mesmo conteúdo, mas agora de uma revisão do próprio script: é comparado.
      seedRevisions([
        revision("rev-a", SNIPPET_ID, FROM_CONTENT),
        revision("rev-own", SNIPPET_ID, `console.log("${FOREIGN_SECRET}");\n`),
      ]);

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-own"),
      );

      expect(response.status).toBe(200);
      expect(response.raw).toContain(FOREIGN_SECRET);
    });

    it("usa a revisão só dentro do script da URL: o script alheio não vira o script A", async () => {
      // A URL aponta o script B, mas a revisão A pertence ao script A: 404.
      getSnippet.mockResolvedValue({
        ...draftSnippet(),
        id: OTHER_SNIPPET_ID,
      });

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b", OTHER_SNIPPET_ID),
      );

      expect(getSnippet).toHaveBeenCalledWith(OTHER_SNIPPET_ID);
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
        expect(snippetRevisionFindUnique).not.toHaveBeenCalled();
      },
    );

    it("recusa com 400 um rascunho que não passa no schema de snapshot", async () => {
      getSnippet.mockResolvedValue(draftSnippet({ name: "" }));

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
    it("traduz script inexistente em 404 NOT_FOUND e não consulta revisões", async () => {
      getSnippet.mockRejectedValue(
        new CustomCodeDomainError("NOT_FOUND", "Snippet was not found"),
      );

      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b", "snippet-inexistente"),
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: "Snippet was not found",
        code: "NOT_FOUND",
      });
      expect(snippetRevisionFindUnique).not.toHaveBeenCalled();
    });

    it("devolve 500 INTERNAL_ERROR genérico sem vazar o detalhe da falha do banco", async () => {
      snippetRevisionFindUnique.mockRejectedValue(
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
    it("compara duas revisões do script e devolve só as linhas do diff", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-a&to=rev-b"),
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        lines: [
          { kind: "unchanged", marker: " ", text: "init();" },
          { kind: "removed", marker: "-", text: 'console.log("old");' },
          { kind: "unchanged", marker: " ", text: "track();" },
          { kind: "added", marker: "+", text: 'console.log("new");' },
        ],
      });
      // Nada além de `lines`: sem autor, fingerprint nem snapshot inteiro.
      expect(Object.keys(response.body as object)).toEqual(["lines"]);
      expect(response.raw).not.toContain("author-1");
      expect(response.raw).not.toContain("fingerprint-");
      expect(snippetRevisionFindUnique).toHaveBeenNthCalledWith(1, {
        where: { id: "rev-a" },
      });
      expect(snippetRevisionFindUnique).toHaveBeenNthCalledWith(2, {
        where: { id: "rev-b" },
      });
      expect(getSnippet).toHaveBeenCalledWith(SNIPPET_ID);
    });

    it("compara a revisão com o rascunho atual quando `to=draft`", async () => {
      const response = await readResponse(
        await callDiff("?from=rev-a&to=draft"),
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        lines: [
          { kind: "unchanged", marker: " ", text: "init();" },
          { kind: "removed", marker: "-", text: 'console.log("old");' },
          { kind: "removed", marker: "-", text: "track();" },
          { kind: "added", marker: "+", text: 'console.log("rascunho");' },
        ],
      });
      // O rascunho vem do script, não do store de revisões: só `from` é lida.
      expect(snippetRevisionFindUnique).toHaveBeenCalledTimes(1);
      expect(snippetRevisionFindUnique).toHaveBeenCalledWith({
        where: { id: "rev-a" },
      });
    });
  });
});
