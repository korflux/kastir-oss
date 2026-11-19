import { describe, expect, it, vi } from "vitest";

const trashSnippet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/CustomCode/Service", () => ({
  customCodeService: { trashSnippet },
}));

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read", "cms:scripts:write"] as const,
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

describe("MCP script trash tool", () => {
  it("moves the script to trash with MCP audit and a minimal response", async () => {
    const deletedAt = new Date("2026-08-09T12:00:00.000Z");
    trashSnippet.mockResolvedValueOnce({
      id: "script-1",
      name: "Sensitive name",
      content: "do not expose",
      status: "DRAFT",
      deletedAt,
      updatedAt: deletedAt,
    });
    const { trashMcpScript } = await import("@/lib/Modules/Mcp/Tools/Scripts");

    const result = await trashMcpScript(context, { scriptId: "script-1" });

    expect(trashSnippet).toHaveBeenCalledWith("user-1", "script-1", {
      source: "MCP",
      tool: "kastir_scripts_trash",
      resource: context.resource,
      requestId: context.requestId,
    });
    expect(result).toEqual({
      ok: true,
      summary: "Script script-1 moved to trash.",
      data: { id: "script-1", status: "DRAFT", deletedAt },
    });
  });

  it("rejects a missing write scope before calling the service", async () => {
    trashSnippet.mockClear();
    const { trashMcpScript } = await import("@/lib/Modules/Mcp/Tools/Scripts");

    await expect(
      trashMcpScript(
        { ...context, scopes: ["cms:read"] as const },
        { scriptId: "script-1" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(trashSnippet).not.toHaveBeenCalled();
  });

  it("registers only the reversible delete with a strict schema", async () => {
    const server = { registerTool: vi.fn() };
    const { registerScriptTools } =
      await import("@/lib/Modules/Mcp/Tools/Scripts");

    registerScriptTools(server as never, context);

    const registrations = new Map(
      server.registerTool.mock.calls.map(([name, definition]) => [
        name,
        definition,
      ]),
    );
    const trash = registrations.get("kastir_scripts_trash") as {
      inputSchema: { safeParse: (input: unknown) => { success: boolean } };
      annotations: Record<string, boolean>;
    };
    expect(trash.inputSchema.safeParse({ scriptId: "script-1" }).success).toBe(
      true,
    );
    expect(
      trash.inputSchema.safeParse({ scriptId: "script-1", extra: true })
        .success,
    ).toBe(false);
    expect(trash.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(registrations.has("kastir_scripts_delete")).toBe(false);
  });
});
