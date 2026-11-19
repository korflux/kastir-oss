import { beforeEach, describe, expect, it, vi } from "vitest";

// Import estático de propósito: o módulo de rate limit e o que ele importa carregam na fase
// de coleta, que não tem timeout por teste, e o timeout padrão passa a medir só o que cada
// teste afirma. Com `import()` dentro do teste, o primeiro teste pagava o carregamento a
// frio (centenas de ms sozinho, vários segundos com a suíte concorrente) e estourava os
// 5 s. Os `vi.mock` abaixo são içados pelo Vitest acima deste import.
// O `Map` de limiters de RateLimit.ts agora nasce uma vez por arquivo, não a cada teste (o
// `vi.resetModules()` de tests/setup.ts não afeta referências já importadas). É seguro
// porque toda instância do `Ratelimit` mockado usa o mesmo `limit` hoisted e nenhum teste
// conta construções de `Ratelimit` nem chamadas a `fixedWindow`. Teste novo que precise de
// limiter recém-criado deve chamar `createMcpRateLimiter` direto.
// ponytail: a coleta não tem timeout por arquivo, então um import travado só cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import {
  assertMcpBatchSize,
  assertMcpRateLimit,
  getMcpRateLimitKind,
  MCP_MAX_BATCH_ITEMS,
} from "@/lib/Modules/Mcp/RateLimit";

const { limit, Ratelimit } = vi.hoisted(() => {
  const limit = vi.fn();
  class Ratelimit {
    static fixedWindow = vi.fn(() => ({}));
    limit = limit;
  }
  return { limit, Ratelimit };
});

vi.mock("@upstash/ratelimit", () => ({ Ratelimit }));

vi.mock("@/lib/env", () => ({
  env: { REDIS_URL: "redis://localhost:6379", AUTH_TRUST_PROXY: true },
}));

vi.mock("@/lib/ratelimit", () => ({
  createRedisRateLimitClient: vi.fn(() => ({})),
}));

describe("MCP rate limit classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps read operations on the larger read window", async () => {
    expect(
      getMcpRateLimitKind({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "kastir_pages_list" },
      }),
    ).toBe("read");
  });

  it("uses the stricter window for mutating and unknown tool calls", async () => {
    expect(
      getMcpRateLimitKind({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "kastir_pages_publish" },
      }),
    ).toBe("mutation");
    expect(
      getMcpRateLimitKind({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "unknown_tool" },
      }),
    ).toBe("mutation");
  });

  // Regression: substring matching put settings_update in the read bucket and
  // split_tests_stats (a read) in the mutation bucket.
  it("classifies by suffix, not substring", async () => {
    const kindOf = (name: string) =>
      getMcpRateLimitKind({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name },
      });

    expect(kindOf("kastir_settings_update")).toBe("mutation");
    expect(kindOf("kastir_settings_get")).toBe("read");
    expect(kindOf("kastir_split_tests_stats")).toBe("read");
    expect(kindOf("kastir_scripts_scope_pages_list")).toBe("read");
    expect(kindOf("kastir_site_get_context")).toBe("read");
    expect(kindOf("kastir_operation_get")).toBe("read");
    expect(kindOf("kastir_media_download")).toBe("read");
    expect(kindOf("kastir_pages_preview")).toBe("read");
    expect(kindOf("kastir_media_convert_to_webp")).toBe("mutation");
    expect(kindOf("kastir_split_tests_destinations_reorder")).toBe("mutation");
    expect(kindOf("kastir_scripts_trash")).toBe("mutation");
    expect(kindOf("kastir_split_tests_trash")).toBe("mutation");
    expect(kindOf("kastir_media_upload")).toBe("mutation");
    expect(kindOf("kastir_media_replace")).toBe("mutation");
    // A15: o patch grava conteúdo e fica no bucket de mutation (30 por 60 s), não no de leitura.
    expect(kindOf("kastir_pages_patch")).toBe("mutation");
    expect(kindOf("kastir_scripts_patch")).toBe("mutation");
  });

  function mcpRequest(ip: string) {
    return new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    });
  }

  it("allows a request when Redis accepts the token and IP buckets", async () => {
    limit.mockResolvedValue({ success: true });

    await expect(
      assertMcpRateLimit(mcpRequest("203.0.113.10"), "opaque-token", "read"),
    ).resolves.toBeUndefined();
    expect(limit).toHaveBeenCalledWith(expect.stringMatching(/^token:/));
    expect(limit).toHaveBeenCalledWith(expect.stringMatching(/^ip:/));
  });

  it("keeps the same IP bucket when the token rotates from one client", async () => {
    limit.mockResolvedValue({ success: true });
    const request = mcpRequest("203.0.113.10");

    await assertMcpRateLimit(request, "junk-token-a", "read");
    await assertMcpRateLimit(request, "junk-token-b", "read");

    const ipKeys = limit.mock.calls
      .map(([key]) => key as string)
      .filter((key) => key.startsWith("ip:"));
    const tokenKeys = limit.mock.calls
      .map(([key]) => key as string)
      .filter((key) => key.startsWith("token:"));

    expect(ipKeys).toHaveLength(2);
    expect(ipKeys[0]).toBe(ipKeys[1]);
    expect(tokenKeys[0]).not.toBe(tokenKeys[1]);
  });

  it("returns a stable 429 when the token bucket is exhausted", async () => {
    limit
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });

    await expect(
      assertMcpRateLimit(
        mcpRequest("203.0.113.10"),
        "opaque-token",
        "mutation",
      ),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
  });

  it("returns a stable 503 when Redis cannot evaluate the limit", async () => {
    limit.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(
      assertMcpRateLimit(mcpRequest("203.0.113.10"), "opaque-token", "read"),
    ).rejects.toMatchObject({
      code: "MCP_RATE_LIMIT_UNAVAILABLE",
      status: 503,
    });
  });

  it("rejects a JSON-RPC batch above the item cap with 413", async () => {
    const batch = Array.from({ length: MCP_MAX_BATCH_ITEMS + 1 }, () => ({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "kastir_pages_list" },
    }));

    expect(() => assertMcpBatchSize(batch)).toThrow(
      expect.objectContaining({
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
      }),
    );
    expect(() =>
      assertMcpBatchSize(batch.slice(0, MCP_MAX_BATCH_ITEMS)),
    ).not.toThrow();
  });
});
