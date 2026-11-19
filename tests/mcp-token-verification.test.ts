import { describe, expect, it, vi } from "vitest";

const introspectMcpAccessToken = vi.hoisted(() => vi.fn());
const findUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/Modules/Mcp/TokenIntrospection", () => ({
  introspectMcpAccessToken,
}));

vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique },
  },
}));

describe("MCP OAuth token verification", () => {
  it("rejects requests without a Bearer token before touching OAuth or Prisma", async () => {
    const { authenticateMcpRequest } =
      await import("@/lib/Modules/Mcp/TokenVerification");

    await expect(
      authenticateMcpRequest(new Request("http://localhost:3000/api/mcp")),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(introspectMcpAccessToken).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("maps invalid, expired, revoked, or wrong-audience tokens to a generic 401", async () => {
    introspectMcpAccessToken.mockRejectedValueOnce(
      new Error("secret upstream detail"),
    );
    const { authenticateMcpRequest } =
      await import("@/lib/Modules/Mcp/TokenVerification");

    await expect(
      authenticateMcpRequest(
        new Request("http://localhost:3000/api/mcp", {
          headers: { Authorization: "Bearer opaque-token" },
        }),
      ),
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
      message: "MCP authentication failed",
    });
  });

  it("uses the trusted token record and resolves the current user role and scopes", async () => {
    introspectMcpAccessToken.mockResolvedValueOnce({
      active: true,
      sub: "user-1",
      client_id: "claude-client",
      iss: "http://localhost:3000/api/auth",
      aud: "http://localhost:3000/api/mcp",
      scope: "cms:read cms:pages:publish unknown:scope",
    });
    findUnique.mockResolvedValueOnce({
      id: "user-1",
      name: "Editor",
      email: "editor@example.test",
      role: "EDITOR",
      isMaster: false,
    });

    const { authenticateMcpRequest } =
      await import("@/lib/Modules/Mcp/TokenVerification");
    const context = await authenticateMcpRequest(
      new Request("http://localhost:3000/api/mcp", {
        headers: {
          Authorization: "Bearer opaque-token",
          "x-request-id": "request-123",
        },
      }),
    );

    expect(introspectMcpAccessToken).toHaveBeenCalledWith("opaque-token");
    expect(context).toEqual({
      actor: {
        id: "user-1",
        name: "Editor",
        email: "editor@example.test",
      },
      userId: "user-1",
      role: "EDITOR",
      scopes: ["cms:read", "cms:pages:publish"],
      clientId: "claude-client",
      resource: "http://localhost:3000/api/mcp",
      requestId: "request-123",
    });
  });

  it("rejects an active token when its user no longer exists", async () => {
    introspectMcpAccessToken.mockResolvedValueOnce({
      active: true,
      sub: "deleted-user",
      client_id: "claude-client",
      scope: "cms:read",
    });
    findUnique.mockResolvedValueOnce(null);

    const { authenticateMcpRequest } =
      await import("@/lib/Modules/Mcp/TokenVerification");

    await expect(
      authenticateMcpRequest(
        new Request("http://localhost:3000/api/mcp", {
          headers: { Authorization: "Bearer opaque-token" },
        }),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });
});
