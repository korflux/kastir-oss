import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Imports estáticos de propósito: a rota, o SDK oficial e o registry (mockado abaixo) são o
// grafo pesado deste arquivo. Carregá-lo na fase de coleta, que não tem timeout por teste,
// faz o timeout padrão medir só o que cada teste afirma. Com `import()` dentro do teste, o
// primeiro teste pagava o carregamento a frio (centenas de ms sozinho, vários segundos com a
// suíte concorrente) e estourava os 5 s. O `vi.mock` abaixo é içado pelo Vitest acima destes
// imports; o `vi.resetModules()` de tests/setup.ts não afeta referências já importadas.
// ponytail: a coleta não tem timeout por arquivo, então um import travado só cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import { POST } from "@/app/api/mcp/route";
import { MCP_MAX_BATCH_ITEMS } from "@/lib/Modules/Mcp/RateLimit";
import { normalizeMcpToolResponse } from "@/lib/Modules/Mcp/ResponseNormalization";
import { createMcpServer } from "@/lib/Modules/Mcp/ToolRegistry";

vi.mock("server-only", () => ({}));

const authenticateMcpRequest = vi.hoisted(() => vi.fn());
const assertMcpRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Mcp/TokenVerification", () => ({
  authenticateMcpRequest,
  getMcpBearerToken: (authorization: string | null) => {
    const parts = authorization?.trim().split(" ").filter(Boolean);
    if (!parts || parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      const error = new Error("MCP authentication failed") as Error & {
        code: string;
        status: number;
      };
      error.code = "UNAUTHENTICATED";
      error.status = 401;
      throw error;
    }
    return parts[1];
  },
}));

vi.mock("@/lib/Modules/Mcp/RateLimit", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/Modules/Mcp/RateLimit")
  >("@/lib/Modules/Mcp/RateLimit");
  return {
    ...actual,
    assertMcpRateLimit,
    getMcpRateLimitKind: vi.fn(() => "read"),
  };
});

vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
  },
}));

/**
 * Registry de teste: SDK oficial real, com uma ferramenta sonda cujo `inputSchema` tem a
 * mesma forma do `pageIds` de `kastir_scripts_create` (itens cuid aparados). Assim a recusa
 * de validação que os testes abaixo observam é a produzida pelo SDK instalado, não um texto
 * sintético que possa divergir dele.
 */
vi.mock("@/lib/Modules/Mcp/ToolRegistry", async () => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { z } = await import("zod");
  return {
    createMcpServer: () => {
      const server = new McpServer({ name: "kastir-cms", version: "test" });
      server.registerTool(
        "kastir_scripts_create",
        {
          inputSchema: z
            .object({ pageIds: z.array(z.string().trim().cuid()).optional() })
            .strict(),
        },
        async () => ({ content: [{ type: "text", text: '{"ok":true}' }] }),
      );
      return server;
    },
  };
});

/** Contexto OAuth mínimo que `authenticateMcpRequest` devolve nos testes de transporte. */
const authContext = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN",
  scopes: ["cms:read"],
  clientId: "test-client",
  resource: "http://localhost:3000/api/mcp",
  requestId: "request-123",
};

/** Valor hostil enviado em `pageIds`; nunca pode voltar ao cliente. */
const HOSTILE_PAGE_ID = "<img src=x onerror=alert(1)>";

/** Corpo JSON-RPC de `tools/call` para a ferramenta sonda com um `pageIds` inválido. */
const invalidPageIdsCall = {
  jsonrpc: "2.0",
  id: 11,
  method: "tools/call",
  params: {
    name: "kastir_scripts_create",
    arguments: { pageIds: [HOSTILE_PAGE_ID] },
  },
};

/** Envelope estável que o cliente MCP deve receber para essa recusa. */
const expectedValidationEnvelope = {
  jsonrpc: "2.0",
  id: 11,
  result: {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid arguments for tool kastir_scripts_create",
          },
        }),
      },
    ],
    isError: true,
  },
};

describe("MCP Streamable HTTP transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("returns the OAuth challenge before creating a server without a Bearer token", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/mcp", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"',
    );
    expect(authenticateMcpRequest).not.toHaveBeenCalled();
    expect(assertMcpRateLimit).not.toHaveBeenCalled();
  });

  it("serves an authenticated stateless initialize request through the official SDK", async () => {
    authenticateMcpRequest.mockResolvedValueOnce({
      actor: {
        id: "user-1",
        name: "Admin",
        email: "admin@example.test",
      },
      userId: "user-1",
      role: "ADMIN",
      scopes: ["cms:read"],
      clientId: "test-client",
      resource: "http://localhost:3000/api/mcp",
      requestId: "request-123",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer opaque-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect((await response.json()).result.serverInfo.name).toBe("kastir-cms");
    expect(assertMcpRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "opaque-token",
      "read",
    );
  });

  it("returns 429 before authentication when the token rate limit is exhausted", async () => {
    assertMcpRateLimit.mockRejectedValueOnce({
      code: "RATE_LIMITED",
      status: 429,
      message: "MCP rate limit exceeded",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer opaque-token" },
      }),
    );

    expect(response.status).toBe(429);
    expect(authenticateMcpRequest).not.toHaveBeenCalled();
  });

  /** Prova que o transporte rejeita o tamanho declarado antes de processar o token. */
  it("rejects a declared oversized body before rate limit and authentication", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer opaque-token",
          "content-length": String(28 * 1024 * 1024 + 1),
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "MCP request body too large",
      },
    });
    expect(assertMcpRateLimit).not.toHaveBeenCalled();
    expect(authenticateMcpRequest).not.toHaveBeenCalled();
  });

  /** Prova que transferências sem Content-Length também respeitam o teto real. */
  it("stops reading a streamed body when it exceeds the transport limit", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
        emitted += chunk.byteLength;
        if (emitted > 28 * 1024 * 1024) controller.close();
      },
    });
    const request = {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer opaque-token" }),
      body,
    } as Request;
    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(assertMcpRateLimit).not.toHaveBeenCalled();
    expect(authenticateMcpRequest).not.toHaveBeenCalled();
  });

  it("rejects a JSON-RPC batch above the item cap before rate limit", async () => {
    const batch = Array.from({ length: MCP_MAX_BATCH_ITEMS + 1 }, (_, id) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "kastir_pages_list" },
    }));

    const response = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer opaque-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "MCP request body too large",
      },
    });
    expect(assertMcpRateLimit).not.toHaveBeenCalled();
    expect(authenticateMcpRequest).not.toHaveBeenCalled();
  });

  it("normalizes SDK input validation failures to the MCP tool error envelope", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "kastir_pages_list", arguments: { pageSize: 101 } },
    };
    const response = new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        error: {
          code: -32602,
          message:
            "Input validation error: Invalid arguments for tool kastir_pages_list",
        },
      }),
      { headers: { "content-type": "application/json" } },
    );

    const normalized = await normalizeMcpToolResponse(response, body);

    expect(await normalized.json()).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: "VALIDATION_ERROR",
                message: "Invalid arguments for tool kastir_pages_list",
              },
            }),
          },
        ],
        isError: true,
      },
    });

    const sdkResult = new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        result: {
          content: [
            {
              type: "text",
              text: "Input validation error: Invalid arguments for tool kastir_settings_get",
            },
          ],
          isError: true,
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    const normalizedResult = await normalizeMcpToolResponse(sdkResult, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "kastir_settings_get", arguments: {} },
    });

    expect(await normalizedResult.json()).toMatchObject({
      result: {
        content: [
          {
            text: JSON.stringify({
              error: {
                code: "VALIDATION_ERROR",
                message: "Invalid arguments for tool kastir_settings_get",
              },
            }),
          },
        ],
        isError: true,
      },
    });
  });

  /**
   * Caminho real de `app/api/mcp/route.ts`: o SDK instalado recusa o `pageIds` inválido e o
   * transporte entrega ao cliente o envelope estável, sem o detalhe do zod nem o valor enviado.
   */
  it("serves the stable VALIDATION_ERROR envelope for an SDK-refused tool call through the route", async () => {
    authenticateMcpRequest.mockResolvedValueOnce(authContext);
    const response = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer opaque-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(invalidPageIdsCall),
      }),
    );

    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual(expectedValidationEnvelope);
    // Nada do SDK/zod vaza: nem o valor enviado, nem o campo, nem o prefixo do McpError.
    for (const leaked of [
      HOSTILE_PAGE_ID,
      "onerror",
      "pageIds",
      "Invalid cuid",
      "-32602",
      "Input validation error",
    ]) {
      expect(raw).not.toContain(leaked);
    }
  });

  /**
   * Fixa o contrato com o SDK instalado: sem o normalizador, a recusa chega como resultado de
   * ferramenta com o texto do McpError (prefixo `MCP error -32602: ` + detalhe do zod). Se uma
   * atualização do SDK mudar essa forma, este teste falha em vez de o vazamento passar calado.
   */
  it("normalizes the exact text the installed SDK emits for an input validation refusal", async () => {
    const server = await createMcpServer(authContext as never);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    await server.connect(transport);

    const sdkResponse = await transport.handleRequest(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(invalidPageIdsCall),
      }),
      { parsedBody: invalidPageIdsCall },
    );

    const sdkPayload = await sdkResponse.clone().json();
    expect(sdkPayload.result.isError).toBe(true);
    expect(sdkPayload.result.content[0].text).toMatch(
      /^MCP error -32602: Input validation error: Invalid arguments for tool kastir_scripts_create: /,
    );

    const normalized = await normalizeMcpToolResponse(
      sdkResponse,
      invalidPageIdsCall,
    );
    expect(await normalized.json()).toEqual(expectedValidationEnvelope);

    await server.close();
  });

  /** O prefixo do McpError também vale no erro JSON-RPC -32602; o reconhecimento é estrito. */
  it("recognizes the McpError prefix on both response shapes and rejects look-alike text", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "kastir_pages_list", arguments: {} },
    };
    const refusal =
      "MCP error -32602: Input validation error: Invalid arguments for tool kastir_pages_list: Too big: expected number to be <=100 at pageSize";
    const expected = {
      jsonrpc: "2.0",
      id: 9,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: {
                code: "VALIDATION_ERROR",
                message: "Invalid arguments for tool kastir_pages_list",
              },
            }),
          },
        ],
        isError: true,
      },
    };
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), {
        headers: { "content-type": "application/json" },
      });

    const asResult = await normalizeMcpToolResponse(
      json({
        jsonrpc: "2.0",
        id: 9,
        result: { content: [{ type: "text", text: refusal }], isError: true },
      }),
      body,
    );
    expect(await asResult.json()).toEqual(expected);

    const asRpcError = await normalizeMcpToolResponse(
      json({
        jsonrpc: "2.0",
        id: 9,
        error: { code: -32602, message: refusal },
      }),
      body,
    );
    expect(await asRpcError.json()).toEqual(expected);

    // Texto que apenas menciona a frase, ou outro código do McpError, não é reescrito.
    for (const text of [
      `Page title: ${refusal}`,
      `{"title":"${refusal}"}`,
      "MCP error -32601: Input validation error: Invalid arguments for tool kastir_pages_list",
      "mcp error -32602: Input validation error: Invalid arguments for tool kastir_pages_list",
    ]) {
      const payload = {
        jsonrpc: "2.0",
        id: 9,
        result: { content: [{ type: "text", text }], isError: true },
      };
      const untouched = await normalizeMcpToolResponse(json(payload), body);
      expect(await untouched.json()).toEqual(payload);
    }
  });
});
