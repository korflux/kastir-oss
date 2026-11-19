import { beforeEach, describe, expect, it, vi } from "vitest";

const listLogs = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Logs/Service", () => ({
  logsService: { listLogs },
}));

beforeEach(() => {
  listLogs.mockReset();
});

const adminContext = {
  actor: { id: "admin-1", name: "Admin", email: "admin@example.test" },
  userId: "admin-1",
  role: "ADMIN" as const,
  scopes: ["cms:read", "cms:logs:read"] as const,
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

const logEntry = {
  id: "log-1",
  userId: "admin-1",
  actor: {
    id: "admin-1",
    name: "Admin",
    role: "ADMIN" as const,
    removed: false,
  },
  action: "SPLIT_CAMPAIGN_CREATED",
  objectType: "SPLIT_TEST" as const,
  objectLabel: "Homepage CTA (/s/homepage-cta)",
  objectId: "c1",
  source: "MCP" as const,
  tool: "kastir_split_tests_create",
  resource: "https://public.example/api/mcp",
  requestId: "request-2",
  createdAt: new Date("2026-07-20T10:00:00.000Z"),
};

describe("MCP kastir_audit_logs_list", () => {
  it("lists logs with filters and pagination for an administrator", async () => {
    listLogs.mockResolvedValueOnce({
      items: [logEntry],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    const { listMcpAuditLogs } = await import("@/lib/Modules/Mcp/Tools/Logs");

    const result = await listMcpAuditLogs(adminContext, {
      objectType: "SPLIT_TEST",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-31T23:59:59.000Z",
    });

    expect(listLogs).toHaveBeenCalledWith("admin-1", {
      page: 1,
      pageSize: 20,
      userId: undefined,
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-31T23:59:59.000Z"),
      objectType: "SPLIT_TEST",
    });
    expect(result.items).toEqual([
      expect.objectContaining({ id: "log-1", source: "MCP" }),
    ]);
    expect(result.pagination).toMatchObject({
      page: 1,
      pageSize: 20,
      totalItems: 1,
    });
  });

  it("rejects EDITOR even with cms:logs:read on the token", async () => {
    const editorWithScope = { ...adminContext, role: "EDITOR" as const };
    const { listMcpAuditLogs } = await import("@/lib/Modules/Mcp/Tools/Logs");

    await expect(listMcpAuditLogs(editorWithScope, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(listLogs).not.toHaveBeenCalled();
  });

  it("rejects an administrator whose token lacks the scope", async () => {
    const adminNoScope = { ...adminContext, scopes: ["cms:read"] as const };
    const { listMcpAuditLogs } = await import("@/lib/Modules/Mcp/Tools/Logs");

    await expect(listMcpAuditLogs(adminNoScope, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("registers only the read-only list tool", async () => {
    const server = { registerTool: vi.fn() };
    const { registerLogsTools } = await import("@/lib/Modules/Mcp/Tools/Logs");

    registerLogsTools(server as never, adminContext);

    const registeredNames = server.registerTool.mock.calls.map(
      ([name]) => name,
    );
    expect(registeredNames).toEqual(["kastir_audit_logs_list"]);
    const [, config] = server.registerTool.mock.calls[0];
    expect(config.annotations.readOnlyHint).toBe(true);
  });
});
