/**
 * Tool MCP `kastir_scripts_patch` (phase-5, passo 4): edição parcial do código de um script por
 * busca e troca exata, com o hash do rascunho lido como versão esperada.
 *
 * Servidor MCP real (SDK + transporte em memória) sobre o `CustomCodeService` REAL, com banco,
 * fila e audit falsos em memória, como `tests/mcp-activate.test.ts`. A trava de verdade (duas
 * requisições simultâneas, A6 e A16) é provada contra o Postgres em
 * `tests/integration/mcp-patch-concurrency.test.ts`.
 *
 * A16 manda `kastir_scripts_patch` cumprir A1, A2, A5, A10, A11, A12 e A14 sobre o código do
 * script, com os mesmos códigos de erro de páginas; cada título começa pelo ID.
 */
import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Imports estáticos de propósito: o grafo pesado (tools de Scripts, serviço real, SDK) carrega
// na fase de coleta, que não tem timeout por teste, e o timeout padrão passa a medir só o que
// cada teste afirma. Com `import()` dentro do teste, o primeiro teste pagava o carregamento a
// frio e estourava os 5 s sob a suíte concorrente.
// Os `vi.mock` abaixo são içados pelo Vitest acima destes imports; o mundo falso é
// `vi.hoisted`, que o `vi.resetModules()` de tests/setup.ts não reinicia.
// ponytail: a coleta não tem timeout por arquivo, então um import travado só cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import { MAX_SNIPPET_CONTENT_BYTES } from "@/lib/Modules/CustomCode/Schema";
import { normalizeMcpToolResponse } from "@/lib/Modules/Mcp/ResponseNormalization";
import type { McpScope } from "@/lib/Modules/Mcp/Scopes";
import {
  patchMcpScript,
  registerScriptTools,
} from "@/lib/Modules/Mcp/Tools/Scripts";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";

// ---------------------------------------------------------------------------
// Mundo falso de Scripts: banco, revisões, fila de rebuild e audit em memória.
// ---------------------------------------------------------------------------
const world = vi.hoisted(() => {
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
  const queue = { add: vi.fn(async () => ({ id: "job-id" })) };
  let tick = 0;

  /** Relógio que avança a cada gravação: `updatedAt` inalterado prova que nada foi gravado. */
  const clock = () => new Date(Date.UTC(2026, 9, 14, 12, 0, 0) + ++tick * 1000);

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
          Object.assign(row, data, { updatedAt: clock() });
          return row;
        },
      ),
    },
    snippetRevision: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          revisions.find((row) => row.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `srev-${revisions.length + 1}` };
        revisions.push(row as RevisionRow);
        return row;
      }),
    },
    page: { findMany: vi.fn(async () => []) },
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

  /** Reinicia o mundo com um script DRAFT de `content` e uma revisão antiga já existente. */
  function reset(content: string): SnippetRow {
    snippets.length = 0;
    revisions.length = 0;
    logs.length = 0;
    tick = 0;
    const row: SnippetRow = {
      id: "script-1",
      name: "Analytics",
      location: "BODY_END",
      content,
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
      createdAt: clock(),
      updatedAt: clock(),
    };
    snippets.push(row);
    revisions.push({
      id: "srev-seed",
      snippetId: row.id,
      fingerprint: "fingerprint-seed",
      content: "seed",
    });
    vi.clearAllMocks();
    return row;
  }

  return { database, queue, snippets, revisions, logs, reset };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: vi.fn(),
}));

// Serviço real, instanciado sobre o mundo falso acima.
vi.mock("@/lib/Modules/CustomCode/Service", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/Modules/CustomCode/Service")>();
  return {
    ...actual,
    customCodeService: new actual.CustomCodeService(
      world.database as never,
      world.queue as never,
    ),
  };
});

// ---------------------------------------------------------------------------
// Apoios: contexto MCP, servidor em memória, envelope e transporte HTTP.
// ---------------------------------------------------------------------------
const ALL_SCOPES: readonly McpScope[] = [
  "cms:read",
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

/** SHA-256 calculado direto no `node:crypto`, independente do código sob teste. */
const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** Servidor MCP real com as tools de Scripts, ligado a um cliente em memória. */
async function connect(overrides: Partial<McpToolContext> = {}) {
  const context = { ...baseContext, ...overrides };
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
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
  registerScriptTools(server, baseContext);
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

/** Cópia do que o critério chama de "como estava": conteúdo, `updatedAt` e revisões. */
function snapshotWorld() {
  const row = world.snippets[0]!;
  return {
    content: row.content,
    updatedAt: row.updatedAt,
    revisions: structuredClone(world.revisions),
  };
}

/** Nada foi gravado nem auditado: código, `updatedAt` e revisões como estavam. */
function expectUntouched(before: ReturnType<typeof snapshotWorld>) {
  expect(snapshotWorld()).toEqual(before);
  expect(world.database.snippet.update).not.toHaveBeenCalled();
  expect(world.logs).toHaveLength(0);
}

beforeEach(() => {
  world.reset("AB");
});

// ---------------------------------------------------------------------------
// A1 e A2
// ---------------------------------------------------------------------------
describe("kastir_scripts_patch: troca por busca e troca exata", () => {
  it("A1: troca um trecho do código e devolve o hash e o tamanho do novo rascunho", async () => {
    const row = world.reset("fill:#111;fill:#222");
    const { client, context, close } = await connect();

    const result = await call(client, "kastir_scripts_patch", {
      id: "script-1",
      expectedContentSha256: sha256("fill:#111;fill:#222"),
      operations: [{ old: "#111", new: "#0A0" }],
    });

    expect(result.isError).toBe(false);
    expect(row.content).toBe("fill:#0A0;fill:#222");
    expect(result.body.data).toMatchObject({
      id: "script-1",
      contentSha256: sha256("fill:#0A0;fill:#222"),
      contentBytes: 19,
    });
    // O patch grava rascunho: nada de publicar, fotografar nem enfileirar rebuild.
    expect(row.status).toBe("DRAFT");
    expect(world.revisions).toHaveLength(1);
    expect(world.queue.add).not.toHaveBeenCalled();
    // O audit registra a ação de update do script com a tool de origem.
    expect(world.logs).toEqual([
      expect.objectContaining({
        action: "SCRIPT_UPDATED",
        objectId: "script-1",
        source: "MCP",
        tool: "kastir_scripts_patch",
        resource: context.resource,
        requestId: context.requestId,
      }),
    ]);
    // O resumo identifica o script pelo id e não carrega código.
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

    const result = await call(client, "kastir_scripts_patch", {
      id: "script-1",
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
describe("kastir_scripts_patch e kastir_scripts_update: versão por hash", () => {
  const attempts = {
    patch: (staleHash: string) =>
      [
        "kastir_scripts_patch",
        {
          id: "script-1",
          expectedContentSha256: staleHash,
          operations: [{ old: "v2", new: "v3" }],
        },
      ] as const,
    update: (staleHash: string) =>
      [
        "kastir_scripts_update",
        { id: "script-1", expectedContentSha256: staleHash, content: "v3" },
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
});

// ---------------------------------------------------------------------------
// A10
// ---------------------------------------------------------------------------
describe("kastir_scripts_patch: limite de conteúdo em bytes UTF-8", () => {
  /** `X` seguido de a: o conteúdo tem exatamente `bytes` bytes. */
  const contentOfBytes = (bytes: number) => "X" + "a".repeat(bytes - 1);

  it("A10: o resultado no limite de 2 MiB passa e o primeiro byte acima é recusado com o limite na mensagem", async () => {
    const atLimit = contentOfBytes(MAX_SNIPPET_CONTENT_BYTES);
    const row = world.reset(atLimit);
    const { client, close } = await connect();

    const same = await call(client, "kastir_scripts_patch", {
      id: "script-1",
      expectedContentSha256: sha256(atLimit),
      operations: [{ old: "X", new: "Y" }],
    });
    expect(same.isError).toBe(false);
    expect(Buffer.byteLength(row.content, "utf8")).toBe(
      MAX_SNIPPET_CONTENT_BYTES,
    );
    expect(row.content.startsWith("Y")).toBe(true);

    // Um byte acima do limite: `Y` vira `YZ`.
    const before = snapshotWorld();
    const logsBefore = world.logs.length;
    const over = await call(client, "kastir_scripts_patch", {
      id: "script-1",
      expectedContentSha256: sha256(row.content),
      operations: [{ old: "Y", new: "YZ" }],
    });
    expect(over.isError).toBe(true);
    expect(over.body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: `Patched content must be at most ${MAX_SNIPPET_CONTENT_BYTES} bytes`,
    });
    expect(row.content === before.content).toBe(true);
    expect(row.updatedAt).toEqual(before.updatedAt);
    expect(world.logs).toHaveLength(logsBefore);

    await close();
  });
});

// ---------------------------------------------------------------------------
// A11 e A12: recusas de entrada pela rota /api/mcp
// ---------------------------------------------------------------------------
describe("kastir_scripts_patch: recusa de argumento inválido pela rota /api/mcp", () => {
  const validHash = sha256("AB");
  const oneOp = [{ old: "A", new: "X" }];

  const refused: Array<{ name: string; args: Record<string, unknown> }> = [
    {
      name: "A11: 51 operações",
      args: {
        id: "script-1",
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
        id: "script-1",
        expectedContentSha256: validHash,
        operations: [{ old: "", new: "X" }],
      },
    },
    {
      name: "A11: lista de operações vazia",
      args: {
        id: "script-1",
        expectedContentSha256: validHash,
        operations: [],
      },
    },
    {
      name: "A11: campo fora da allowlist",
      args: {
        id: "script-1",
        expectedContentSha256: validHash,
        operations: oneOp,
        content: "<script>smuggled()</script>",
      },
    },
    {
      name: "A11: campo fora da allowlist dentro da operação",
      args: {
        id: "script-1",
        expectedContentSha256: validHash,
        operations: [{ old: "A", new: "X", regex: true }],
      },
    },
    {
      name: "A11: hash com 63 caracteres",
      args: {
        id: "script-1",
        expectedContentSha256: validHash.slice(0, 63),
        operations: oneOp,
      },
    },
    {
      name: "A11: hash com 65 caracteres",
      args: {
        id: "script-1",
        expectedContentSha256: `${validHash}0`,
        operations: oneOp,
      },
    },
    {
      name: "A11: hash de 64 caracteres não hexadecimais",
      args: {
        id: "script-1",
        expectedContentSha256: "g".repeat(64),
        operations: oneOp,
      },
    },
    {
      name: "A12: hash ausente",
      args: { id: "script-1", operations: oneOp },
    },
  ];

  it.each(refused)(
    "$name: VALIDATION_ERROR estável sem campo nem valor e nada gravado",
    async ({ args }) => {
      const before = snapshotWorld();

      const { sdkPayload, payload } = await callThroughRoute(
        "kastir_scripts_patch",
        args,
      );

      // A recusa vem do SDK, antes do handler; o normalizador troca o texto bruto do zod.
      expect(sdkPayload.result.isError).toBe(true);
      expect(sdkPayload.result.content[0].text).toMatch(
        /^MCP error -32602: Input validation error: Invalid arguments for tool kastir_scripts_patch: /,
      );
      expect(payload).toEqual(refusalEnvelope("kastir_scripts_patch"));
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

    const ok = await call(client, "kastir_scripts_patch", {
      id: "script-1",
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
// A14
// ---------------------------------------------------------------------------
describe("kastir_scripts_patch: escopo", () => {
  it("A14: sem o escopo de escrita a tool não é descoberta, a chamada é recusada como tool inexistente e a execução direta é barrada, sem gravar nem auditar", async () => {
    world.reset("AB");
    const before = snapshotWorld();
    const input = {
      id: "script-1",
      expectedContentSha256: sha256("AB"),
      operations: [{ old: "A", new: "X" }],
    };

    // Publicar ou despublicar não dão escrita de conteúdo.
    for (const scopes of [
      ["cms:read"],
      ["cms:read", "cms:scripts:publish", "cms:scripts:unpublish"],
    ] as const) {
      const limited = await connect({ scopes });
      const { tools } = await limited.client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain(
        "kastir_scripts_patch",
      );

      // O caminho do agente: chamar a tool pelo nome. Sem o escopo ela nem foi registrada, então
      // o SDK a recusa como inexistente antes de qualquer handler. O texto do SDK não é JSON,
      // por isso não passa pelo helper `call`.
      const attempt = await limited.client.callTool({
        name: "kastir_scripts_patch",
        arguments: input,
      });
      expect(attempt).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: expect.stringContaining(
              "Tool kastir_scripts_patch not found",
            ),
          },
        ],
      });
      await limited.close();

      // Execução direta com escopo forjado continua barrada no servidor.
      await expect(
        patchMcpScript({ ...baseContext, scopes }, input),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }

    expectUntouched(before);
  });
});
