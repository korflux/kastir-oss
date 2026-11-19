import { describe, expect, it, vi } from "vitest";

const listDailyStats = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/SplitTests/Aggregation", () => ({ listDailyStats }));
vi.mock("@/lib/Modules/SplitTests/Service", () => ({ splitTestsService: {} }));

const context = {
  actor: { id: "user-1", name: "Editor", email: "editor@example.test" },
  userId: "user-1",
  role: "EDITOR" as const,
  scopes: ["cms:read" as const],
  clientId: "client-1",
  resource: "http://localhost:3000/api/mcp",
  requestId: "request-1",
};

describe("MCP Split Tests stats tool", () => {
  it("passes a UTC day range into listDailyStats and reports the timezone", async () => {
    listDailyStats.mockResolvedValueOnce({
      items: [
        {
          day: new Date("2026-07-01T00:00:00.000Z"),
          destinationId: "d1",
          hits: 3,
        },
        {
          day: new Date("2026-07-02T00:00:00.000Z"),
          destinationId: "d1",
          hits: 5,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });

    const { getMcpSplitTestStats } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");
    const result = await getMcpSplitTestStats(context, {
      campaignId: "c1",
      from: "2026-07-01",
      to: "2026-07-02",
    });

    expect(listDailyStats).toHaveBeenCalledWith({
      campaignId: "c1",
      destinationId: undefined,
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-02T00:00:00.000Z"),
      page: undefined,
      pageSize: undefined,
    });
    expect(result.timezone).toBe("UTC");
    expect(result.items).toEqual([
      { day: "2026-07-01", destinationId: "d1", hits: 3 },
      { day: "2026-07-02", destinationId: "d1", hits: 5 },
    ]);
  });

  it("forwards the optional destinationId filter and pagination", async () => {
    listDailyStats.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 2,
      pageSize: 10,
    });

    const { getMcpSplitTestStats } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");
    await getMcpSplitTestStats(context, {
      campaignId: "c1",
      destinationId: "d1",
      from: "2026-07-01",
      to: "2026-07-31",
      page: 2,
      pageSize: 10,
    });

    expect(listDailyStats).toHaveBeenCalledWith(
      expect.objectContaining({ destinationId: "d1", page: 2, pageSize: 10 }),
    );
  });

  it("requires cms:read", async () => {
    const { getMcpSplitTestStats } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");
    await expect(
      getMcpSplitTestStats(
        { ...context, scopes: [] as const },
        { campaignId: "c1", from: "2026-07-01", to: "2026-07-02" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
