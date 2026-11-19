import { beforeEach, describe, expect, it, vi } from "vitest";

const findConsents = vi.hoisted(() => vi.fn());
const findAccessTokens = vi.hoisted(() => vi.fn());
const findRefreshTokens = vi.hoisted(() => vi.fn());
const findConsent = vi.hoisted(() => vi.fn());
const deleteAccessTokens = vi.hoisted(() => vi.fn());
const deleteRefreshTokens = vi.hoisted(() => vi.fn());
const deleteConsent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    oauthConsent: {
      findMany: findConsents,
      findUnique: findConsent,
      delete: deleteConsent,
    },
    oauthAccessToken: {
      findMany: findAccessTokens,
      deleteMany: deleteAccessTokens,
    },
    oauthRefreshToken: {
      findMany: findRefreshTokens,
      deleteMany: deleteRefreshTokens,
    },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  },
}));

const editor = {
  id: "editor-1",
  name: "Editor",
  email: "editor@example.test",
  role: "EDITOR",
  isMaster: false,
};

const consent = {
  id: "consent-1",
  clientId: "claude-client",
  userId: "editor-1",
  scopes: ["cms:read"],
  createdAt: new Date("2026-07-22T10:00:00.000Z"),
  updatedAt: new Date("2026-07-22T10:05:00.000Z"),
  oauthclient: { name: "Claude", uri: "https://claude.ai" },
  user: editor,
};

describe("MCP connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only the viewer's consent for an Editor", async () => {
    findConsents.mockResolvedValueOnce([consent]);
    findAccessTokens.mockResolvedValueOnce([
      {
        clientId: "claude-client",
        userId: "editor-1",
        createdAt: new Date("2099-07-22T10:06:00.000Z"),
        expiresAt: new Date("2099-07-22T11:06:00.000Z"),
      },
    ]);
    findRefreshTokens.mockResolvedValueOnce([]);

    const { listMcpConnections } =
      await import("@/lib/Modules/Mcp/Connections");
    const result = await listMcpConnections("editor-1", "EDITOR");

    expect(findConsents).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "editor-1" } }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        clientName: "Claude",
        user: {
          id: "editor-1",
          name: "Editor",
          email: editor.email,
          role: "EDITOR",
        },
        active: true,
        lastTokenIssuedAt: "2099-07-22T10:06:00.000Z",
      }),
    ]);
  });

  it("allows an Admin to revoke the consent and every token family row", async () => {
    findConsent.mockResolvedValueOnce({
      id: "consent-1",
      clientId: "claude-client",
      userId: "editor-1",
    });
    deleteAccessTokens.mockResolvedValueOnce({ count: 1 });
    deleteRefreshTokens.mockResolvedValueOnce({ count: 1 });
    deleteConsent.mockResolvedValueOnce(consent);

    const { revokeMcpConnection } =
      await import("@/lib/Modules/Mcp/Connections");
    await revokeMcpConnection("consent-1", "admin-1", "ADMIN");

    expect(deleteAccessTokens).toHaveBeenCalledWith({
      where: { clientId: "claude-client", userId: "editor-1" },
    });
    expect(deleteRefreshTokens).toHaveBeenCalledWith({
      where: { clientId: "claude-client", userId: "editor-1" },
    });
    expect(deleteConsent).toHaveBeenCalledWith({ where: { id: "consent-1" } });
  });

  it("denies an Editor from revoking another user's consent", async () => {
    findConsent.mockResolvedValueOnce({
      id: "consent-1",
      clientId: "claude-client",
      userId: "other-user",
    });

    const { revokeMcpConnection } =
      await import("@/lib/Modules/Mcp/Connections");

    await expect(
      revokeMcpConnection("consent-1", "editor-1", "EDITOR"),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(deleteConsent).not.toHaveBeenCalled();
  });
});
