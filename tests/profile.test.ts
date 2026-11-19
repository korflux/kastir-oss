import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, update } = vi.hoisted(() => ({
  getSession: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { update } },
}));

import { PUT } from "@/app/api/admin/profile/route";

describe("admin profile endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
  });

  it("requires an authenticated session", async () => {
    getSession.mockResolvedValue(null);

    const response = await PUT(
      new Request("http://localhost/api/admin/profile", {
        method: "PUT",
        headers: { origin: "http://localhost" },
        body: JSON.stringify({ name: "Admin" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects sensitive fields without touching the user", async () => {
    getSession.mockResolvedValue({
      user: { id: "master-id", role: "ADMIN", isMaster: true },
    });

    const response = await PUT(
      new Request("http://localhost/api/admin/profile", {
        method: "PUT",
        headers: { origin: "http://localhost" },
        body: JSON.stringify({ name: "Attacker", role: "MASTER" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("updates only the authenticated user's name", async () => {
    getSession.mockResolvedValue({
      user: { id: "master-id", role: "ADMIN", isMaster: true },
    });
    update.mockResolvedValue({ name: "Updated Master" });

    const response = await PUT(
      new Request("http://localhost/api/admin/profile", {
        method: "PUT",
        headers: { origin: "http://localhost" },
        body: JSON.stringify({ name: "  Updated Master  " }),
      }),
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: "master-id" },
      data: { name: "Updated Master" },
      select: { name: true },
    });
    await expect(response.json()).resolves.toEqual({
      user: { name: "Updated Master" },
    });
  });
});
