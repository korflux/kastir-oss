import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  listCampaigns,
  createCampaign,
  getCampaign,
  updateCampaign,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  listCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  getCampaign: vi.fn(),
  updateCampaign: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/SplitTests/Service", () => ({
  splitTestsService: {
    listCampaigns,
    createCampaign,
    getCampaign,
    updateCampaign,
    trashCampaign: vi.fn(),
    addDestination: vi.fn(),
    updateDestination: vi.fn(),
    deleteDestination: vi.fn(),
    reorderDestinations: vi.fn(),
  },
}));

import { GET, POST } from "@/app/api/admin/split-tests/route";
import { GET as GET_ONE } from "@/app/api/admin/split-tests/[campaignId]/route";
import { SplitTestsDomainError } from "@/lib/Modules/SplitTests/Types";
import { updateCampaignSchema } from "@/lib/Modules/SplitTests/Schema";

describe("admin split-tests API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    getSession.mockResolvedValue({
      user: { id: "user-id", role: "EDITOR", isMaster: false },
    });
    listCampaigns.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    createCampaign.mockResolvedValue({ id: "c1", slug: "campanha-a" });
    getCampaign.mockResolvedValue({ id: "c1", slug: "campanha-a" });
  });

  it("requires an authenticated session", async () => {
    getSession.mockResolvedValue(null);
    const response = await GET(
      new Request("http://localhost/api/admin/split-tests"),
    );
    expect(response.status).toBe(401);
  });

  it("creates a campaign stripping client-controlled fields", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/split-tests", {
        method: "POST",
        headers: { origin: "http://localhost" },
        body: JSON.stringify({
          name: "Campanha A",
          destinations: [{ url: "https://example.com", label: "Dest" }],
          authorId: "attacker",
          hitCount: 999,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createCampaign).toHaveBeenCalledWith("user-id", {
      name: "Campanha A",
      destinations: [{ url: "https://example.com", label: "Dest" }],
    });
  });

  it("maps CONFLICT to 409", async () => {
    createCampaign.mockRejectedValue(
      new SplitTestsDomainError("CONFLICT", "Campaign slug is already in use"),
    );

    const response = await POST(
      new Request("http://localhost/api/admin/split-tests", {
        method: "POST",
        headers: { origin: "http://localhost" },
        body: JSON.stringify({
          name: "Dup",
          destinations: [{ url: "https://example.com", label: "Dest" }],
        }),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("returns campaign detail", async () => {
    const response = await GET_ONE(
      new Request("http://localhost/api/admin/split-tests/c1"),
      { params: Promise.resolve({ campaignId: "c1" }) },
    );
    expect(response.status).toBe(200);
    expect(getCampaign).toHaveBeenCalledWith("c1");
  });

  it("keeps campaign updates restricted to the explicit allowlist", () => {
    expect(
      updateCampaignSchema.safeParse({
        name: "Campaign",
        slug: "campaign",
        status: "ACTIVE",
        id: "attacker-id",
        role: "MASTER",
        destinations: [],
      }).success,
    ).toBe(false);
  });
});
