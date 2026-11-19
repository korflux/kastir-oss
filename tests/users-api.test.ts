import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  listUsers,
  createInvite,
  changeRole,
  removeUser,
  createPasswordReset,
  getInviteMeta,
  acceptInvite,
  getPasswordResetMeta,
  resetPassword,
  bridge,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  listUsers: vi.fn(),
  createInvite: vi.fn(),
  changeRole: vi.fn(),
  removeUser: vi.fn(),
  createPasswordReset: vi.fn(),
  getInviteMeta: vi.fn(),
  acceptInvite: vi.fn(),
  getPasswordResetMeta: vi.fn(),
  resetPassword: vi.fn(),
  bridge: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_URL: "https://panel.example.test",
    REDIS_URL: "redis://localhost:6379",
    AUTH_TRUST_PROXY: false,
  },
}));
vi.mock("@/lib/Modules/Users/Service", () => ({
  usersService: {
    listUsers,
    createInvite,
    changeRole,
    removeUser,
    createPasswordReset,
    getInviteMeta,
    acceptInvite,
    getPasswordResetMeta,
    resetPassword,
  },
}));
vi.mock("@/lib/Modules/Users/RateLimit", () => ({
  isUserTokenRequestAllowed: vi.fn().mockResolvedValue(true),
  isUserTokenAcceptAllowed: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/Modules/Users/SessionBridge", () => ({
  signInAndForwardCookies: bridge,
}));

import { GET as list } from "@/app/api/admin/users/route";
import { POST as invite } from "@/app/api/admin/users/invites/route";
import { DELETE, PATCH } from "@/app/api/admin/users/[userId]/route";
import { POST as resetLink } from "@/app/api/admin/users/[userId]/password-reset/route";
import { GET as inviteMeta } from "@/app/api/invite/[token]/route";
import { POST as accept } from "@/app/api/invite/[token]/accept/route";
import { GET as resetMeta } from "@/app/api/reset-password/[token]/route";
import { POST as reset } from "@/app/api/reset-password/[token]/accept/route";
import { UsersDomainError } from "@/lib/Modules/Users/Types";

const userParams = Promise.resolve({ userId: "target-id" });
const tokenParams = Promise.resolve({ token: "raw-token" });

describe("users HTTP contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "https://panel.example.test");
    getSession.mockResolvedValue({
      user: { id: "actor-id", role: "ADMIN", isMaster: true },
    });
    listUsers.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
    createInvite.mockResolvedValue({
      url: "https://panel.example.test/admin/invite/raw",
      expiresAt: new Date("2026-07-18T00:00:00Z"),
    });
    createPasswordReset.mockResolvedValue({
      url: "https://panel.example.test/admin/reset-password/raw",
      expiresAt: new Date("2026-07-18T00:00:00Z"),
    });
    getInviteMeta.mockResolvedValue({
      name: "New user",
      role: "EDITOR",
      expiresAt: new Date("2026-07-18T00:00:00Z"),
    });
    acceptInvite.mockResolvedValue({
      id: "new-id",
      name: "New user",
      email: "new@example.test",
      role: "EDITOR",
    });
    bridge.mockResolvedValue({
      success: true,
      setCookies: ["better-auth.session_token=opaque; Path=/; HttpOnly"],
    });
    getPasswordResetMeta.mockResolvedValue({
      name: "Existing",
      role: "EDITOR",
      expiresAt: new Date("2026-07-18T00:00:00Z"),
    });
  });

  it("requires a session and uses only the session actor", async () => {
    getSession.mockResolvedValueOnce(null);
    expect(
      (await list(new Request("http://localhost/api/admin/users"))).status,
    ).toBe(401);

    const response = await list(
      new Request("http://localhost/api/admin/users?q=admin&page=2"),
    );
    expect(response.status).toBe(200);
    expect(listUsers).toHaveBeenCalledWith("actor-id", {
      q: "admin",
      page: 2,
      pageSize: undefined,
    });
  });

  it("maps domain failures to the stable HTTP error contract", async () => {
    for (const [code, status] of [
      ["FORBIDDEN", 403],
      ["NOT_FOUND", 404],
      ["CONFLICT", 409],
      ["VALIDATION_ERROR", 422],
    ] as const) {
      listUsers.mockRejectedValueOnce(new UsersDomainError(code, "safe error"));
      const response = await list(
        new Request("http://localhost/api/admin/users"),
      );
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ code });
    }
  });

  it("returns 422 for invalid list query parameters instead of 500", async () => {
    const response = await list(
      new Request("http://localhost/api/admin/users?page=not-a-number"),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("creates invite and reset links from the canonical origin", async () => {
    expect(
      (
        await invite(
          new Request("http://attacker.test/api/admin/users/invites", {
            method: "POST",
            headers: { origin: "https://panel.example.test" },
            body: JSON.stringify({ name: "Editor", role: "EDITOR" }),
          }),
        )
      ).status,
    ).toBe(201);
    expect(createInvite).toHaveBeenCalledWith(
      "actor-id",
      { name: "Editor", role: "EDITOR" },
      "https://panel.example.test",
    );

    expect(
      (
        await resetLink(
          new Request("http://localhost", {
            method: "POST",
            headers: { origin: "https://panel.example.test" },
          }),
          { params: userParams },
        )
      ).status,
    ).toBe(201);
    expect(createPasswordReset).toHaveBeenCalledWith(
      "actor-id",
      "target-id",
      "https://panel.example.test",
    );
  });

  it("routes role changes and removal through the authenticated actor", async () => {
    changeRole.mockResolvedValue({ id: "target-id", role: "EDITOR" });
    expect(
      (
        await PATCH(
          new Request("http://localhost", {
            method: "PATCH",
            headers: { origin: "https://panel.example.test" },
            body: JSON.stringify({ role: "EDITOR", isMaster: true }),
          }),
          { params: userParams },
        )
      ).status,
    ).toBe(200);
    expect(changeRole).toHaveBeenCalledWith("actor-id", "target-id", {
      role: "EDITOR",
      isMaster: true,
    });

    expect(
      (
        await DELETE(
          new Request("http://localhost", {
            method: "DELETE",
            headers: { origin: "https://panel.example.test" },
          }),
          { params: userParams },
        )
      ).status,
    ).toBe(204);
    expect(removeUser).toHaveBeenCalledWith("actor-id", "target-id");
  });

  it("forwards Better Auth cookies only after a successful invite bridge", async () => {
    const response = await accept(
      new Request("http://localhost/api/invite/raw-token/accept", {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.test",
          password: "password123",
        }),
      }),
      { params: tokenParams },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain(
      "better-auth.session_token=opaque",
    );
    await expect(response.json()).resolves.toEqual({
      user: {
        id: "new-id",
        name: "New user",
        email: "new@example.test",
        role: "EDITOR",
      },
    });

    bridge.mockResolvedValueOnce({ success: false, setCookies: [] });
    const failed = await accept(
      new Request("http://localhost/api/invite/raw-token/accept", {
        method: "POST",
        body: JSON.stringify({
          email: "another@example.test",
          password: "password123",
        }),
      }),
      { params: tokenParams },
    );
    expect(failed.status).toBe(503);
    expect(failed.headers.get("set-cookie")).toBeNull();
    await expect(failed.json()).resolves.toMatchObject({
      code: "SESSION_BRIDGE_FAILED",
    });
  });

  it("keeps public metadata safe and resets without returning credentials", async () => {
    expect(
      (
        await inviteMeta(new Request("http://localhost"), {
          params: tokenParams,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await resetMeta(new Request("http://localhost"), {
          params: tokenParams,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await reset(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ password: "newpassword123" }),
          }),
          { params: tokenParams },
        )
      ).status,
    ).toBe(200);
    expect(resetPassword).toHaveBeenCalledWith("raw-token", {
      password: "newpassword123",
    });
  });

  it("forbids EDITOR on every Users admin route before calling the service", async () => {
    getSession.mockResolvedValue({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });

    expect(
      (await list(new Request("http://localhost/api/admin/users"))).status,
    ).toBe(403);
    expect(listUsers).not.toHaveBeenCalled();

    expect(
      (
        await invite(
          new Request("http://localhost/api/admin/users/invites", {
            method: "POST",
            headers: { origin: "https://panel.example.test" },
            body: JSON.stringify({ name: "X", role: "EDITOR" }),
          }),
        )
      ).status,
    ).toBe(403);
    expect(createInvite).not.toHaveBeenCalled();

    expect(
      (
        await PATCH(
          new Request("http://localhost", {
            method: "PATCH",
            headers: { origin: "https://panel.example.test" },
            body: JSON.stringify({ role: "ADMIN" }),
          }),
          { params: userParams },
        )
      ).status,
    ).toBe(403);
    expect(changeRole).not.toHaveBeenCalled();

    expect(
      (
        await DELETE(
          new Request("http://localhost", {
            method: "DELETE",
            headers: { origin: "https://panel.example.test" },
          }),
          { params: userParams },
        )
      ).status,
    ).toBe(403);
    expect(removeUser).not.toHaveBeenCalled();

    expect(
      (
        await resetLink(
          new Request("http://localhost", {
            method: "POST",
            headers: { origin: "https://panel.example.test" },
          }),
          { params: userParams },
        )
      ).status,
    ).toBe(403);
    expect(createPasswordReset).not.toHaveBeenCalled();
  });
});
