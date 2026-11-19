import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  listSnippets,
  listScopePages,
  createSnippet,
  updateSnippet,
  publishSnippet,
  duplicateSnippet,
  getScopeSelectors,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  listSnippets: vi.fn(),
  listScopePages: vi.fn(),
  createSnippet: vi.fn(),
  updateSnippet: vi.fn(),
  publishSnippet: vi.fn(),
  duplicateSnippet: vi.fn(),
  getScopeSelectors: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
// O serviço real só entra nos testes de `pageIds` (a classe vem do módulo original); prisma e
// fila ficam simulados.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));
vi.mock("@/lib/Modules/CustomCode/Service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/Modules/CustomCode/Service")
  >()),
  customCodeService: {
    listSnippets,
    listScopePages,
    createSnippet,
    updateSnippet,
    publishSnippet,
    duplicateSnippet,
    getScopeSelectors,
  },
}));

import { GET, POST } from "@/app/api/admin/custom-code/route";
import { PUT as update } from "@/app/api/admin/custom-code/[snippetId]/route";
import { POST as publish } from "@/app/api/admin/custom-code/[snippetId]/publish/route";
import { POST as duplicate } from "@/app/api/admin/custom-code/[snippetId]/duplicate/route";
import { GET as listPages } from "@/app/api/admin/custom-code/pages/route";
import { GET as listSelectors } from "@/app/api/admin/custom-code/[snippetId]/selectors/route";
import {
  SCOPE_PAGE_IDS_INVALID_MESSAGE,
  SCOPE_PAGE_IDS_MAX,
} from "@/lib/Modules/CustomCode/Schema";
import { CustomCodeService } from "@/lib/Modules/CustomCode/Service";
import { CustomCodeDomainError } from "@/lib/Modules/CustomCode/Types";
import { isOptimisticSaveConflict } from "@/lib/Modules/Revisions/Components/revisionEditorState";
import { contentSha256 } from "@/lib/Modules/Shared/ContentPatch";

const params = Promise.resolve({ snippetId: "snippet-id" });

/** cuid sintético válido (`c` + 24 alfanuméricos), o formato do `Page.id` do Prisma. */
const cuid = (n: number) => `c${String(n).padStart(24, "0")}`;

describe("admin custom code API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    getSession.mockResolvedValue({
      user: { id: "user-id", role: "ADMIN", isMaster: true },
    });
    listSnippets.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    listScopePages.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    createSnippet.mockResolvedValue({ id: "snippet-id", status: "DRAFT" });
    updateSnippet.mockResolvedValue({ id: "snippet-id", name: "Analytics" });
    publishSnippet.mockResolvedValue({ id: "snippet-id", status: "PUBLISHED" });
    duplicateSnippet.mockResolvedValue({
      id: "copy-id",
      name: "Tag-copia",
      status: "DRAFT",
    });
    getScopeSelectors.mockResolvedValue([]);
  });

  it("requires an authenticated panel session", async () => {
    getSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/admin/custom-code"),
    );

    expect(response.status).toBe(401);
  });

  it("lists with stable pagination filters", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/admin/custom-code?search=analytics&status=PUBLISHED&location=HEADER&page=2&pageSize=10",
      ),
    );

    expect(response.status).toBe(200);
    expect(listSnippets).toHaveBeenCalledWith({
      search: "analytics",
      status: "PUBLISHED",
      location: "HEADER",
      includeDeleted: false,
      page: 2,
      pageSize: 10,
    });
  });

  it("lists only the page selector DTO through its paginated endpoint", async () => {
    listScopePages.mockResolvedValue({
      items: [{ id: "page-id", title: "Landing", slug: "landing" }],
      total: 1,
      page: 1,
      pageSize: 25,
    });

    const response = await listPages(
      new Request(
        "http://localhost/api/admin/custom-code/pages?q=landing&page=1&pageSize=25",
      ),
    );

    expect(response.status).toBe(200);
    expect(listScopePages).toHaveBeenCalledWith({
      search: "landing",
      page: 1,
      pageSize: 25,
    });
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: "page-id", slug: "landing" }],
    });
  });

  it("does not trust client actor or status fields when creating", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/custom-code", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify({
          name: "Analytics",
          location: "HEADER",
          content: "<script>track();</script>",
          status: "PUBLISHED",
          userId: "attacker",
          role: "MASTER",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createSnippet).toHaveBeenCalledWith("user-id", {
      name: "Analytics",
      location: "HEADER",
      content: "<script>track();</script>",
    });
  });

  it("uses the route id and authenticated actor for publish and duplicate", async () => {
    const publishResponse = await publish(
      new Request("http://localhost", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
      { params },
    );
    const duplicateResponse = await duplicate(
      new Request("http://localhost", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
      { params },
    );

    expect(publishResponse.status).toBe(200);
    expect(publishSnippet).toHaveBeenCalledWith("user-id", "snippet-id");
    expect(duplicateResponse.status).toBe(201);
    expect(duplicateSnippet).toHaveBeenCalledWith("user-id", "snippet-id");
  });

  it("protects quick edit with the authenticated role and trusted origin", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "owner-id", role: "OWNER", isMaster: false },
    });
    const invalidRoleResponse = await update(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ name: "Analytics" }),
        headers: { origin: "http://localhost:3000" },
      }),
      { params },
    );

    expect(invalidRoleResponse.status).toBe(403);

    getSession.mockResolvedValueOnce({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });
    const crossOriginResponse = await update(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ name: "Analytics" }),
        headers: { origin: "https://attacker.example" },
      }),
      { params },
    );

    expect(crossOriginResponse.status).toBe(403);
    expect(updateSnippet).not.toHaveBeenCalled();
  });

  it("requires an authenticated session for the selectors endpoint", async () => {
    getSession.mockResolvedValue(null);

    const response = await listSelectors(new Request("http://localhost"), {
      params,
    });

    expect(response.status).toBe(401);
    expect(getScopeSelectors).not.toHaveBeenCalled();
  });

  it("returns the aggregated selector candidates for the route's snippet id", async () => {
    getScopeSelectors.mockResolvedValue(["#buy", ".cta", "#hero"]);

    const response = await listSelectors(new Request("http://localhost"), {
      params,
    });

    expect(response.status).toBe(200);
    expect(getScopeSelectors).toHaveBeenCalledWith("snippet-id");
    await expect(response.json()).resolves.toEqual({
      selectors: ["#buy", ".cta", "#hero"],
    });
  });

  it("returns an empty selector list for a script without scope pages", async () => {
    const response = await listSelectors(new Request("http://localhost"), {
      params,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ selectors: [] });
  });

  it("returns 503 when the service reports a queue failure", async () => {
    publishSnippet.mockRejectedValueOnce(
      new CustomCodeDomainError(
        "QUEUE_FAILED",
        "The snippet changed, but its page rebuild could not be queued",
      ),
    );

    const response = await publish(
      new Request("http://localhost", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
      { params },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "QUEUE_FAILED",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* pageIds: recusa na rota, com o serviço real (o schema roda de verdade)      */
/* -------------------------------------------------------------------------- */

describe("admin custom code API — pageIds do escopo", () => {
  /** Banco simulado mínimo: a recusa acontece antes dele; o lookup de páginas prova o dedupe. */
  const database = {
    page: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  };

  const scriptBody = {
    name: "Analytics",
    location: "HEADER",
    content: "<script>track();</script>",
    scopeType: "SPECIFIC_PAGES",
  };

  const post = (payload: unknown) =>
    POST(
      new Request("http://localhost/api/admin/custom-code", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify(payload),
      }),
    );

  const put = (payload: unknown) =>
    update(
      new Request("http://localhost", {
        method: "PUT",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify(payload),
      }),
      { params },
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    getSession.mockResolvedValue({
      user: { id: "user-id", role: "ADMIN", isMaster: true },
    });
    const service = new CustomCodeService(
      database as never,
      { add: vi.fn() } as never,
    );
    createSnippet.mockImplementation((userId, input, audit) =>
      service.createSnippet(userId, input, audit),
    );
    updateSnippet.mockImplementation((userId, input, audit) =>
      service.updateSnippet(userId, input, audit),
    );
  });

  it("recusa id fora do cuid e 1001 ids com 400 VALIDATION_ERROR e mensagem fixa, sem tocar no banco", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const overLimit = Array.from({ length: SCOPE_PAGE_IDS_MAX + 1 }, (_, i) =>
      cuid(i + 1),
    );

    for (const pageIds of [["page-1"], [cuid(1), hostile], overLimit]) {
      for (const response of [
        await post({ ...scriptBody, pageIds }),
        await put({ pageIds }),
      ]) {
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toEqual({
          error: SCOPE_PAGE_IDS_INVALID_MESSAGE,
          code: "VALIDATION_ERROR",
        });
        // Sem eco do payload na mensagem.
        expect(JSON.stringify(body)).not.toMatch(/onerror|page-1/);
      }
    }

    expect(database.page.findMany).not.toHaveBeenCalled();
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("entrega ids aparados e sem repetição ao lookup de páginas", async () => {
    // O lookup devolve vazio, então a rota responde com o erro de página inexistente; o que
    // importa aqui é que o `where` já chegou normalizado (uma ocorrência por id).
    const response = await post({
      ...scriptBody,
      pageIds: [` ${cuid(2)} `, cuid(2), cuid(1), cuid(1)],
    });

    expect(response.status).toBe(400);
    expect(database.page.findMany).toHaveBeenCalledWith({
      where: { id: { in: [cuid(2), cuid(1)] } },
    });
  });

  it("aceita exatamente o teto de ids: a recusa passa a ser só a de página inexistente", async () => {
    const atLimit = Array.from({ length: SCOPE_PAGE_IDS_MAX }, (_, i) =>
      cuid(i + 1),
    );

    const response = await post({ ...scriptBody, pageIds: atLimit });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "The snippet scope contains an invalid or deleted page",
    });
    expect(database.page.findMany).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Versão por hash do conteúdo na rota do painel, com o serviço real           */
/* -------------------------------------------------------------------------- */

describe("admin custom code API — versão por hash do conteúdo", () => {
  const storedContent = "<script>window.fromMcp = true;</script>";

  /** Uma linha em memória, o suficiente para o Save: a trava só registra a chamada. */
  function createDatabase() {
    const row = {
      id: "snippet-id",
      name: "Analytics",
      location: "HEADER",
      content: storedContent,
      status: "DRAFT",
      priority: null,
      scopeType: "ALL_PAGES",
      scopedPages: [],
      triggerType: null,
      triggerConfig: null,
      maxDisplays: null,
      displayResetDays: null,
      publishedRevisionId: null,
      deletedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const database = {
      snippet: {
        findUnique: vi.fn(async () => row),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
          Object.assign(row, data, { updatedAt: new Date() }),
        ),
      },
      snippetPageScope: { deleteMany: vi.fn(), createMany: vi.fn() },
      page: { findMany: vi.fn(async () => []) },
      logEntry: { create: vi.fn(async () => ({ id: "log-id" })) },
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(database),
      ),
    };
    return { row, database };
  }

  const put = (payload: unknown) =>
    update(
      new Request("http://localhost", {
        method: "PUT",
        headers: { origin: "http://localhost:3000" },
        body: JSON.stringify(payload),
      }),
      { params },
    );

  let fixture: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    getSession.mockResolvedValue({
      user: { id: "user-id", role: "ADMIN", isMaster: true },
    });
    fixture = createDatabase();
    const service = new CustomCodeService(
      fixture.database as never,
      { add: vi.fn() } as never,
    );
    updateSnippet.mockImplementation((userId, input, audit) =>
      service.updateSnippet(userId, input, audit),
    );
  });

  it("keeps answering 409 with the message the editor treats as a version conflict when the panel saves a stale expectedUpdatedAt, keeping the other draft", async () => {
    const response = await put({
      content: "<script>window.fromPanel = true;</script>",
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("CONFLICT");
    expect(isOptimisticSaveConflict(body.code, body.error)).toBe(true);
    expect(fixture.row.content).toBe(storedContent);
    expect(fixture.database.snippet.update).not.toHaveBeenCalled();
  });

  it("A5: answers 409 CONFLICT with the current hash for a stale expectedContentSha256, recognised by the editor, and keeps the draft", async () => {
    const response = await put({
      content: "<script>window.fromPanel = true;</script>",
      expectedContentSha256: contentSha256("<script>old();</script>"),
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("CONFLICT");
    expect(body.error).toContain(
      `current contentSha256: ${contentSha256(storedContent)}`,
    );
    expect(isOptimisticSaveConflict(body.code, body.error)).toBe(true);
    expect(fixture.row.content).toBe(storedContent);
    expect(fixture.database.snippet.update).not.toHaveBeenCalled();
  });

  it("saves when expectedContentSha256 matches, and answers 400 for a malformed hash without opening a transaction", async () => {
    const malformed = await put({
      content: "<script>x();</script>",
      expectedContentSha256: "not-a-hash",
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(fixture.database.$transaction).not.toHaveBeenCalled();

    const saved = await put({
      content: "<script>x();</script>",
      expectedContentSha256: contentSha256(storedContent),
    });
    expect(saved.status).toBe(200);
    expect(fixture.row.content).toBe("<script>x();</script>");
  });
});
