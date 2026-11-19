import { describe, expect, it, vi } from "vitest";

const listCampaigns = vi.hoisted(() => vi.fn());
const getCampaign = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/Modules/SplitTests/Service", () => ({
  splitTestsService: { listCampaigns, getCampaign },
}));

const context = {
  actor: { id: "user-1", name: "Editor", email: "editor@example.test" },
  userId: "user-1",
  role: "EDITOR" as const,
  scopes: ["cms:read" as const],
  clientId: "client-1",
  resource: "http://localhost:3000/api/mcp",
  requestId: "request-1",
};

describe("MCP Split Tests read tools", () => {
  it("lists campaigns paginated, mirroring the panel's list shape", async () => {
    listCampaigns.mockResolvedValueOnce({
      items: [
        {
          id: "c1",
          name: "Homepage CTA",
          slug: "homepage-cta",
          status: "ACTIVE",
          authorId: "user-1",
          activeDestinationCount: 2,
          totalHits: 42,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
          updatedAt: new Date("2026-07-20T00:00:00.000Z"),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const { listMcpSplitTests } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");
    const result = await listMcpSplitTests(context, {});

    expect(result.items).toEqual([
      expect.objectContaining({
        id: "c1",
        name: "Homepage CTA",
        activeDestinationCount: 2,
      }),
    ]);
    expect(result.pagination).toMatchObject({
      page: 1,
      pageSize: 20,
      totalItems: 1,
    });
  });

  it("gets one campaign with destinations, weights, and realPercent", async () => {
    getCampaign.mockResolvedValueOnce({
      id: "c1",
      name: "Homepage CTA",
      slug: "homepage-cta",
      status: "ACTIVE",
      authorId: "user-1",
      totalHits: 10,
      destinations: [
        {
          id: "d1",
          campaignId: "c1",
          url: "https://a.example",
          label: null,
          status: "ACTIVE",
          sortOrder: 0,
          hitCount: 10,
          theoreticalWeight: 100,
          realPercent: 100,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { getMcpSplitTest } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");
    const result = await getMcpSplitTest(context, { campaignId: "c1" });

    expect(getCampaign).toHaveBeenCalledWith("c1");
    expect(result.destinations[0]).toMatchObject({
      theoreticalWeight: 100,
      realPercent: 100,
    });
  });

  it("requires cms:read for every read tool", async () => {
    const { listMcpSplitTests, getMcpSplitTest } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");
    const noRead = { ...context, scopes: [] as const };

    await expect(listMcpSplitTests(noRead, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      getMcpSplitTest(noRead, { campaignId: "c1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
