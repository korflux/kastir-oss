/**
 * Jornada MCP do "voltar ao ar" (T7, fase versoes-e-publicacao).
 *
 * O switch do painel liga publicando o rascunho e, quando o servidor recusa
 * com INVALID_STATE "sem alteracao nao publicada", chama /activate. O MCP
 * ganha o mesmo caminho em `kastir_pages_activate` / `kastir_scripts_activate`.
 *
 * Estes testes usam um servidor MCP real (SDK + transporte em memoria) sobre
 * os servicos REAIS `PageService` e `CustomCodeService`, apenas com banco,
 * file store e fila falsos em memoria. Assim a jornada completa (descoberta,
 * escopo, confirmacao, servico, audit, envelope de erro) e exercitada de ponta
 * a ponta, sem mock do comportamento que a T7 promete.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Imports estaticos de proposito. O grafo pesado (tools de Pages/Scripts, servicos reais, SDK,
// guia e instrucoes) carrega na fase de coleta, que nao tem timeout por teste. Com `import()`
// dentro do teste, o primeiro teste pagava o carregamento a frio (centenas de ms sozinho,
// segundos com a suite concorrente) e estourava os 5 s. Esse estouro e a causa do vazamento de
// estado entre testes: o Vitest nao cancela o corpo de um teste que atingiu o timeout, entao o
// corpo "zumbi" seguia chamando publish/unpublish sobre `pageWorld`/`scriptWorld`, ja
// reiniciados pelo `beforeEach` do teste seguinte (sintoma: `revisions` com 2 itens em vez
// de 1, ou `store.write` chamado onde nao devia). Sem timeout, nao ha zumbi. Os servicos
// reais nao guardam estado de instancia, e o mundo falso e reiniciado a cada teste, entao
// compartilhar o grafo entre testes (o `vi.resetModules()` de tests/setup.ts nao afeta
// referencias ja importadas) e seguro. O `vi.mock` abaixo e icado acima destes imports.
// ponytail: a coleta nao tem timeout por arquivo, entao um import travado so cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import { GUIDE_TOPICS } from "@/lib/Modules/Mcp/Guide";
import { MCP_KASTIR_CONCEPTS } from "@/lib/Modules/Mcp/Instructions";
import type { McpScope } from "@/lib/Modules/Mcp/Scopes";
import {
  activateMcpPage,
  registerPageTools,
} from "@/lib/Modules/Mcp/Tools/Pages";
import {
  activateMcpScript,
  registerScriptTools,
} from "@/lib/Modules/Mcp/Tools/Scripts";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";

// ---------------------------------------------------------------------------
// Mundo falso de Pages: banco, revisoes, arquivos publicos e audit em memoria.
// Vive em vi.hoisted porque a factory do vi.mock abaixo roda antes dos imports.
// ---------------------------------------------------------------------------
const pageWorld = vi.hoisted(() => {
  type PageRow = {
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
  type RevisionRow = {
    id: string;
    pageId: string;
    authorId: string;
    fingerprint: string;
    pinned: boolean;
    createdAt: Date;
    title: string;
    slug: string;
    content: string;
    seoTitle: string | null;
    seoDescription: string | null;
    seoKeyword: string | null;
    folderId: string;
  };

  const now = new Date("2026-10-14T12:00:00.000Z");
  const pages: PageRow[] = [];
  const revisions: RevisionRow[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const files = new Map<string, string>();
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
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<PageRow>;
        }) => {
          const row = pages.find((candidate) => candidate.id === where.id);
          if (!row) throw new Error("missing page");
          Object.assign(row, data, { updatedAt: now });
          return { ...row };
        },
      ),
    },
    pageRevision: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { pageId?: string; fingerprint?: string };
        }) =>
          revisions.find(
            (row) =>
              (!where.pageId || row.pageId === where.pageId) &&
              (!where.fingerprint || row.fingerprint === where.fingerprint),
          ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          revisions.find((row) => row.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<RevisionRow, "id"> }) => {
        const row: RevisionRow = {
          ...data,
          id: `rev-${nextRevision++}`,
          pinned: false,
          createdAt: now,
        };
        revisions.push(row);
        return row;
      }),
    },
    logEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return { id: `log-${logs.length}` };
      }),
    },
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };

  // Arquivo publico por slug: publish grava, unpublish remove, activate regrava.
  const store = {
    read: vi.fn(async (slug: string) => files.get(slug) ?? null),
    write: vi.fn(async (slug: string, html: string) => {
      files.set(slug, html);
    }),
    remove: vi.fn(async (slug: string) => {
      files.delete(slug);
    }),
  };

  const compiler = async (page: { content: string }) =>
    `compiled:${page.content}`;

  /** Reinicia o mundo com uma unica pagina de rascunho, nunca publicada. */
  function reset() {
    pages.length = 0;
    revisions.length = 0;
    logs.length = 0;
    files.clear();
    nextRevision = 1;
    pages.push({
      id: "page-1",
      title: "Landing",
      slug: "landing",
      content: "<h1>Draft</h1>",
      seoTitle: "SEO",
      seoDescription: null,
      seoKeyword: null,
      status: "DRAFT",
      folderId: "base-id",
      authorId: "author-1",
      publishedRevisionId: null,
      publishedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    vi.clearAllMocks();
  }

  return { database, store, compiler, pages, revisions, logs, files, reset };
});

// ---------------------------------------------------------------------------
// Mundo falso de Scripts: banco, revisoes, fila de rebuild e audit em memoria.
// ---------------------------------------------------------------------------
const scriptWorld = vi.hoisted(() => {
  type SnippetRow = {
    id: string;
    name: string;
    location: "HEADER" | "BODY_START" | "BODY_END";
    content: string;
    status: "DRAFT" | "PUBLISHED";
    priority: number | null;
    scopeType: "ALL_PAGES" | "SPECIFIC_PAGES";
    scopedPages: Array<{ pageId: string }>;
    triggerType: null;
    triggerConfig: null;
    maxDisplays: null;
    displayResetDays: null;
    publishedRevisionId: string | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  type RevisionRow = Record<string, unknown> & {
    id: string;
    snippetId: string;
    fingerprint: string;
  };

  const snippets: SnippetRow[] = [];
  const revisions: RevisionRow[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let nextRevision = 1;
  const queue = { add: vi.fn(async () => ({ id: "job-id" })) };

  const database = {
    snippet: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          snippets.find((row) => row.id === where.id) ?? null,
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = snippets.find((candidate) => candidate.id === where.id);
          if (!row) throw new Error("missing snippet");
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        },
      ),
    },
    snippetRevision: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { snippetId?: string; fingerprint?: string };
        }) =>
          revisions.find(
            (row) =>
              (!where.snippetId || row.snippetId === where.snippetId) &&
              (!where.fingerprint || row.fingerprint === where.fingerprint),
          ) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          revisions.find((row) => row.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          id: `srev-${nextRevision++}`,
          pinned: false,
          createdAt: new Date("2026-10-14T12:00:00.000Z"),
        } as unknown as RevisionRow;
        revisions.push(row);
        return row;
      }),
    },
    // Paginas no ar que o rebuild do script precisa reconstruir.
    page: {
      findMany: vi.fn(async () => [
        { id: "page-1", status: "PUBLISHED", deletedAt: null },
      ]),
    },
    logEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return { id: `log-${logs.length}` };
      }),
    },
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };

  /** Reinicia o mundo com um unico script de rascunho, nunca publicado. */
  function reset() {
    snippets.length = 0;
    revisions.length = 0;
    logs.length = 0;
    nextRevision = 1;
    snippets.push({
      id: "script-1",
      name: "Analytics",
      location: "BODY_END",
      content: "<script>window.analytics = true;</script>",
      status: "DRAFT",
      priority: null,
      scopeType: "SPECIFIC_PAGES",
      scopedPages: [{ pageId: "page-1" }],
      triggerType: null,
      triggerConfig: null,
      maxDisplays: null,
      displayResetDays: null,
      publishedRevisionId: null,
      deletedAt: null,
      createdAt: new Date("2026-10-14T12:00:00.000Z"),
      updatedAt: new Date("2026-10-14T12:00:00.000Z"),
    });
    vi.clearAllMocks();
  }

  return { database, queue, snippets, revisions, logs, reset };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));
vi.mock("@/lib/Modules/Pages/FolderService", () => ({ folderService: {} }));
vi.mock("@/lib/Modules/Settings/Service", () => ({ settingsService: {} }));

// Servicos reais, instanciados sobre os mundos falsos acima.
vi.mock("@/lib/Modules/Pages/Service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/Modules/Pages/Service")>();
  return {
    ...actual,
    pageService: new actual.PageService(
      pageWorld.database as never,
      pageWorld.store as never,
      pageWorld.compiler,
    ),
  };
});
vi.mock("@/lib/Modules/CustomCode/Service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/Modules/CustomCode/Service")>();
  return {
    ...actual,
    customCodeService: new actual.CustomCodeService(
      scriptWorld.database as never,
      scriptWorld.queue as never,
    ),
  };
});

// ---------------------------------------------------------------------------
// Helpers de teste: contexto MCP, servidor em memoria e leitura do envelope.
// ---------------------------------------------------------------------------
const ALL_SCOPES: readonly McpScope[] = [
  "cms:read",
  "cms:pages:write",
  "cms:pages:publish",
  "cms:pages:unpublish",
  "cms:scripts:write",
  "cms:scripts:publish",
  "cms:scripts:unpublish",
];

const baseContext: McpToolContext = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN",
  scopes: ALL_SCOPES,
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

/** Sobe um servidor MCP real so com as tools de Pages e Scripts. */
async function connect(overrides: Partial<McpToolContext> = {}) {
  const context = { ...baseContext, ...overrides };
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  registerPageTools(server, context);
  registerScriptTools(server, context);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    context,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

type ToolBody = {
  ok?: true;
  summary?: string;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
};

/** Chama uma tool e devolve o envelope JSON ja decodificado. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; body: ToolBody }> {
  const result = await client.callTool({ name, arguments: args });
  const text =
    (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}";
  return { isError: result.isError === true, body: JSON.parse(text) };
}

beforeEach(() => {
  pageWorld.reset();
  scriptWorld.reset();
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
describe("kastir_pages_activate", () => {
  it("volta ao ar sem versao nova quando o rascunho e igual ao publicado", async () => {
    const { client, close } = await connect();
    const row = pageWorld.pages[0]!;

    // Liga como o painel: primeiro publish, que cria a unica versao.
    const first = await call(client, "kastir_pages_publish", {
      pageId: "page-1",
    });
    expect(first.isError).toBe(false);
    expect(pageWorld.revisions).toHaveLength(1);
    const liveRevisionId = row.publishedRevisionId;

    // Desliga: sai do ar, mas o ponteiro publicado fica.
    await call(client, "kastir_pages_unpublish", { pageId: "page-1" });
    expect(row.status).toBe("DRAFT");
    expect(row.publishedRevisionId).toBe(liveRevisionId);
    expect(pageWorld.files.has("landing")).toBe(false);

    // Publish agora e recusado: nada mudou desde a ultima versao. Era aqui que
    // a descricao antiga ("Activates if deactivated") enganava o agente.
    const refused = await call(client, "kastir_pages_publish", {
      pageId: "page-1",
    });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toEqual({
      code: "INVALID_STATE",
      message: "Page has no unpublished changes",
    });
    expect(row.status).toBe("DRAFT");
    expect(pageWorld.files.has("landing")).toBe(false);

    // Activate religa a versao publicada, sem criar versao nem tocar o ponteiro.
    const activated = await call(client, "kastir_pages_activate", {
      pageId: "page-1",
    });
    expect(activated.isError).toBe(false);
    expect(activated.body).toMatchObject({
      ok: true,
      summary:
        "Page page-1 is live on its published revision. Unpublished changes: no.",
      data: {
        id: "page-1",
        status: "PUBLISHED",
        activated: true,
        hasUnpublishedChanges: false,
        publishedRevisionId: liveRevisionId,
      },
    });
    expect(row.status).toBe("PUBLISHED");
    expect(row.publishedRevisionId).toBe(liveRevisionId);
    expect(pageWorld.revisions).toHaveLength(1);
    expect(pageWorld.files.get("landing")).toBe("compiled:<h1>Draft</h1>");

    // Idempotente: ativar de novo uma pagina ja no ar nao escreve nem audita.
    pageWorld.store.write.mockClear();
    const logsBefore = pageWorld.logs.length;
    const again = await call(client, "kastir_pages_activate", {
      pageId: "page-1",
    });
    expect(again.isError).toBe(false);
    expect(pageWorld.store.write).not.toHaveBeenCalled();
    expect(pageWorld.logs).toHaveLength(logsBefore);

    await close();
  });

  it("liga a versao publicada sem materializar o rascunho salvo", async () => {
    const { client, close } = await connect();
    const row = pageWorld.pages[0]!;
    await call(client, "kastir_pages_publish", { pageId: "page-1" });
    await call(client, "kastir_pages_unpublish", { pageId: "page-1" });
    // Rascunho salvo depois de sair do ar (o que kastir_pages_update faria).
    row.content = "<h1>Draft saved after going off</h1>";

    const activated = await call(client, "kastir_pages_activate", {
      pageId: "page-1",
    });

    expect(activated.body.summary).toContain("Unpublished changes: yes");
    expect(activated.body.data).toMatchObject({
      status: "PUBLISHED",
      hasUnpublishedChanges: true,
    });
    // O site serve a versao publicada; o rascunho continua so no rascunho.
    expect(pageWorld.files.get("landing")).toBe("compiled:<h1>Draft</h1>");
    expect(row.content).toBe("<h1>Draft saved after going off</h1>");
    expect(pageWorld.revisions).toHaveLength(1);
    // O summary identifica a pagina pelo id e nao carrega HTML.
    expect(JSON.stringify(activated.body)).not.toContain("Draft saved");

    await close();
  });

  it("recusa pagina nunca publicada com erro estavel e sem efeito", async () => {
    const { client, close } = await connect();

    const result = await call(client, "kastir_pages_activate", {
      pageId: "page-1",
    });

    expect(result.isError).toBe(true);
    expect(result.body).toEqual({
      error: {
        code: "INVALID_STATE",
        message: "Page has no published revision",
      },
    });
    expect(pageWorld.store.write).not.toHaveBeenCalled();
    expect(pageWorld.revisions).toHaveLength(0);
    expect(pageWorld.logs).toHaveLength(0);
    expect(pageWorld.pages[0]!.status).toBe("DRAFT");

    await close();
  });

  it("registra no audit quem ativou, por qual tool e com que origem", async () => {
    const { client, context, close } = await connect();
    await call(client, "kastir_pages_publish", { pageId: "page-1" });
    await call(client, "kastir_pages_unpublish", { pageId: "page-1" });

    await call(client, "kastir_pages_activate", { pageId: "page-1" });

    const activations = pageWorld.logs.filter(
      (entry) => entry.tool === "kastir_pages_activate",
    );
    expect(activations).toEqual([
      {
        userId: "user-1",
        action: "PAGE_PUBLISHED",
        objectType: "PAGE",
        objectLabel: expect.any(String),
        objectId: "page-1",
        source: "MCP",
        tool: "kastir_pages_activate",
        resource: context.resource,
        requestId: context.requestId,
      },
    ]);

    await close();
  });

  it("usa o escopo de publish e segue a autorizacao do painel", async () => {
    // Sem escopo de publish: a tool nem e descoberta, mesmo com write/unpublish.
    for (const scopes of [
      ["cms:read"],
      ["cms:read", "cms:pages:write"],
      ["cms:read", "cms:pages:unpublish"],
    ] as const) {
      const limited = await connect({ scopes });
      const { tools } = await limited.client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain(
        "kastir_pages_activate",
      );
      await limited.close();
    }

    // Execucao direta com escopo forjado continua barrada no servidor.
    await expect(
      activateMcpPage(
        { ...baseContext, scopes: ["cms:read", "cms:pages:unpublish"] },
        { pageId: "page-1" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(pageWorld.logs).toHaveLength(0);

    // EDITOR com o escopo de publish enxerga e usa a tool, como no painel, cujo
    // POST /activate nao restringe papel alem da sessao autenticada.
    const editor = await connect({ role: "EDITOR" });
    const { tools } = await editor.client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("kastir_pages_activate");
    await call(editor.client, "kastir_pages_publish", { pageId: "page-1" });
    await call(editor.client, "kastir_pages_unpublish", { pageId: "page-1" });
    const result = await call(editor.client, "kastir_pages_activate", {
      pageId: "page-1",
    });
    expect(result.isError).toBe(false);
    expect(pageWorld.pages[0]!.status).toBe("PUBLISHED");
    await editor.close();
  });
});

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------
describe("kastir_scripts_activate", () => {
  it("volta ao ar sem versao nova quando o rascunho e igual ao publicado", async () => {
    const { client, close } = await connect();
    const row = scriptWorld.snippets[0]!;

    const first = await call(client, "kastir_scripts_publish", {
      scriptId: "script-1",
      confirmation: "PUBLISH_SCRIPT",
    });
    expect(first.isError).toBe(false);
    expect(scriptWorld.revisions).toHaveLength(1);
    const liveRevisionId = row.publishedRevisionId;

    await call(client, "kastir_scripts_unpublish", {
      scriptId: "script-1",
      confirmation: "UNPUBLISH_SCRIPT",
    });
    expect(row.status).toBe("DRAFT");
    expect(row.publishedRevisionId).toBe(liveRevisionId);

    const refused = await call(client, "kastir_scripts_publish", {
      scriptId: "script-1",
      confirmation: "PUBLISH_SCRIPT",
    });
    expect(refused.isError).toBe(true);
    expect(refused.body.error).toEqual({
      code: "INVALID_STATE",
      message: "Script has no unpublished changes",
    });

    scriptWorld.queue.add.mockClear();
    const activated = await call(client, "kastir_scripts_activate", {
      scriptId: "script-1",
      confirmation: "PUBLISH_SCRIPT",
    });
    expect(activated.isError).toBe(false);
    expect(activated.body).toMatchObject({
      ok: true,
      summary:
        "Script script-1 is live on its published revision. Unpublished changes: no.",
      data: {
        id: "script-1",
        status: "PUBLISHED",
        activated: true,
        hasUnpublishedChanges: false,
        publishedRevisionId: liveRevisionId,
      },
    });
    expect(row.status).toBe("PUBLISHED");
    expect(row.publishedRevisionId).toBe(liveRevisionId);
    expect(scriptWorld.revisions).toHaveLength(1);
    // O script volta a ser injetado: as paginas do escopo sao reconstruidas.
    expect(scriptWorld.queue.add).toHaveBeenCalledWith(
      "page-rebuild-page-1",
      { type: "page-rebuild", pageId: "page-1" },
      expect.any(Object),
    );
    // O conteudo do script nunca volta na resposta.
    expect(JSON.stringify(activated.body)).not.toContain("window.analytics");

    await close();
  });

  it("exige a confirmacao PUBLISH_SCRIPT no servidor antes de qualquer efeito", async () => {
    const { client, close } = await connect();
    await call(client, "kastir_scripts_publish", {
      scriptId: "script-1",
      confirmation: "PUBLISH_SCRIPT",
    });
    await call(client, "kastir_scripts_unpublish", {
      scriptId: "script-1",
      confirmation: "UNPUBLISH_SCRIPT",
    });
    const row = scriptWorld.snippets[0]!;
    const logsBefore = scriptWorld.logs.length;
    scriptWorld.queue.add.mockClear();

    // Sem literal, literal errado e o literal de unpublish sao todos recusados.
    for (const args of [
      { scriptId: "script-1" },
      { scriptId: "script-1", confirmation: "WRONG_LITERAL" },
      { scriptId: "script-1", confirmation: "UNPUBLISH_SCRIPT" },
    ]) {
      const result = await call(client, "kastir_scripts_activate", args);
      expect(result.isError).toBe(true);
      expect(result.body.error?.code).toBe("CONFIRMATION_REQUIRED");
    }

    expect(row.status).toBe("DRAFT");
    expect(scriptWorld.logs).toHaveLength(logsBefore);
    expect(scriptWorld.queue.add).not.toHaveBeenCalled();

    await close();
  });

  it("recusa script nunca publicado com erro estavel e sem efeito", async () => {
    const { client, close } = await connect();

    const result = await call(client, "kastir_scripts_activate", {
      scriptId: "script-1",
      confirmation: "PUBLISH_SCRIPT",
    });

    expect(result.isError).toBe(true);
    expect(result.body).toEqual({
      error: {
        code: "INVALID_STATE",
        message: "Script has no published revision",
      },
    });
    expect(scriptWorld.snippets[0]!.status).toBe("DRAFT");
    expect(scriptWorld.revisions).toHaveLength(0);
    expect(scriptWorld.logs).toHaveLength(0);
    expect(scriptWorld.queue.add).not.toHaveBeenCalled();

    await close();
  });

  it("registra no audit a ativacao e segue a autorizacao do painel", async () => {
    // Sem escopo de publish a tool nao existe para o token, mesmo com unpublish.
    for (const scopes of [
      ["cms:read", "cms:scripts:write"],
      ["cms:read", "cms:scripts:unpublish"],
    ] as const) {
      const limited = await connect({ scopes });
      const { tools } = await limited.client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain(
        "kastir_scripts_activate",
      );
      await limited.close();
    }
    await expect(
      activateMcpScript(
        { ...baseContext, scopes: ["cms:read", "cms:scripts:unpublish"] },
        { scriptId: "script-1", confirmation: "PUBLISH_SCRIPT" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    // EDITOR com escopo de publish liga, desliga e religa como o painel.
    const editor = await connect({ role: "EDITOR" });
    await call(editor.client, "kastir_scripts_publish", {
      scriptId: "script-1",
      confirmation: "PUBLISH_SCRIPT",
    });
    await call(editor.client, "kastir_scripts_unpublish", {
      scriptId: "script-1",
      confirmation: "UNPUBLISH_SCRIPT",
    });
    const result = await call(editor.client, "kastir_scripts_activate", {
      scriptId: "script-1",
      confirmation: "PUBLISH_SCRIPT",
    });
    expect(result.isError).toBe(false);

    expect(
      scriptWorld.logs.filter(
        (entry) => entry.tool === "kastir_scripts_activate",
      ),
    ).toEqual([
      {
        userId: "user-1",
        action: "SCRIPT_PUBLISHED",
        objectType: "SCRIPT",
        objectLabel: expect.any(String),
        objectId: "script-1",
        source: "MCP",
        tool: "kastir_scripts_activate",
        resource: baseContext.resource,
        requestId: baseContext.requestId,
      },
    ]);
    await editor.close();
  });
});

// ---------------------------------------------------------------------------
// Descoberta: o que o agente le em tools/list.
// ---------------------------------------------------------------------------
describe("descoberta das tools de ativar", () => {
  it("lista as duas tools novas, corrige publish e nunca expoe exclusao permanente", async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    for (const name of [
      "kastir_pages_activate",
      "kastir_scripts_activate",
    ] as const) {
      const tool = byName.get(name);
      expect(tool, name).toBeDefined();
      expect(tool?.title).toBeTruthy();
      expect(tool?.annotations?.readOnlyHint).toBe(false);
      expect(tool?.annotations?.idempotentHint).toBe(true);
      expect(tool?.description).toMatch(/INVALID_STATE/);
    }
    // Mesmo risco de publish: script coloca codigo de autor no ar.
    expect(
      byName.get("kastir_pages_activate")?.annotations?.destructiveHint,
    ).toBe(false);
    expect(
      byName.get("kastir_scripts_activate")?.annotations?.destructiveHint,
    ).toBe(true);
    expect(
      byName.get("kastir_scripts_activate")!.inputSchema.properties as object,
    ).toHaveProperty("confirmation");

    // publish explica a recusa sem alteracao e aponta para activate.
    expect(byName.get("kastir_pages_publish")?.description).toMatch(
      /INVALID_STATE.*kastir_pages_activate/,
    );
    expect(byName.get("kastir_scripts_publish")?.description).toMatch(
      /INVALID_STATE.*kastir_scripts_activate/,
    );
    expect(byName.get("kastir_pages_publish")?.description).not.toMatch(
      /Activates if deactivated/,
    );
    // Mantem o aviso de execucao no navegador exigido para scripts live.
    expect(byName.get("kastir_scripts_publish")?.description).toMatch(
      /server does not execute/i,
    );
    expect(byName.get("kastir_scripts_publish")?.description).toMatch(
      /browser/i,
    );

    // Orcamento de contexto do tools/list (mesmo teto do teste de descoberta).
    for (const name of [
      "kastir_pages_activate",
      "kastir_scripts_activate",
      "kastir_pages_publish",
      "kastir_scripts_publish",
    ]) {
      expect(byName.get(name)!.description!.length, name).toBeLessThanOrEqual(
        160,
      );
    }

    // Regra inviolavel 3: nenhuma tool de exclusao permanente aparece.
    expect(
      tools
        .map((tool) => tool.name)
        .filter((name) => /delete|purge/.test(name)),
    ).toEqual([]);

    await close();
  });

  it("so cita no guia e no handshake tools de publicacao que existem de fato", async () => {
    const { client, close } = await connect();
    const registered = new Set(
      (await client.listTools()).tools.map((tool) => tool.name),
    );

    const prose = [...Object.values(GUIDE_TOPICS), MCP_KASTIR_CONCEPTS].join(
      " ",
    );
    const cited = new Set(
      prose.match(/kastir_(?:pages|scripts)_(?:publish|activate|unpublish)\b/g),
    );
    // Garante que o playbook realmente cita as seis tools do ciclo ligar/desligar.
    expect([...cited].sort()).toEqual([
      "kastir_pages_activate",
      "kastir_pages_publish",
      "kastir_pages_unpublish",
      "kastir_scripts_activate",
      "kastir_scripts_publish",
      "kastir_scripts_unpublish",
    ]);
    for (const name of cited) expect(registered, name).toContain(name);

    await close();
  });

  it("rejeita argumentos desconhecidos nas tools de ativar", async () => {
    const { client, close } = await connect();

    // A validacao do schema responde com texto de erro do protocolo, nao com o
    // envelope JSON das tools; por isso aqui se le o resultado cru.
    const page = await client.callTool({
      name: "kastir_pages_activate",
      arguments: { pageId: "page-1", force: true },
    });
    const script = await client.callTool({
      name: "kastir_scripts_activate",
      arguments: {
        scriptId: "script-1",
        confirmation: "PUBLISH_SCRIPT",
        force: true,
      },
    });

    expect(page.isError).toBe(true);
    expect(script.isError).toBe(true);
    expect(JSON.stringify(page.content)).toMatch(/unrecognized|force/i);
    expect(JSON.stringify(script.content)).toMatch(/unrecognized|force/i);
    expect(pageWorld.logs).toHaveLength(0);
    expect(scriptWorld.logs).toHaveLength(0);

    await close();
  });
});
