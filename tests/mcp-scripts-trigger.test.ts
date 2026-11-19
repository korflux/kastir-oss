import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCOPE_PAGE_IDS_MAX } from "@/lib/Modules/CustomCode/Schema";

// registerTool() valida o input com o schema MCP antes do handler, entao o teste
// exercita o mesmo schema que a tool publica.
const registered = new Map<
  string,
  { inputSchema: { parse: (v: unknown) => unknown } }
>();

const { createSnippet, updateSnippet } = vi.hoisted(() => ({
  createSnippet: vi.fn(),
  updateSnippet: vi.fn(),
}));

vi.mock("@/lib/Modules/CustomCode/Service", () => ({
  customCodeService: { createSnippet, updateSnippet },
}));

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read" as const, "cms:scripts:write" as const],
  clientId: "client-1",
  resource: "http://localhost:3000/api/mcp",
  requestId: "request-1",
};

const server = {
  registerTool: (name: string, config: { inputSchema: unknown }) => {
    registered.set(name, config as never);
  },
} as never;

const trigger = {
  triggerType: "PAGE_LOAD",
  triggerConfig: { delaySeconds: 5 },
};

describe("MCP scripts trigger argument", () => {
  it("accepts the trigger as an object and as a JSON string", async () => {
    const { registerScriptTools } =
      await import("@/lib/Modules/Mcp/Tools/Scripts");
    registerScriptTools(server, context);

    const base = {
      name: "Popup",
      location: "BODY_END",
      content: "<div>hi</div>",
    };
    const create = registered.get("kastir_scripts_create")!.inputSchema;

    expect(create.parse({ ...base, trigger })).toMatchObject({ trigger });
    // Clients that read the property's JSON Schema `type` send this shape.
    expect(
      create.parse({ ...base, trigger: JSON.stringify(trigger) }),
    ).toMatchObject({ trigger });

    const update = registered.get("kastir_scripts_update")!.inputSchema;
    expect(update.parse({ id: "s1", trigger: null })).toMatchObject({
      trigger: null,
    });
    expect(update.parse({ id: "s1", trigger: "null" })).toMatchObject({
      trigger: null,
    });
    expect(() => update.parse({ id: "s1", trigger: "not-json" })).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* pageIds: o MCP herda do schema do painel (cuid, dedupe, teto)               */
/* -------------------------------------------------------------------------- */

/** cuid sintético válido (`c` + 24 alfanuméricos), o formato do `Page.id` do Prisma. */
const cuid = (n: number) => `c${String(n).padStart(24, "0")}`;

const scriptBase = {
  name: "Popup",
  location: "BODY_END",
  content: "<div>hi</div>",
  scopeType: "SPECIFIC_PAGES",
};

/** Servidor MCP de verdade (SDK) com as tools de scripts, ligado a um cliente em memória. */
async function connectedScriptsClient() {
  const { registerScriptTools } =
    await import("@/lib/Modules/Mcp/Tools/Scripts");
  const mcpServer = new McpServer({ name: "kastir-test", version: "1.0.0" });
  registerScriptTools(mcpServer, context);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    mcpServer.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, mcpServer };
}

/**
 * Chama a tool e devolve o texto da recusa do SDK (validação do `inputSchema` antes do
 * handler). Falha o teste se a chamada não for recusada.
 */
async function refusalText(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, name).toBe(true);
  return JSON.stringify(result.content);
}

describe("MCP scripts pageIds (escopo de páginas)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSnippet.mockResolvedValue({
      id: "snip-1",
      name: "Popup",
      status: "DRAFT",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    // O update devolve o hash e os bytes do conteúdo gravado, então o registro precisa de `content`.
    updateSnippet.mockResolvedValue({
      id: "snip-1",
      name: "Popup",
      content: "<div>hi</div>",
      status: "DRAFT",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("advertises pageIds as a bounded array in tools/list for create and update", async () => {
    const { client, mcpServer } = await connectedScriptsClient();

    const { tools } = await client.listTools();

    for (const name of ["kastir_scripts_create", "kastir_scripts_update"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      const properties = tool?.inputSchema.properties as
        Record<string, Record<string, unknown>> | undefined;
      expect(properties?.pageIds, name).toMatchObject({
        type: "array",
        maxItems: SCOPE_PAGE_IDS_MAX,
        items: { type: "string" },
      });
    }

    await client.close();
    await mcpServer.close();
  });

  it("refuses non-cuid ids and one id over the cap before the handler, without reaching the Service or echoing the payload", async () => {
    const { client, mcpServer } = await connectedScriptsClient();
    const hostile = "<img src=x onerror=alert(1)>";
    const overLimit = Array.from({ length: SCOPE_PAGE_IDS_MAX + 1 }, (_, i) =>
      cuid(i + 1),
    );

    for (const pageIds of [["page-1"], [cuid(1), hostile], overLimit]) {
      const create = await refusalText(client, "kastir_scripts_create", {
        ...scriptBase,
        pageIds,
      });
      expect(create).toContain(
        "Invalid arguments for tool kastir_scripts_create",
      );

      const update = await refusalText(client, "kastir_scripts_update", {
        id: "snip-1",
        pageIds,
      });
      expect(update).toContain(
        "Invalid arguments for tool kastir_scripts_update",
      );

      // A recusa aponta o campo, nunca o valor enviado.
      for (const text of [create, update]) {
        expect(text).toContain("pageIds");
        expect(text).not.toContain("onerror");
        expect(text).not.toContain("page-1");
      }
    }

    expect(createSnippet).not.toHaveBeenCalled();
    expect(updateSnippet).not.toHaveBeenCalled();

    await client.close();
    await mcpServer.close();
  });

  it("hands the Service trimmed ids with repeats collapsed, and accepts exactly the cap", async () => {
    const { client, mcpServer } = await connectedScriptsClient();
    const atLimit = Array.from({ length: SCOPE_PAGE_IDS_MAX }, (_, i) =>
      cuid(i + 1),
    );

    const created = await client.callTool({
      name: "kastir_scripts_create",
      arguments: {
        ...scriptBase,
        pageIds: [` ${cuid(2)} `, cuid(2), cuid(1), cuid(1)],
      },
    });
    expect(created.isError).toBeFalsy();
    expect(createSnippet.mock.calls[0]?.[1]).toMatchObject({
      pageIds: [cuid(2), cuid(1)],
    });

    const updated = await client.callTool({
      name: "kastir_scripts_update",
      arguments: { id: "snip-1", pageIds: atLimit },
    });
    expect(updated.isError).toBeFalsy();
    expect(updateSnippet.mock.calls[0]?.[1]).toMatchObject({
      pageIds: atLimit,
    });

    await client.close();
    await mcpServer.close();
  });
});
