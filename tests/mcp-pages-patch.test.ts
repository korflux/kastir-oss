/**
 * Tool MCP `kastir_pages_patch` (phase-5, passo 4): edição parcial do rascunho de uma página
 * por busca e troca exata, com o hash do rascunho lido como versão esperada.
 *
 * Servidor MCP real (SDK + transporte em memória) sobre o `PageService` REAL, com banco,
 * arquivos públicos e audit falsos em memória, como `tests/mcp-activate.test.ts`: escopo,
 * validação de entrada, serviço, trava de linha (o `$queryRaw` do `tx` é um `vi.fn`), audit e
 * envelope de erro rodam de ponta a ponta. A trava de verdade (duas requisições simultâneas,
 * A6) é provada contra o Postgres em `tests/integration/mcp-patch-concurrency.test.ts`.
 *
 * Critérios provados aqui, cada título começa pelo ID (spec da phase-5):
 *  - A1 troca de um trecho; A2 tabela do patch (nas linhas de erro e no no-op, rascunho,
 *    `updatedAt` e revisões ficam como estavam); A5 hash antigo (patch e update); A10 limite
 *    de 2 MiB em bytes; A11 e A12 recusas de entrada pela rota `/api/mcp` (envelope
 *    `VALIDATION_ERROR` sem campo nem valor); A13 EDITOR com audit da tool; A14 sem escopo;
 *    A19 diff `to="draft"` depois do patch.
 */
import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Imports estáticos de propósito: o grafo pesado (tools de Pages, serviço real, SDK) carrega na
// fase de coleta, que não tem timeout por teste, e o timeout padrão passa a medir só o que cada
// teste afirma. Com `import()` dentro do teste, o primeiro teste pagava o carregamento a frio e
// estourava os 5 s sob a suíte concorrente.
// Os `vi.mock` abaixo são içados pelo Vitest acima destes imports; os mundos falsos são
// `vi.hoisted`, que o `vi.resetModules()` de tests/setup.ts não reinicia.
// ponytail: a coleta não tem timeout por arquivo, então um import travado só cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import { normalizeMcpToolResponse } from "@/lib/Modules/Mcp/ResponseNormalization";
import type { McpScope } from "@/lib/Modules/Mcp/Scopes";
import { patchMcpPage, registerPageTools } from "@/lib/Modules/Mcp/Tools/Pages";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import { MAX_PAGE_CONTENT_BYTES } from "@/lib/Modules/Pages/Schema";
import { RevisionService } from "@/lib/Modules/Revisions/Service";

// ---------------------------------------------------------------------------
// Mundo falso de Pages: banco, revisões, arquivos públicos e audit em memória.
// ---------------------------------------------------------------------------
const world = vi.hoisted(() => {
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
  type RevisionRow = Record<string, unknown> & {
    id: string;
    pageId: string;
    fingerprint: string;
  };

  const pages: PageRow[] = [];
  const revisions: RevisionRow[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const files = new Map<string, string>();
  let nextRevision = 1;
  let tick = 0;

  /** Relógio que avança a cada gravação: `updatedAt` inalterado prova que nada foi gravado. */
  const clock = () => new Date(Date.UTC(2026, 9, 14, 12, 0, 0) + ++tick * 1000);

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
          Object.assign(row, data, { updatedAt: clock() });
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
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          id: `rev-${nextRevision++}`,
          pinned: false,
          createdAt: clock(),
        } as unknown as RevisionRow;
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
    // A trava de linha (`SELECT ... FOR UPDATE`) não tem efeito num mundo em memória.
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(
      async <T>(callback: (tx: typeof database) => Promise<T>) =>
        callback(database),
    ),
  };

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

  /** Reinicia o mundo com uma página DRAFT de `content` e uma revisão antiga já existente. */
  function reset(content: string): PageRow {
    pages.length = 0;
    revisions.length = 0;
    logs.length = 0;
    files.clear();
    nextRevision = 1;
    tick = 0;
    const row: PageRow = {
      id: "page-1",
      title: "Landing",
      slug: "landing",
      content,
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      status: "DRAFT",
      folderId: "base-id",
      authorId: "author-1",
      publishedRevisionId: null,
      publishedAt: null,
      deletedAt: null,
      createdAt: clock(),
      updatedAt: clock(),
    };
    pages.push(row);
    revisions.push({
      id: "rev-seed",
      pageId: row.id,
      authorId: "author-1",
      fingerprint: "fingerprint-seed",
      pinned: false,
      createdAt: clock(),
      title: "Landing",
      slug: "landing",
      content: "seed",
      seoTitle: null,
      seoDescription: null,
      seoKeyword: null,
      folderId: "base-id",
    });
    nextRevision = 2;
    vi.clearAllMocks();
    return row;
  }

  return { database, store, compiler, pages, revisions, logs, files, reset };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));
vi.mock("@/lib/Modules/Pages/FolderService", () => ({ folderService: {} }));
vi.mock("@/lib/Modules/Settings/Service", () => ({ settingsService: {} }));

// Serviço real, instanciado sobre o mundo falso acima.
vi.mock("@/lib/Modules/Pages/Service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/Modules/Pages/Service")>();
  return {
    ...actual,
    pageService: new actual.PageService(
      world.database as never,
      world.store as never,
      world.compiler,
    ),
  };
});
// O diff de revisões usa o `RevisionService` real (import estático acima, já carregado na
// coleta) sobre o mesmo banco falso; a fábrica só roda quando a tool importa `Revisions/Api`.
vi.mock("@/lib/Modules/Revisions/Api", () => ({
  revisionService: () => new RevisionService(world.database as never),
}));

// ---------------------------------------------------------------------------
// Apoios: contexto MCP, servidor em memória, envelope e transporte HTTP.
// ---------------------------------------------------------------------------
const ALL_SCOPES: readonly McpScope[] = [
  "cms:read",
  "cms:pages:write",
  "cms:pages:publish",
  "cms:pages:unpublish",
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

/** SHA-256 calculado direto no `node:crypto`, independente do código sob teste. */
const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** Servidor MCP real com as tools de Pages, ligado a um cliente em memória. */
async function connect(overrides: Partial<McpToolContext> = {}) {
  const context = { ...baseContext, ...overrides };
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  registerPageTools(server, context);
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
  lines?: Array<{ marker: string; text: string }>;
  error?: { code: string; message: string };
};

/** Chama uma tool e devolve o envelope JSON já decodificado. */
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

/**
 * Caminho da rota `/api/mcp` (como `tests/mcp-transport.test.ts`): o SDK real recusa o
 * argumento antes do handler e `normalizeMcpToolResponse` troca o texto bruto do zod pelo
 * envelope estável. Servidor e transporte novos a cada chamada, porque o transporte sem sessão
 * não é reutilizável.
 */
async function callThroughRoute(name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  registerPageTools(server, baseContext);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const body = {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name, arguments: args },
  };
  const sdkResponse = await transport.handleRequest(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    }),
    { parsedBody: body },
  );
  const sdkPayload = await sdkResponse.clone().json();
  const normalized = await normalizeMcpToolResponse(sdkResponse, body);
  const payload = await normalized.json();
  await server.close();
  return { sdkPayload, payload };
}

/** Envelope que o agente deve receber para qualquer recusa de argumento. */
const refusalEnvelope = (tool: string) => ({
  jsonrpc: "2.0",
  id: 7,
  result: {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid arguments for tool ${tool}`,
          },
        }),
      },
    ],
    isError: true,
  },
});

beforeEach(() => {
  world.reset("AB");
});

/** Nada foi gravado nem auditado: rascunho, `updatedAt` e revisões como estavam. */
function expectUntouched(before: ReturnType<typeof snapshotWorld>) {
  expect(snapshotWorld()).toEqual(before);
  expect(world.database.page.update).not.toHaveBeenCalled();
  expect(world.logs).toHaveLength(0);
}

/** Cópia do que o critério chama de "como estava": conteúdo, `updatedAt` e revisões. */
function snapshotWorld() {
  const row = world.pages[0]!;
  return {
    content: row.content,
    updatedAt: row.updatedAt,
    revisions: structuredClone(world.revisions),
  };
}

// ---------------------------------------------------------------------------
// A1 e A2
// ---------------------------------------------------------------------------
describe("kastir_pages_patch: troca por busca e troca exata", () => {
  it("A1: troca um trecho do rascunho e devolve o hash e o tamanho do novo rascunho", async () => {
    const row = world.reset("fill:#111;fill:#222");
    const { client, close } = await connect();

    const result = await call(client, "kastir_pages_patch", {
      id: "page-1",
      expectedContentSha256: sha256("fill:#111;fill:#222"),
      operations: [{ old: "#111", new: "#0A0" }],
    });

    expect(result.isError).toBe(false);
    expect(row.content).toBe("fill:#0A0;fill:#222");
    expect(result.body.data).toMatchObject({
      id: "page-1",
      contentSha256: sha256("fill:#0A0;fill:#222"),
      contentBytes: 19,
    });
    // O patch grava rascunho: nada de publicar nem fotografar.
    expect(row.status).toBe("DRAFT");
    expect(world.files.size).toBe(0);
    expect(world.revisions).toHaveLength(1);
    // O resumo identifica a página pelo id e não carrega conteúdo.
    expect(JSON.stringify(result.body.summary)).not.toContain("#0A0");

    await close();
  });

  const A2_ROWS: Array<{
    name: string;
    content: string;
    operations: Array<{ old: string; new: string }>;
    outcome:
      | { kind: "saved"; content: string }
      | { kind: "noop" }
      | { kind: "occurrences"; index: number; count: number }
      | { kind: "surrogate" };
  }> = [
    {
      name: "AB, A→X grava XB",
      content: "AB",
      operations: [{ old: "A", new: "X" }],
      outcome: { kind: "saved", content: "XB" },
    },
    {
      name: "AB, A→B e BB→C grava C (a segunda opera sobre BB)",
      content: "AB",
      operations: [
        { old: "A", new: "B" },
        { old: "BB", new: "C" },
      ],
      outcome: { kind: "saved", content: "C" },
    },
    {
      name: "AB, A→X e Z→Y recusa na operação 1 com 0 ocorrências",
      content: "AB",
      operations: [
        { old: "A", new: "X" },
        { old: "Z", new: "Y" },
      ],
      outcome: { kind: "occurrences", index: 1, count: 0 },
    },
    {
      name: "a b a, a→x recusa na operação 0 com 2 ocorrências",
      content: "a b a",
      operations: [{ old: "a", new: "x" }],
      outcome: { kind: "occurrences", index: 0, count: 2 },
    },
    {
      name: "aaa, aa→b recusa com 2 ocorrências sobrepostas",
      content: "aaa",
      operations: [{ old: "aa", new: "b" }],
      outcome: { kind: "occurrences", index: 0, count: 2 },
    },
    {
      name: "CRLF no conteúdo, LF no old recusa com 0 ocorrências",
      content: "<p>\r\n</p>",
      operations: [{ old: "<p>\n</p>", new: "<p></p>" }],
      outcome: { kind: "occurrences", index: 0, count: 0 },
    },
    {
      name: "CRLF no conteúdo, CRLF no old grava <p></p>",
      content: "<p>\r\n</p>",
      operations: [{ old: "<p>\r\n</p>", new: "<p></p>" }],
      outcome: { kind: "saved", content: "<p></p>" },
    },
    {
      name: "emoji, 🚀→✅ grava ✅ x",
      content: "🚀 x",
      operations: [{ old: "🚀", new: "✅" }],
      outcome: { kind: "saved", content: "✅ x" },
    },
    {
      name: "surrogate isolado no old recusa",
      content: "🚀 x",
      operations: [{ old: "\ud83d", new: "y" }],
      outcome: { kind: "surrogate" },
    },
    {
      name: "AB, A→A termina com sucesso e sem escrita",
      content: "AB",
      operations: [{ old: "A", new: "A" }],
      outcome: { kind: "noop" },
    },
  ];

  it.each(A2_ROWS)("A2: $name", async ({ content, operations, outcome }) => {
    const row = world.reset(content);
    const before = snapshotWorld();
    const { client, close } = await connect();

    const result = await call(client, "kastir_pages_patch", {
      id: "page-1",
      expectedContentSha256: sha256(content),
      operations,
    });

    if (outcome.kind === "saved") {
      expect(result.isError).toBe(false);
      expect(row.content).toBe(outcome.content);
      expect(result.body.data).toMatchObject({
        contentSha256: sha256(outcome.content),
        contentBytes: Buffer.byteLength(outcome.content, "utf8"),
      });
      expect(row.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
      expect(world.logs).toHaveLength(1);
      expect(world.revisions).toEqual(before.revisions);
    } else if (outcome.kind === "noop") {
      expect(result.isError).toBe(false);
      expect(result.body.data).toMatchObject({
        contentSha256: sha256(content),
      });
      expectUntouched(before);
    } else if (outcome.kind === "occurrences") {
      expect(result.isError).toBe(true);
      expect(result.body.error).toEqual({
        code: "VALIDATION_ERROR",
        message: `Operation ${outcome.index}: old text occurs ${outcome.count} times, expected exactly 1`,
      });
      expectUntouched(before);
    } else {
      expect(result.isError).toBe(true);
      expect(result.body.error?.code).toBe("VALIDATION_ERROR");
      expect(result.body.error?.message).toMatch(/unpaired surrogate/);
      expectUntouched(before);
    }

    await close();
  });
});

// ---------------------------------------------------------------------------
// A5
// ---------------------------------------------------------------------------
describe("kastir_pages_patch e kastir_pages_update: versão por hash", () => {
  const attempts = {
    patch: (staleHash: string) =>
      [
        "kastir_pages_patch",
        {
          id: "page-1",
          expectedContentSha256: staleHash,
          operations: [{ old: "v2", new: "v3" }],
        },
      ] as const,
    update: (staleHash: string) =>
      [
        "kastir_pages_update",
        {
          id: "page-1",
          expectedContentSha256: staleHash,
          content: "v3",
        },
      ] as const,
  };

  it.each(["patch", "update"] as const)(
    "A5: %s com o hash H1 depois de outra gravação recebe CONFLICT com H2 na mensagem e nada é gravado",
    async (kind) => {
      const row = world.reset("v1");
      const h1 = sha256("v1");
      // Outra sessão gravou depois da leitura que gerou H1.
      row.content = "v2";
      const before = snapshotWorld();
      const { client, close } = await connect();

      const [tool, args] = attempts[kind](h1);
      const result = await call(client, tool, args);

      expect(result.isError).toBe(true);
      expect(result.body.error?.code).toBe("CONFLICT");
      expect(result.body.error?.message).toContain(sha256("v2"));
      expectUntouched(before);

      await close();
    },
  );

  it("A5: o hash é comparado em minúsculas e vence a data esperada do update", async () => {
    const row = world.reset("v1");
    const { client, close } = await connect();

    const result = await call(client, "kastir_pages_update", {
      id: "page-1",
      expectedContentSha256: sha256("v1").toUpperCase(),
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      content: "v2",
    });

    expect(result.isError).toBe(false);
    expect(row.content).toBe("v2");
    expect(result.body.data).toMatchObject({ contentSha256: sha256("v2") });

    await close();
  });
});

// ---------------------------------------------------------------------------
// A10
// ---------------------------------------------------------------------------
describe("kastir_pages_patch: limite de conteúdo em bytes UTF-8", () => {
  /** `X` seguido de a: o conteúdo tem exatamente `bytes` bytes. */
  const contentOfBytes = (bytes: number) => "X" + "a".repeat(bytes - 1);

  it("A10: o resultado no limite de 2 MiB passa e o primeiro byte acima é recusado com o limite na mensagem", async () => {
    const atLimit = contentOfBytes(MAX_PAGE_CONTENT_BYTES);
    const row = world.reset(atLimit);
    const { client, close } = await connect();

    const same = await call(client, "kastir_pages_patch", {
      id: "page-1",
      expectedContentSha256: sha256(atLimit),
      operations: [{ old: "X", new: "Y" }],
    });
    expect(same.isError).toBe(false);
    expect(Buffer.byteLength(row.content, "utf8")).toBe(MAX_PAGE_CONTENT_BYTES);
    expect(row.content.startsWith("Y")).toBe(true);

    // Um byte acima do limite: `X` vira `XY`.
    const before = snapshotWorld();
    const logsBefore = world.logs.length;
    const over = await call(client, "kastir_pages_patch", {
      id: "page-1",
      expectedContentSha256: sha256(row.content),
      operations: [{ old: "Y", new: "YZ" }],
    });
    expect(over.isError).toBe(true);
    expect(over.body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: `Patched content must be at most ${MAX_PAGE_CONTENT_BYTES} bytes`,
    });
    expect(row.content === before.content).toBe(true);
    expect(row.updatedAt).toEqual(before.updatedAt);
    expect(world.logs).toHaveLength(logsBefore);

    await close();
  });

  it("A10: o limite é em bytes, não em caracteres (cada 🚀 ocupa 4 bytes)", async () => {
    // 524287 emojis e um X ficam logo abaixo de 2 MiB em bytes (e a metade disso em unidades
    // UTF-16); trocar o X por dois emojis passa do limite em bytes.
    const emojis = "🚀".repeat(MAX_PAGE_CONTENT_BYTES / 4 - 1);
    const content = `${emojis}X`;
    const row = world.reset(content);
    const { client, close } = await connect();

    const over = await call(client, "kastir_pages_patch", {
      id: "page-1",
      expectedContentSha256: sha256(content),
      operations: [{ old: "X", new: "🚀🚀" }],
    });

    expect(over.isError).toBe(true);
    expect(over.body.error?.code).toBe("VALIDATION_ERROR");
    expect(over.body.error?.message).toContain(String(MAX_PAGE_CONTENT_BYTES));
    expect(row.content === content).toBe(true);

    await close();
  });
});

// ---------------------------------------------------------------------------
// A11 e A12: recusas de entrada pela rota /api/mcp
// ---------------------------------------------------------------------------
describe("kastir_pages_patch: recusa de argumento inválido pela rota /api/mcp", () => {
  const validHash = sha256("AB");
  const oneOp = [{ old: "A", new: "X" }];

  const refused: Array<{ name: string; args: Record<string, unknown> }> = [
    {
      name: "A11: 51 operações",
      args: {
        id: "page-1",
        expectedContentSha256: validHash,
        operations: Array.from({ length: 51 }, (_, i) => ({
          old: `old-${i}`,
          new: "x",
        })),
      },
    },
    {
      name: "A11: old vazio",
      args: {
        id: "page-1",
        expectedContentSha256: validHash,
        operations: [{ old: "", new: "X" }],
      },
    },
    {
      name: "A11: lista de operações vazia",
      args: {
        id: "page-1",
        expectedContentSha256: validHash,
        operations: [],
      },
    },
    {
      name: "A11: campo fora da allowlist",
      args: {
        id: "page-1",
        expectedContentSha256: validHash,
        operations: oneOp,
        content: "<p>smuggled</p>",
      },
    },
    {
      name: "A11: campo fora da allowlist dentro da operação",
      args: {
        id: "page-1",
        expectedContentSha256: validHash,
        operations: [{ old: "A", new: "X", regex: true }],
      },
    },
    {
      name: "A11: hash com 63 caracteres",
      args: {
        id: "page-1",
        expectedContentSha256: validHash.slice(0, 63),
        operations: oneOp,
      },
    },
    {
      name: "A11: hash com 65 caracteres",
      args: {
        id: "page-1",
        expectedContentSha256: `${validHash}0`,
        operations: oneOp,
      },
    },
    {
      name: "A11: hash de 64 caracteres não hexadecimais",
      args: {
        id: "page-1",
        expectedContentSha256: "g".repeat(64),
        operations: oneOp,
      },
    },
    {
      name: "A12: hash ausente",
      args: { id: "page-1", operations: oneOp },
    },
  ];

  it.each(refused)(
    "$name: VALIDATION_ERROR estável sem campo nem valor e nada gravado",
    async ({ args }) => {
      const before = snapshotWorld();

      const { sdkPayload, payload } = await callThroughRoute(
        "kastir_pages_patch",
        args,
      );

      // A recusa vem do SDK, antes do handler; o normalizador troca o texto bruto do zod.
      expect(sdkPayload.result.isError).toBe(true);
      expect(sdkPayload.result.content[0].text).toMatch(
        /^MCP error -32602: Input validation error: Invalid arguments for tool kastir_pages_patch: /,
      );
      expect(payload).toEqual(refusalEnvelope("kastir_pages_patch"));
      expectUntouched(before);
      expect(world.database.$transaction).not.toHaveBeenCalled();
    },
  );

  it("A11: 50 operações, o limite, passam e gravam", async () => {
    // Conteúdo com 50 marcadores únicos; cada operação troca um deles.
    const content = Array.from({ length: 50 }, (_, i) => `[m${i}]`).join("");
    const row = world.reset(content);
    const { client, close } = await connect();
    const operations = Array.from({ length: 50 }, (_, i) => ({
      old: `[m${i}]`,
      new: `[n${i}]`,
    }));

    const ok = await call(client, "kastir_pages_patch", {
      id: "page-1",
      expectedContentSha256: sha256(content),
      operations,
    });
    expect(ok.isError).toBe(false);
    expect(row.content).toBe(
      Array.from({ length: 50 }, (_, i) => `[n${i}]`).join(""),
    );

    await close();
  });
});

// ---------------------------------------------------------------------------
// A13 e A14
// ---------------------------------------------------------------------------
describe("kastir_pages_patch: papel, escopo e audit", () => {
  it("A13: EDITOR com cms:pages:write grava o rascunho e o audit registra a ação de update com a tool", async () => {
    const row = world.reset("AB");
    const { client, context, close } = await connect({
      role: "EDITOR",
      scopes: ["cms:read", "cms:pages:write"],
    });

    const result = await call(client, "kastir_pages_patch", {
      id: "page-1",
      expectedContentSha256: sha256("AB"),
      operations: [{ old: "A", new: "X" }],
    });

    expect(result.isError).toBe(false);
    expect(row.content).toBe("XB");
    expect(world.logs).toEqual([
      {
        userId: "user-1",
        action: "PAGE_UPDATED",
        objectType: "PAGE",
        objectLabel: expect.any(String),
        objectId: "page-1",
        source: "MCP",
        tool: "kastir_pages_patch",
        resource: context.resource,
        requestId: context.requestId,
      },
    ]);

    await close();
  });

  it("A14: sem o escopo de escrita a tool não é descoberta, a chamada é recusada como tool inexistente e a execução direta é barrada, sem gravar nem auditar", async () => {
    world.reset("AB");
    const before = snapshotWorld();
    const input = {
      id: "page-1",
      expectedContentSha256: sha256("AB"),
      operations: [{ old: "A", new: "X" }],
    };

    // Publicar ou despublicar não dão escrita de conteúdo.
    for (const scopes of [
      ["cms:read"],
      ["cms:read", "cms:pages:publish", "cms:pages:unpublish"],
    ] as const) {
      const limited = await connect({ scopes });
      const { tools } = await limited.client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain(
        "kastir_pages_patch",
      );

      // O caminho do agente: chamar a tool pelo nome. Sem o escopo ela nem foi registrada, então
      // o SDK a recusa como inexistente antes de qualquer handler. O texto do SDK não é JSON,
      // por isso não passa pelo helper `call`.
      const attempt = await limited.client.callTool({
        name: "kastir_pages_patch",
        arguments: input,
      });
      expect(attempt).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: expect.stringContaining("Tool kastir_pages_patch not found"),
          },
        ],
      });
      await limited.close();

      // Execução direta com escopo forjado continua barrada no servidor.
      await expect(
        patchMcpPage({ ...baseContext, scopes }, input),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }

    expectUntouched(before);
  });
});

// ---------------------------------------------------------------------------
// A19
// ---------------------------------------------------------------------------
describe("kastir_pages_patch: conferência contra o publicado", () => {
  it("A19: depois do patch, o diff da revisão publicada contra to=draft mostra a mudança e publicar segue igual", async () => {
    const content = "<h1>Title</h1>\n<p>old</p>\n";
    const row = world.reset(content);
    const { client, close } = await connect();

    const published = await call(client, "kastir_pages_publish", {
      pageId: "page-1",
    });
    expect(published.isError).toBe(false);
    const liveRevisionId = row.publishedRevisionId!;
    expect(liveRevisionId).toBeTruthy();

    const patched = await call(client, "kastir_pages_patch", {
      id: "page-1",
      expectedContentSha256: sha256(content),
      operations: [{ old: "<p>old</p>", new: "<p>new</p>" }],
    });
    expect(patched.isError).toBe(false);
    expect(patched.body.data).toMatchObject({ hasUnpublishedChanges: true });

    const diff = await call(client, "kastir_pages_revisions_diff", {
      pageId: "page-1",
      from: liveRevisionId,
      to: "draft",
    });
    expect(diff.isError).toBe(false);
    expect(
      diff.body.lines
        ?.filter((line) => line.marker !== " ")
        .map((line) => `${line.marker}${line.text}`),
    ).toEqual(["-<p>old</p>", "+<p>new</p>"]);

    // O ponteiro publicado e o arquivo no ar seguem os do publicado até o próximo publish.
    expect(row.publishedRevisionId).toBe(liveRevisionId);
    expect(world.files.get("landing")).toBe(`compiled:${content}`);
    const republished = await call(client, "kastir_pages_publish", {
      pageId: "page-1",
    });
    expect(republished.isError).toBe(false);
    expect(row.publishedRevisionId).not.toBe(liveRevisionId);
    expect(world.files.get("landing")).toBe(
      "compiled:<h1>Title</h1>\n<p>new</p>\n",
    );

    await close();
  });
});
