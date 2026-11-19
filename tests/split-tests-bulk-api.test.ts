import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  trashCampaign,
  restoreCampaign,
  permanentlyDeleteCampaign,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  trashCampaign: vi.fn(),
  restoreCampaign: vi.fn(),
  permanentlyDeleteCampaign: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/SplitTests/Service", () => ({
  splitTestsService: {
    trashCampaign,
    restoreCampaign,
    permanentlyDeleteCampaign,
  },
}));

import { POST } from "@/app/api/admin/split-tests/bulk/route";
import { SplitTestsDomainError } from "@/lib/Modules/SplitTests/Types";

const campaignOne = "clh5q6m1v0000qz9j8r2w4x7a";
const campaignTwo = "clh5q6m1v0001qz9j8r2w4x7a";

function request(
  body: unknown,
  origin = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000")
    .origin,
) {
  return new Request("http://localhost/api/admin/split-tests/bulk", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { origin },
  });
}

describe("admin split tests bulk API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });
    trashCampaign.mockResolvedValue({ id: campaignOne });
    restoreCampaign.mockResolvedValue({ id: campaignOne });
    permanentlyDeleteCampaign.mockResolvedValue(undefined);
  });

  it("requires a session and blocks Editor before parsing the payload", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(
      POST(request({ action: "trash", ids: [campaignOne] })),
    ).resolves.toMatchObject({ status: 401 });

    getSession.mockResolvedValue({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });
    for (const action of ["trash", "restore", "permanently-delete"] as const) {
      const response = await POST(request({ action, ids: [] }));
      expect(response.status).toBe(403);
    }
    expect(trashCampaign).not.toHaveBeenCalled();
    expect(restoreCampaign).not.toHaveBeenCalled();
    expect(permanentlyDeleteCampaign).not.toHaveBeenCalled();
  });

  it("rejects invalid roles and cross-origin mutations before executing", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "owner-id", role: "OWNER", isMaster: false },
    });
    await expect(
      POST(request({ action: "restore", ids: [campaignOne] })),
    ).resolves.toMatchObject({ status: 403 });

    const response = await POST(
      request(
        { action: "restore", ids: [campaignOne] },
        "https://attacker.example",
      ),
    );

    expect(response.status).toBe(403);
    expect(trashCampaign).not.toHaveBeenCalled();
    expect(restoreCampaign).not.toHaveBeenCalled();
    expect(permanentlyDeleteCampaign).not.toHaveBeenCalled();
  });

  it("rejects invalid actions, IDs, confirmation and forged actor fields", async () => {
    for (const body of [
      { action: "publish", ids: [campaignOne] },
      { action: "trash", ids: [] },
      { action: "trash", ids: ["not-a-cuid"] },
      { action: "trash", ids: [campaignOne], role: "MASTER" },
      { action: "restore", ids: [campaignOne], userId: "attacker" },
      {
        action: "restore",
        ids: Array.from({ length: 201 }, () => campaignOne),
      },
      { action: "permanently-delete", ids: [campaignOne] },
      { action: "permanently-delete", ids: [campaignOne], confirmed: false },
      {
        action: "permanently-delete",
        ids: [campaignOne],
        confirmed: true,
        role: "MASTER",
      },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }

    expect(trashCampaign).not.toHaveBeenCalled();
    expect(restoreCampaign).not.toHaveBeenCalled();
    expect(permanentlyDeleteCampaign).not.toHaveBeenCalled();
  });

  it("trashes unique campaigns in order and reports a safe partial result", async () => {
    trashCampaign.mockImplementation(async (_userId: string, id: string) => {
      if (id === campaignTwo) {
        throw new SplitTestsDomainError("NOT_FOUND", "internal detail");
      }
    });

    const response = await POST(
      request({
        action: "trash",
        ids: [campaignOne, campaignOne, campaignTwo],
      }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [campaignOne],
      failed: [
        {
          id: campaignTwo,
          code: "NOT_FOUND",
          message: "Campaign was not found",
        },
      ],
    });
    expect(trashCampaign).toHaveBeenNthCalledWith(1, "admin-id", campaignOne);
    expect(trashCampaign).toHaveBeenNthCalledWith(2, "admin-id", campaignTwo);
  });

  it("restores unique campaigns and reports a safe partial result", async () => {
    restoreCampaign.mockImplementation(async (_userId: string, id: string) => {
      if (id === campaignTwo) {
        throw new SplitTestsDomainError("INVALID_STATE", "internal detail");
      }
    });

    const response = await POST(
      request({
        action: "restore",
        ids: [campaignOne, campaignOne, campaignTwo],
      }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [campaignOne],
      failed: [
        {
          id: campaignTwo,
          code: "INVALID_STATE",
          message: "Campaign is not in an eligible state",
        },
      ],
    });
    expect(restoreCampaign).toHaveBeenNthCalledWith(1, "admin-id", campaignOne);
    expect(restoreCampaign).toHaveBeenNthCalledWith(2, "admin-id", campaignTwo);
  });

  it("permanently deletes only after explicit confirmation and uses the server role", async () => {
    const response = await POST(
      request({
        action: "permanently-delete",
        ids: [campaignOne],
        confirmed: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(permanentlyDeleteCampaign).toHaveBeenCalledWith(
      "admin-id",
      campaignOne,
      "ADMIN",
    );
  });

  it("returns a safe partial result when a permanent delete is not in the trash", async () => {
    permanentlyDeleteCampaign.mockImplementation(
      async (_userId: string, id: string) => {
        if (id === campaignTwo) {
          throw new SplitTestsDomainError("INVALID_STATE", "internal detail");
        }
      },
    );

    const response = await POST(
      request({
        action: "permanently-delete",
        ids: [campaignOne, campaignTwo],
        confirmed: true,
      }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [campaignOne],
      failed: [
        {
          id: campaignTwo,
          code: "INVALID_STATE",
          message: "Campaign is not in an eligible state",
        },
      ],
    });
  });
});
