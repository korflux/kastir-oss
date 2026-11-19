import { describe, expect, it, vi } from "vitest";

// Imports estáticos de propósito: o módulo das tools de Scripts e o que ele importa carregam
// na fase de coleta, que não tem timeout por teste, e o timeout padrão passa a medir só o
// que cada teste afirma. Com `import()` dentro do teste, o primeiro teste pagava o
// carregamento a frio (centenas de ms sozinho, vários segundos com a suíte concorrente) e
// estourava os 5 s. O `vi.mock` abaixo é içado pelo Vitest acima destes imports, e os mocks
// são `vi.hoisted`: o `vi.resetModules()` de tests/setup.ts não afeta referências já
// importadas.
// ponytail: a coleta não tem timeout por arquivo, então um import travado só cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import {
  getMcpScript,
  listMcpScriptScopePages,
  listMcpScripts,
  registerScriptTools,
} from "@/lib/Modules/Mcp/Tools/Scripts";

const listSnippets = vi.hoisted(() => vi.fn());
const getSnippet = vi.hoisted(() => vi.fn());
const listScopePages = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/CustomCode/Service", () => ({
  customCodeService: { listSnippets, getSnippet, listScopePages },
}));

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read" as const],
  clientId: "client-1",
  resource: "http://localhost:3000/api/mcp",
  requestId: "request-1",
};

const script = {
  id: "script-1",
  name: "Analytics",
  location: "BODY_END" as const,
  content: "<script>window.analytics = true;</script>",
  status: "PUBLISHED" as const,
  priority: 10,
  scopeType: "SPECIFIC_PAGES" as const,
  scopedPages: [{ pageId: "page-1" }],
  triggerType: null as
    "SCROLL" | "PAGE_LOAD" | "SELECTOR_EVENT" | "REFERRER" | null,
  triggerConfig: null as { percentage: number } | null,
  maxDisplays: null as number | null,
  displayResetDays: null as number | null,
  createdAt: new Date("2026-07-20T10:00:00.000Z"),
  updatedAt: new Date("2026-07-22T10:00:00.000Z"),
};

describe("MCP Scripts read tools", () => {
  it("normalizes the existing list result and omits content from items", async () => {
    listSnippets.mockResolvedValueOnce({
      items: [{ ...script, content: undefined }],
      total: 3,
      page: 1,
      pageSize: 2,
    });
    const result = await listMcpScripts(context, { page: 1, pageSize: 2 });

    expect(result.items[0]).toMatchObject({
      id: "script-1",
      name: "Analytics",
      scopeType: "SPECIFIC_PAGES",
      triggerType: null,
      maxDisplays: null,
      displayResetDays: null,
    });
    expect(result.items[0]).not.toHaveProperty("content");
    expect(result.items[0]).not.toHaveProperty("triggerConfig");
    expect(result.pagination).toMatchObject({
      totalItems: 3,
      hasNextPage: true,
    });
    expect(result.items[0]).toMatchObject({ scopedPageIds: ["page-1"] });
    expect(result.items[0]).not.toHaveProperty("scopedPages");
  });

  it("returns metadata without content by default, and blocks on demand", async () => {
    getSnippet.mockResolvedValue({
      ...script,
      triggerType: "SCROLL",
      triggerConfig: { percentage: 50 },
      maxDisplays: 3,
      displayResetDays: 30,
    });
    await expect(
      getMcpScript(context, { scriptId: "script-1" }),
    ).resolves.toMatchObject({
      id: "script-1",
      contentTotal: script.content.length,
      triggerType: "SCROLL",
      triggerConfig: { percentage: 50 },
      maxDisplays: 3,
      displayResetDays: 30,
    });
    await expect(
      getMcpScript(context, { scriptId: "script-1", contentStart: 0 }),
    ).resolves.toMatchObject({
      content: script.content,
      contentTotal: script.content.length,
    });
  });

  it("A3: get devolve contentSha256, contentBytes e contentTotal do código", async () => {
    getSnippet.mockResolvedValueOnce({ ...script, content: "abc" });

    await expect(
      getMcpScript(context, { scriptId: "script-1" }),
    ).resolves.toMatchObject({
      contentSha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      contentBytes: 3,
      contentTotal: 3,
    });
  });

  // Tabela de A4: contentTotal em unidades UTF-16 e contentBytes em bytes UTF-8.
  it.each([
    { content: "abc", contentTotal: 3, contentBytes: 3 },
    { content: "é", contentTotal: 1, contentBytes: 2 },
    { content: "🚀", contentTotal: 2, contentBytes: 4 },
    { content: "<p>\r\n</p>", contentTotal: 9, contentBytes: 9 },
  ])(
    "A4: $contentTotal unidades UTF-16 e $contentBytes bytes UTF-8 para $content",
    async ({ content, contentTotal, contentBytes }) => {
      getSnippet.mockResolvedValueOnce({ ...script, content });

      await expect(
        getMcpScript(context, { scriptId: "script-1" }),
      ).resolves.toMatchObject({ contentTotal, contentBytes });
    },
  );

  it("A3: o hash e os bytes valem para o código inteiro, também quando o get devolve só um bloco", async () => {
    getSnippet.mockResolvedValueOnce({ ...script, content: "abc" });

    const block = await getMcpScript(context, {
      scriptId: "script-1",
      contentStart: 0,
      contentLength: 1,
    });

    expect(block).toMatchObject({
      content: "a",
      contentLength: 1,
      nextStart: 1,
      contentSha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      contentBytes: 3,
      contentTotal: 3,
    });
  });

  it("omits timestamps from script list items", async () => {
    listSnippets.mockResolvedValueOnce({
      items: [{ ...script, content: undefined }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const result = await listMcpScripts(context, {});
    expect(result.items[0]).not.toHaveProperty("createdAt");
    expect(result.items[0]).not.toHaveProperty("updatedAt");
  });

  it("requires cms:read before touching CustomCode", async () => {
    listSnippets.mockClear();
    await expect(
      listMcpScripts({ ...context, scopes: [] }, {}),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(listSnippets).not.toHaveBeenCalled();
  });

  it("returns eligible pages in the common pagination envelope", async () => {
    listScopePages.mockResolvedValueOnce({
      items: [{ id: "page-1", title: "Home", slug: "home" }],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    await expect(listMcpScriptScopePages(context, {})).resolves.toMatchObject({
      items: [{ id: "page-1" }],
      pagination: { totalItems: 1, hasNextPage: false },
    });
  });

  it("exposes only page filters for script scope selection", async () => {
    const server = { registerTool: vi.fn() };

    registerScriptTools(server as never, context);

    const registration = new Map(
      server.registerTool.mock.calls.map(([name, definition]) => [
        name,
        definition,
      ]),
    ).get("kastir_scripts_scope_pages_list") as {
      inputSchema: {
        safeParse: (input: unknown) => { success: boolean };
      };
    };

    expect(
      registration.inputSchema.safeParse({
        search: "home",
        page: 1,
        pageSize: 25,
      }).success,
    ).toBe(true);
    expect(
      registration.inputSchema.safeParse({ status: "DRAFT" }).success,
    ).toBe(false);
    expect(
      registration.inputSchema.safeParse({ location: "HEADER" }).success,
    ).toBe(false);
    expect(
      registration.inputSchema.safeParse({ scopeType: "SPECIFIC_PAGES" })
        .success,
    ).toBe(false);
  });
});
