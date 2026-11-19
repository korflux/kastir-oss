import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const findToken = vi.hoisted(() => vi.fn());
const findConsent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    oauthAccessToken: { findUnique: findToken },
    oauthConsent: { findFirst: findConsent },
  },
}));

describe("MCP access-token introspection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns trusted claims only for an active consented token", async () => {
    const now = new Date();
    findToken.mockResolvedValueOnce({
      clientId: "claude-client",
      sessionId: "session-1",
      userId: "user-1",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: new Date(now.getTime() - 1_000),
      revoked: null,
      scopes: ["cms:read", "cms:pages:write"],
      oauthclient: { disabled: false },
    });
    findConsent.mockResolvedValueOnce({
      scopes: ["cms:read", "cms:pages:write", "cms:pages:publish"],
    });

    const { introspectMcpAccessToken } =
      await import("@/lib/Modules/Mcp/TokenIntrospection");
    const claims = await introspectMcpAccessToken("test-token");

    expect(claims).toEqual({
      active: true,
      iss: "http://localhost:3000/api/auth",
      aud: "http://localhost:3000/api/mcp",
      client_id: "claude-client",
      sub: "user-1",
      sid: "session-1",
      exp: Math.floor((now.getTime() + 60_000) / 1_000),
      iat: Math.floor((now.getTime() - 1_000) / 1_000),
      scope: "cms:read cms:pages:write",
    });
    expect(findToken).toHaveBeenCalledWith({
      where: {
        token: createHash("sha256").update("test-token").digest("base64url"),
      },
      select: {
        clientId: true,
        sessionId: true,
        userId: true,
        expiresAt: true,
        createdAt: true,
        revoked: true,
        scopes: true,
        oauthclient: { select: { disabled: true } },
      },
    });
    expect(findConsent).toHaveBeenCalledWith({
      where: { clientId: "claude-client", userId: "user-1" },
      orderBy: { updatedAt: "desc" },
      select: { scopes: true },
    });
  });

  it.each([
    "missing token",
    "expired token",
    "revoked token",
    "disabled client",
    "missing consent",
    "consent with fewer scopes",
  ])("rejects %s", async (reason) => {
    const now = new Date();
    if (reason === "missing token") {
      findToken.mockResolvedValueOnce(null);
    } else {
      findToken.mockResolvedValueOnce({
        clientId: "claude-client",
        sessionId: null,
        userId: "user-1",
        expiresAt: new Date(
          now.getTime() + (reason === "expired token" ? -1_000 : 60_000),
        ),
        createdAt: now,
        revoked: reason === "revoked token" ? now : null,
        scopes: ["cms:read", "cms:pages:write"],
        oauthclient: { disabled: reason === "disabled client" },
      });
      findConsent.mockResolvedValueOnce(
        reason === "missing consent"
          ? null
          : {
              scopes:
                reason === "consent with fewer scopes"
                  ? ["cms:read"]
                  : ["cms:read", "cms:pages:write"],
            },
      );
    }

    const { introspectMcpAccessToken } =
      await import("@/lib/Modules/Mcp/TokenIntrospection");

    await expect(introspectMcpAccessToken("test-token")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });
});
