import { describe, expect, it, vi } from "vitest";

import {
  ensureScope,
  MCP_TEXT_SLICE_DEFAULT,
  MCP_TEXT_SLICE_MAX,
  readMcpTextSlice,
  runMcpReadTool,
  runMcpScopedTool,
  toMcpSuccess,
  toMcpToolError,
  toMcpToolJson,
} from "@/lib/Modules/Mcp/Tools/Shared";

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read", "cms:pages:write"] as const,
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

describe("MCP tool shared execution", () => {
  it("serializes successful tool data as JSON text only (no structuredContent)", () => {
    const result = toMcpToolJson({ ok: true });
    expect(result).toEqual({
      content: [{ type: "text", text: '{"ok":true}' }],
    });
    expect(result).not.toHaveProperty("structuredContent");
  });

  it("serializes non-object values as JSON text only", () => {
    expect(toMcpToolJson("plain string")).toEqual({
      content: [{ type: "text", text: '"plain string"' }],
    });
    expect(toMcpToolJson([1, 2, 3])).toEqual({
      content: [{ type: "text", text: "[1,2,3]" }],
    });
  });

  it("builds plain success payloads without data unless provided", () => {
    expect(toMcpSuccess("done")).toEqual({ ok: true, summary: "done" });
    expect(toMcpSuccess("done")).not.toHaveProperty("data");
    expect(toMcpSuccess("created", { id: 1 })).toEqual({
      ok: true,
      summary: "created",
      data: { id: 1 },
    });
    const wrapped = toMcpToolJson(toMcpSuccess("x", { id: "p1" }));
    expect(JSON.parse(wrapped.content[0].text)).toEqual({
      ok: true,
      summary: "x",
      data: { id: "p1" },
    });
    expect(wrapped).not.toHaveProperty("structuredContent");
  });

  it("reads text in blocks with contentTotal and optional nextStart", () => {
    expect(readMcpTextSlice("abcdef")).toEqual({ contentTotal: 6 });
    expect(readMcpTextSlice("abcdef")).not.toHaveProperty("content");

    expect(
      readMcpTextSlice("abcdef", { contentStart: 2, contentLength: 2 }),
    ).toEqual({
      content: "cd",
      contentStart: 2,
      contentLength: 2,
      contentTotal: 6,
      nextStart: 4,
    });

    expect(
      readMcpTextSlice("abcdef", { contentStart: 4, contentLength: 10 }),
    ).toEqual({
      content: "ef",
      contentStart: 4,
      contentLength: 2,
      contentTotal: 6,
    });

    expect(readMcpTextSlice("abcdef", { contentStart: 100 })).toEqual({
      content: "",
      contentStart: 100,
      contentLength: 0,
      contentTotal: 6,
    });

    const long = "x".repeat(MCP_TEXT_SLICE_MAX + 50);
    const clamped = readMcpTextSlice(long, {
      contentStart: 0,
      contentLength: MCP_TEXT_SLICE_MAX + 999,
    });
    expect(clamped.contentLength).toBe(MCP_TEXT_SLICE_MAX);
    expect(clamped.content?.length).toBe(MCP_TEXT_SLICE_MAX);
    expect(clamped.nextStart).toBe(MCP_TEXT_SLICE_MAX);

    const defaultBlock = readMcpTextSlice(
      "y".repeat(MCP_TEXT_SLICE_DEFAULT + 10),
      {
        contentStart: 0,
      },
    );
    expect(defaultBlock.contentLength).toBe(MCP_TEXT_SLICE_DEFAULT);
  });

  it("keeps known error codes and hides unknown error details", () => {
    expect(toMcpToolError({ code: "CONFLICT", message: "stale" })).toEqual({
      content: [
        {
          type: "text",
          text: '{"error":{"code":"INTERNAL_ERROR","message":"MCP tool failed"}}',
        },
      ],
      isError: true,
    });
    expect(
      toMcpToolError(Object.assign(new Error("stale"), { code: "CONFLICT" })),
    ).toEqual({
      content: [
        {
          type: "text",
          text: '{"error":{"code":"CONFLICT","message":"stale"}}',
        },
      ],
      isError: true,
    });
  });

  it("runs read handlers only with cms:read", async () => {
    const handler = vi.fn().mockResolvedValue({ id: "page-1" });

    await expect(runMcpReadTool(context, handler)).resolves.toEqual({
      content: [{ type: "text", text: '{"id":"page-1"}' }],
    });
    await expect(
      runMcpReadTool({ ...context, scopes: [] }, handler),
    ).resolves.toMatchObject({ isError: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("maps scoped handler errors to the stable MCP error envelope", async () => {
    const handler = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("stale"), { code: "CONFLICT" }),
      );

    await expect(
      runMcpScopedTool(context, "cms:pages:write", handler),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: '{"error":{"code":"CONFLICT","message":"stale"}}',
        },
      ],
      isError: true,
    });
  });

  it("enforces a requested scope at the shared boundary", () => {
    expect(() => ensureScope(context, "cms:pages:write")).not.toThrow();
    expect(() => ensureScope(context, "cms:pages:publish")).toThrow(
      /MCP scope is not granted/,
    );
  });
});
