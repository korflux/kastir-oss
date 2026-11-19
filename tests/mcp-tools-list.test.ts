import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { vi } from "vitest";

import {
  EXPECTED_FULL_TOOL_NAMES,
  EXPECTED_READ_ONLY_TOOL_NAMES,
  FORBIDDEN_MCP_TOOL_NAMES,
} from "@/tests/fixtures/mcp-tool-contract";
// Import estático de propósito: o registry puxa as tools, o SDK e os schemas zod (grafo pesado
// que só os Services mockados abaixo aliviam). Na coleta, que não tem timeout por teste, o
// carregamento a frio não consome os 5 s do primeiro teste; com `import()` dentro de
// `connectedClient` ele estourava sob a suíte concorrente. O `vi.mock` abaixo é içado pelo
// Vitest acima deste import, e o `vi.resetModules()` de tests/setup.ts não afeta a referência.
// O registry não guarda estado entre chamadas: cada `createMcpServer` monta um servidor novo.
// ponytail: a coleta não tem timeout por arquivo, então um import travado só cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import { createMcpServer } from "@/lib/Modules/Mcp/ToolRegistry";

const getJob = vi.hoisted(() => vi.fn());
const getSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Pages/Service", () => ({ pageService: {} }));
vi.mock("@/lib/Modules/Pages/FolderService", () => ({ folderService: {} }));
vi.mock("@/lib/Modules/Media/Service", () => ({ mediaService: {} }));
vi.mock("@/lib/Modules/Media/FolderService", () => ({
  mediaFolderService: {},
}));
vi.mock("@/lib/Modules/CustomCode/Service", () => ({ customCodeService: {} }));
vi.mock("@/lib/Modules/Settings/Service", () => ({
  settingsService: { getSettings },
}));
vi.mock("@/lib/Modules/SplitTests/Service", () => ({ splitTestsService: {} }));
vi.mock("@/lib/Modules/Logs/Service", () => ({ logsService: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Publishing/queue", () => ({
  TRACKED_JOB_RETENTION: { age: 3600, count: 1000 },
  getPublishingQueue: () => ({ getJob }),
}));
vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
    NEXTAUTH_SECRET: "test-secret",
  },
}));

const fullScopes = [
  "cms:read",
  "cms:pages:write",
  "cms:pages:publish",
  "cms:pages:unpublish",
  "cms:media:write",
  "cms:scripts:write",
  "cms:scripts:publish",
  "cms:scripts:unpublish",
  "cms:split-tests:write",
  "cms:settings:write",
  "cms:logs:read",
] as const;

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: fullScopes,
  clientId: "client-1",
  resource: "http://localhost:3000/api/mcp",
  requestId: "request-1",
};

const settingsFixture = {
  id: "singleton",
  siteTitle: "Kastir",
  tagline: "CMS",
  seoDescription: "Public description",
  faviconMediaId: null,
  siteUrl: "http://localhost:3000",
  siteLanguage: "en",
  timezone: "UTC",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "24H",
  weekStartsOn: "MONDAY",
  homePageId: null,
  indexable: true,
  allowAiCrawlers: true,
  sitemapEnabled: true,
  notFoundPageId: null,
  notFoundRedirectToHome: false,
  cloudflareApiTokenEncrypted: "secret",
  cloudflareZoneId: "zone",
  webpConversionEnabled: true,
  revisionRetentionLimit: 5,
  cloudflareApiTokenConfigured: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

async function connectedClient(
  scopes: readonly string[] = fullScopes,
  role: "ADMIN" | "EDITOR" | "MASTER" = "ADMIN",
) {
  getSettings.mockResolvedValue(settingsFixture);
  const server = await createMcpServer({
    ...context,
    role,
    scopes: scopes as typeof fullScopes,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
}

describe("MCP tools/list", () => {
  it("lists every registered tool without a JSON Schema conversion error", async () => {
    const { client, server } = await connectedClient();

    const { tools } = await client.listTools();

    expect([...tools.map((tool) => tool.name)].sort()).toEqual(
      [...EXPECTED_FULL_TOOL_NAMES].sort(),
    );

    for (const tool of tools) {
      expect(tool.title, `expected ${tool.name} to have a title`).toBeTruthy();
      expect(
        tool.annotations,
        `expected ${tool.name} to have annotations`,
      ).toBeDefined();
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint).toBe("boolean");
      expect(typeof tool.annotations?.idempotentHint).toBe("boolean");
      expect(typeof tool.annotations?.openWorldHint).toBe("boolean");
    }

    for (const name of [
      "kastir_scripts_get",
      "kastir_scripts_update",
      "kastir_scripts_publish",
    ] as const) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.description).toMatch(/server does not execute/i);
      expect(tool?.description).toMatch(/browser/i);
    }
    for (const name of [
      "kastir_scripts_publish",
      "kastir_scripts_unpublish",
      "kastir_scripts_activate",
      "kastir_scripts_trash",
      "kastir_split_tests_trash",
      "kastir_media_replace",
    ] as const) {
      expect(
        tools.find((candidate) => candidate.name === name)?.annotations
          ?.destructiveHint,
      ).toBe(true);
    }
    expect(
      tools.find((tool) => tool.name === "kastir_media_upload")?.annotations
        ?.destructiveHint,
    ).toBe(false);

    const namesWithConcurrencyGuard = [
      "kastir_pages_update",
      "kastir_scripts_update",
      "kastir_split_tests_update",
      "kastir_split_tests_destinations_update",
    ];
    for (const name of namesWithConcurrencyGuard) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected ${name} to be registered`).toBeDefined();
      const property = (tool!.inputSchema.properties as Record<string, unknown>)
        .expectedUpdatedAt as { type?: string } | undefined;
      // The raw domain schema uses z.coerce.date(), which zod's JSON Schema
      // converter rejects outright ("Date cannot be represented in JSON
      // Schema"). That throw happens inside the SDK's tools/list handler and
      // is not caught per-tool, so one bad field breaks the entire tool list.
      expect(property?.type).toBe("string");
    }

    // Popup trigger must stay visible in tools/list so agents can discover shapes
    // without a MCP-safe schema mirror (discriminatedUnion converts cleanly).
    for (const name of [
      "kastir_scripts_create",
      "kastir_scripts_update",
    ] as const) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `expected ${name} to be registered`).toBeDefined();
      const properties = tool!.inputSchema.properties as Record<
        string,
        unknown
      >;
      expect(
        properties.trigger,
        `expected ${name}.inputSchema.properties.trigger`,
      ).toBeDefined();
    }

    for (const name of [
      "kastir_scripts_publish",
      "kastir_scripts_unpublish",
      "kastir_scripts_activate",
    ] as const) {
      const tool = tools.find((candidate) => candidate.name === name);
      const confirmation = (
        tool!.inputSchema.properties as Record<string, unknown>
      ).confirmation as { type?: string } | undefined;
      expect(confirmation?.type, `${name} confirmation schema`).toBe("string");
    }

    await client.close();
    await server.close();
  });

  // A20: o contrato do patch, do hash de conteúdo e do diff contra o rascunho chega ao agente
  // pelo tools/list, que é o que ele lê antes da guia.
  it("A20: advertises the content patch contract, the content hash and the draft diff", async () => {
    const { client, server } = await connectedClient();
    const { tools } = await client.listTools();
    const tool = (name: string) => {
      const found = tools.find((candidate) => candidate.name === name);
      expect(found, `expected ${name} to be registered`).toBeDefined();
      return found!;
    };

    for (const name of [
      "kastir_pages_patch",
      "kastir_scripts_patch",
    ] as const) {
      const { description, inputSchema } = tool(name);
      expect(tool(name).annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
      });
      // Limites de entrada da decisão 6 da spec, na descrição que o agente lê.
      expect(description).toContain("search/replace");
      expect(description).toContain("expectedContentSha256");
      expect(description).toContain("1-50");
      expect(description).toMatch(/old non-empty/);
      expect(description).toContain("64 hex");
      expect(description).toContain("2 MiB UTF-8");

      // E no JSON Schema: allowlist estrita, hash obrigatório de 64 hexadecimais, 1 a 50 operações.
      expect(inputSchema.additionalProperties).toBe(false);
      expect([...(inputSchema.required ?? [])].sort()).toEqual(
        ["expectedContentSha256", "id", "operations"].sort(),
      );
      expect(inputSchema.properties).toMatchObject({
        expectedContentSha256: {
          type: "string",
          pattern: "^[0-9a-fA-F]{64}$",
        },
        operations: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["old", "new"],
            properties: {
              old: { type: "string", minLength: 1 },
              new: { type: "string" },
            },
          },
        },
      });
    }

    // Updates aceitam o hash esperado (opcional) e devolvem o hash do gravado.
    for (const name of [
      "kastir_pages_update",
      "kastir_scripts_update",
    ] as const) {
      const { description, inputSchema } = tool(name);
      expect(description).toContain("expectedContentSha256");
      expect(description).toContain("contentSha256");
      expect(inputSchema.properties).toMatchObject({
        expectedContentSha256: {
          type: "string",
          pattern: "^[0-9a-fA-F]{64}$",
        },
      });
      expect(inputSchema.required ?? []).not.toContain("expectedContentSha256");
    }

    // Gets trazem hash e bytes além de contentTotal (UTF-16).
    for (const name of ["kastir_pages_get", "kastir_scripts_get"] as const) {
      expect(tool(name).description).toContain("contentSha256");
      expect(tool(name).description).toContain("contentBytes");
    }
    expect(tool("kastir_pages_get").description).toContain("UTF-16");

    // Conferência antes de publicar: diff da revisão publicada contra o rascunho.
    for (const name of [
      "kastir_pages_revisions_diff",
      "kastir_scripts_revisions_diff",
    ] as const) {
      expect(tool(name).description).toContain('to="draft"');
      expect(tool(name).description).toContain("publishedRevisionId");
    }

    await client.close();
    await server.close();
  });

  it("exposes non-empty instructions on initialize without secrets", async () => {
    const { client, server } = await connectedClient();
    const instructions = client.getInstructions();
    expect(instructions).toBeTruthy();
    expect(Buffer.byteLength(instructions ?? "", "utf8")).toBeLessThanOrEqual(
      3_000,
    );
    expect(instructions).toContain("Kastir");
    expect(instructions).not.toContain("secret");
    expect(instructions).not.toContain("cloudflare");
    expect(instructions).not.toMatch(/zone-secret|cloudflareZoneId/);
    expect(instructions).toContain("kastir_guide_get");

    await client.close();
    await server.close();
  });

  it("degrades instructions when settings cannot be loaded", async () => {
    getSettings.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = await createMcpServer({
      ...context,
      scopes: fullScopes as typeof fullScopes,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const instructions = client.getInstructions();
    expect(instructions).toContain("unavailable");
    expect(instructions).toContain("Draft vs published");
    expect(instructions).toContain("kastir_guide_get");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[mcp] instructions snapshot unavailable"),
      expect.any(Error),
    );

    warn.mockRestore();
    await client.close();
    await server.close();
  });

  it("filters tools/list by granted scopes", async () => {
    const full = await connectedClient(fullScopes);
    const { tools: fullTools } = await full.client.listTools();
    expect([...fullTools.map((tool) => tool.name)].sort()).toEqual(
      [...EXPECTED_FULL_TOOL_NAMES].sort(),
    );
    const fullBytes = Buffer.byteLength(JSON.stringify(fullTools), "utf8");
    // Phase 45 added 8 revision tools; measured full tools/list ≈ 41.9 kB.
    expect(fullBytes).toBeGreaterThan(25_000);
    expect(fullBytes).toBeLessThan(50_000);

    const readOnly = await connectedClient(["cms:read"]);
    const { tools: readTools } = await readOnly.client.listTools();
    const readNames = readTools.map((tool) => tool.name);

    expect([...readNames].sort()).toEqual(
      [...EXPECTED_READ_ONLY_TOOL_NAMES].sort(),
    );
    expect(readNames).toContain("kastir_pages_list");
    expect(readNames).toContain("kastir_site_get_context");
    expect(readNames).toContain("kastir_guide_get");
    expect(readNames).not.toContain("kastir_pages_create");
    expect(readNames).not.toContain("kastir_scripts_publish");
    expect(readNames).not.toContain("kastir_settings_update");
    expect(readNames).not.toContain("kastir_audit_logs_list");

    const readBytes = Buffer.byteLength(JSON.stringify(readTools), "utf8");
    expect(readBytes).toBeLessThan(fullBytes);

    // Mutation names must not appear for read-only tokens (inclui upload/replace da fase 39).
    for (const name of readNames) {
      expect(name).not.toMatch(
        /_(create|update|patch|publish|unpublish|activate|trash|restore|duplicate|convert|reorder|upload|replace)$/,
      );
    }

    await full.client.close();
    await full.server.close();
    await readOnly.client.close();
    await readOnly.server.close();
  });

  it("filters forged administrative scopes by the current role", async () => {
    const forgedEditor = await connectedClient(fullScopes, "EDITOR");
    const { tools } = await forgedEditor.client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).not.toContain("kastir_settings_update");
    expect(names).not.toContain("kastir_audit_logs_list");
    expect(names).toContain("kastir_scripts_update");

    await forgedEditor.client.close();
    await forgedEditor.server.close();
  });

  it("rejects unknown arguments instead of silently ignoring them", async () => {
    const { client, server } = await connectedClient();

    const result = await client.callTool({
      name: "kastir_pages_list",
      arguments: { page: 1, notARealField: "oops" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(
      /unrecognized|notARealField/i,
    );

    await client.close();
    await server.close();
  });

  it("returns text content only on success (no structuredContent)", async () => {
    getJob.mockResolvedValueOnce({
      data: {
        type: "media-webp",
        userId: context.userId,
        audit: { source: "MCP" },
        mediaFileId: "media-1",
      },
      getState: () => Promise.resolve("completed"),
    });

    const { client, server } = await connectedClient();
    const result = await client.callTool({
      name: "kastir_operation_get",
      arguments: { operationId: "job-1" },
    });

    expect(result.isError).toBeFalsy();
    expect(result).not.toHaveProperty("structuredContent");
    const text = Array.isArray(result.content)
      ? (result.content as { type: string; text?: string }[])
          .map((part) => part.text ?? "")
          .join("")
      : "";
    expect(JSON.parse(text)).toEqual({
      operationId: "job-1",
      status: "SUCCEEDED",
      resourceId: "media-1",
    });

    await client.close();
    await server.close();
  });

  it("keeps tool descriptions short enough for tools/list context cost", async () => {
    const { client, server } = await connectedClient();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      const max =
        tool.name === "kastir_pages_get" ||
        tool.name === "kastir_pages_preview" ||
        tool.name === "kastir_scripts_get"
          ? 240
          : 160;
      expect(
        (tool.description ?? "").length,
        `${tool.name} description is ${tool.description?.length} chars (max ${max})`,
      ).toBeLessThanOrEqual(max);
    }

    // Serialize tools/list payload to track discovery cost (T14 / phase 36).
    const serializedBytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    expect(serializedBytes).toBeGreaterThan(0);
    // Ceiling with ~20% headroom over the measured payload after T11–T12 (~41.9 kB).
    expect(serializedBytes).toBeLessThan(50_000);

    await client.close();
    await server.close();
  });

  it("keeps every forbidden delete name outside the MCP registry", async () => {
    const { client, server } = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "kastir_split_tests_list",
        "kastir_split_tests_get",
        "kastir_split_tests_stats",
        "kastir_split_tests_create",
        "kastir_split_tests_update",
        "kastir_split_tests_destinations_create",
        "kastir_split_tests_destinations_update",
        "kastir_split_tests_destinations_reorder",
        "kastir_scripts_trash",
        "kastir_split_tests_trash",
        "kastir_media_upload",
        "kastir_media_replace",
        "kastir_settings_update",
        "kastir_audit_logs_list",
        "kastir_guide_get",
      ]),
    );
    for (const forbidden of FORBIDDEN_MCP_TOOL_NAMES) {
      expect(names).not.toContain(forbidden);
    }

    await client.close();
    await server.close();
  });
});
