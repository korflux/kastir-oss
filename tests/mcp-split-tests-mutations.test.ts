import { describe, expect, it, vi } from "vitest";

const createCampaign = vi.hoisted(() => vi.fn());
const updateCampaign = vi.hoisted(() => vi.fn());
const addDestination = vi.hoisted(() => vi.fn());
const updateDestination = vi.hoisted(() => vi.fn());
const reorderDestinations = vi.hoisted(() => vi.fn());
const trashCampaign = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/Modules/SplitTests/Service", () => ({
  splitTestsService: {
    createCampaign,
    updateCampaign,
    addDestination,
    updateDestination,
    reorderDestinations,
    trashCampaign,
  },
}));

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read", "cms:split-tests:write"] as const,
  clientId: "client-1",
  resource: "https://public.example/api/mcp",
  requestId: "request-1",
};

const campaign = {
  id: "c1",
  name: "Campaign",
  slug: "campaign",
  status: "ACTIVE" as const,
  authorId: "user-1",
  totalHits: 0,
  destinations: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("MCP Split Tests mutation tools", () => {
  it("passes the real actor and MCP audit context to the service", async () => {
    createCampaign.mockResolvedValueOnce({ ...campaign, status: "PAUSED" });
    updateCampaign.mockResolvedValueOnce(campaign);
    const { createMcpSplitTest, updateMcpSplitTest } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");

    const created = await createMcpSplitTest(context, {
      name: "Campaign",
      destinations: [{ url: "https://a.example", label: "Dest A" }],
    });
    const updated = await updateMcpSplitTest(context, {
      campaignId: "c1",
      name: "Renamed",
    });

    expect(createCampaign).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ name: "Campaign" }),
      {
        source: "MCP",
        tool: "kastir_split_tests_create",
        resource: context.resource,
        requestId: context.requestId,
      },
    );
    expect(updateCampaign).toHaveBeenCalledWith(
      "user-1",
      "c1",
      { name: "Renamed" },
      expect.objectContaining({
        tool: "kastir_split_tests_update",
        source: "MCP",
      }),
    );
    expect(created).toMatchObject({
      summary: expect.stringContaining("kastir_split_tests_update"),
      data: { activationRequired: true },
    });
    expect(updated.data).not.toHaveProperty("activationRequired");
  });

  it("splits campaignId/destinationId off the input before calling the service", async () => {
    addDestination.mockResolvedValueOnce(campaign);
    updateDestination.mockResolvedValueOnce(campaign);
    reorderDestinations.mockResolvedValueOnce(campaign);
    const {
      createMcpSplitTestDestination,
      updateMcpSplitTestDestination,
      reorderMcpSplitTestDestinations,
    } = await import("@/lib/Modules/Mcp/Tools/SplitTests");

    await createMcpSplitTestDestination(context, {
      campaignId: "c1",
      url: "https://b.example",
      label: "B",
    });
    await updateMcpSplitTestDestination(context, {
      campaignId: "c1",
      destinationId: "d1",
      status: "PAUSED",
    });
    await reorderMcpSplitTestDestinations(context, {
      campaignId: "c1",
      orderedIds: ["d1", "d2"],
    });

    expect(addDestination).toHaveBeenCalledWith(
      "user-1",
      "c1",
      { url: "https://b.example", label: "B" },
      expect.objectContaining({
        tool: "kastir_split_tests_destinations_create",
      }),
    );
    expect(updateDestination).toHaveBeenCalledWith(
      "user-1",
      "c1",
      "d1",
      { status: "PAUSED" },
      expect.objectContaining({
        tool: "kastir_split_tests_destinations_update",
      }),
    );
    expect(reorderDestinations).toHaveBeenCalledWith(
      "user-1",
      "c1",
      ["d1", "d2"],
      expect.objectContaining({
        tool: "kastir_split_tests_destinations_reorder",
      }),
    );
  });

  it("blocks every write tool when the token lacks cms:split-tests:write", async () => {
    const noWrite = { ...context, scopes: ["cms:read"] as const };
    const {
      createMcpSplitTest,
      updateMcpSplitTest,
      createMcpSplitTestDestination,
      updateMcpSplitTestDestination,
      reorderMcpSplitTestDestinations,
      trashMcpSplitTest,
    } = await import("@/lib/Modules/Mcp/Tools/SplitTests");

    await expect(
      createMcpSplitTest(noWrite, {
        name: "X",
        destinations: [{ url: "https://a.example", label: "Dest A" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateMcpSplitTest(noWrite, { campaignId: "c1", name: "X" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createMcpSplitTestDestination(noWrite, {
        campaignId: "c1",
        url: "https://a.example",
        label: "A",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateMcpSplitTestDestination(noWrite, {
        campaignId: "c1",
        destinationId: "d1",
        label: "x",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reorderMcpSplitTestDestinations(noWrite, {
        campaignId: "c1",
        orderedIds: ["d1"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      trashMcpSplitTest(noWrite, { campaignId: "c1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("surfaces CONFLICT from the service when expectedUpdatedAt is stale", async () => {
    const { SplitTestsDomainError } =
      await import("@/lib/Modules/SplitTests/Types");
    updateCampaign.mockRejectedValueOnce(
      new SplitTestsDomainError(
        "CONFLICT",
        "Campaign was updated by another request",
      ),
    );
    const { updateMcpSplitTest } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");

    await expect(
      updateMcpSplitTest(context, {
        campaignId: "c1",
        name: "New name",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("surfaces VALIDATION_ERROR from the service when a destination URL is rejected", async () => {
    const { SplitTestsDomainError } =
      await import("@/lib/Modules/SplitTests/Types");
    addDestination.mockRejectedValueOnce(
      new SplitTestsDomainError(
        "VALIDATION_ERROR",
        "Destination URL scheme is not allowed",
      ),
    );
    updateDestination.mockRejectedValueOnce(
      new SplitTestsDomainError(
        "VALIDATION_ERROR",
        "Destination URL scheme is not allowed",
      ),
    );
    const { createMcpSplitTestDestination, updateMcpSplitTestDestination } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");

    await expect(
      createMcpSplitTestDestination(context, {
        campaignId: "c1",
        url: "javascript:alert(1)",
        label: "B",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      updateMcpSplitTestDestination(context, {
        campaignId: "c1",
        destinationId: "d1",
        url: "data:text/html,evil",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("trashes a campaign with MCP audit and a minimal paused response", async () => {
    const deletedAt = new Date("2026-08-09T12:00:00.000Z");
    trashCampaign.mockResolvedValueOnce({
      ...campaign,
      status: "PAUSED",
      deletedAt,
    });
    const { trashMcpSplitTest } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");

    const result = await trashMcpSplitTest(context, { campaignId: "c1" });

    expect(trashCampaign).toHaveBeenCalledWith("user-1", "c1", {
      source: "MCP",
      tool: "kastir_split_tests_trash",
      resource: context.resource,
      requestId: context.requestId,
    });
    expect(result).toEqual({
      ok: true,
      summary: "Split test c1 moved to trash.",
      data: { id: "c1", status: "PAUSED", deletedAt },
    });
  });

  it("does not register a hard-delete tool for campaigns or destinations", async () => {
    const server = { registerTool: vi.fn() };
    const { registerSplitTestTools } =
      await import("@/lib/Modules/Mcp/Tools/SplitTests");

    registerSplitTestTools(server as never, context);

    const registeredNames = server.registerTool.mock.calls.map(
      ([name]) => name,
    );
    expect(registeredNames).not.toContain("kastir_split_tests_delete");
    expect(registeredNames).not.toContain(
      "kastir_split_tests_destinations_delete",
    );
    expect(registeredNames).toEqual(
      expect.arrayContaining([
        "kastir_split_tests_list",
        "kastir_split_tests_get",
        "kastir_split_tests_stats",
        "kastir_split_tests_create",
        "kastir_split_tests_update",
        "kastir_split_tests_destinations_create",
        "kastir_split_tests_destinations_update",
        "kastir_split_tests_destinations_reorder",
        "kastir_split_tests_trash",
      ]),
    );

    const trashDefinition = server.registerTool.mock.calls.find(
      ([name]) => name === "kastir_split_tests_trash",
    )?.[1] as {
      inputSchema: { safeParse: (input: unknown) => { success: boolean } };
    };
    expect(
      trashDefinition.inputSchema.safeParse({
        campaignId: "c1",
        extra: true,
      }).success,
    ).toBe(false);
  });
});
