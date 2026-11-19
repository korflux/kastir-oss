import { describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getClient = vi.hoisted(() => vi.fn());
const connection = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error("REDIRECT:" + url);
  }),
);

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession } },
}));

vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
    PANEL_LANGUAGE: "en",
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/server", () => ({ connection }));

vi.mock("@/lib/Modules/Mcp/Consent", () => ({
  getMcpOAuthClientPublic: getClient,
}));

vi.mock("@/lib/Modules/Mcp/Components/ConsentScreen", () => ({
  ConsentScreen: (props: Record<string, unknown>) => props,
}));

const signedQuery = {
  client_id: "claude-client",
  redirect_uri: "https://claude.example/callback",
  response_type: "code",
  scope: "cms:read cms:pages:publish unknown:scope",
  resource: "http://localhost:3000/api/mcp",
  exp: "1999999999",
  sig: "signed-value",
};

describe("MCP OAuth consent", () => {
  it("preserves the signed OAuth query and limits approval to current-role scopes", async () => {
    getSession.mockResolvedValueOnce({
      user: {
        id: "user-1",
        name: "Editor",
        email: "editor@example.test",
        role: "EDITOR",
        isMaster: false,
      },
    });
    getClient.mockResolvedValueOnce({
      clientId: "claude-client",
      name: "Claude",
      uri: null,
      icon: null,
    });

    const { default: Page } =
      await import("@/app/admin/(auth)/mcp/consent/page");
    const element = (await Page({
      searchParams: Promise.resolve(signedQuery),
    })) as {
      props: {
        client: { name: string; verified: boolean; icon: string | null };
        grantedScopes: string[];
        oauthQuery: string;
        redirectUri: string;
        requestedScopes: string[];
        role: string;
      };
    };
    const result = element.props;

    expect(result.client.name).toBe("Claude");
    expect(result.client.verified).toBe(false);
    expect(result.client.icon).toBeNull();
    expect(result.redirectUri).toBe("https://claude.example/callback");
    expect(result.grantedScopes).toEqual(["cms:read", "cms:pages:publish"]);
    expect(result.role).toBe("EDITOR");
    expect(result.requestedScopes).toContain("unknown:scope");
    expect(result.oauthQuery).toContain("sig=signed-value");
    expect(result.oauthQuery).toContain(
      "redirect_uri=https%3A%2F%2Fclaude.example%2Fcallback",
    );
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(
      getSession.mock.invocationCallOrder[0],
    );
  });

  it("marks a DCR client as unverified and strips its attacker-controlled icon", async () => {
    getSession.mockResolvedValueOnce({
      user: {
        id: "user-1",
        name: "Editor",
        email: "editor@example.test",
        role: "EDITOR",
        isMaster: false,
      },
    });
    getClient.mockResolvedValueOnce({
      clientId: "attacker-client",
      name: "Claude",
      uri: "https://claude.ai",
      icon: "https://evil.example/claude.svg",
      verified: false,
    });

    const { default: Page } =
      await import("@/app/admin/(auth)/mcp/consent/page");
    const element = (await Page({
      searchParams: Promise.resolve({
        ...signedQuery,
        client_id: "attacker-client",
      }),
    })) as {
      props: {
        client: { name: string; verified: boolean; icon: string | null };
        redirectUri: string;
      };
    };

    expect(element.props.client.name).toBe("Claude");
    expect(element.props.client.verified).toBe(false);
    expect(element.props.client.icon).toBeNull();
    expect(element.props.redirectUri).toBe("https://claude.example/callback");
  });

  it("keeps icon and verified flag when the server marked skipConsent", async () => {
    getSession.mockResolvedValueOnce({
      user: {
        id: "user-1",
        name: "Editor",
        email: "editor@example.test",
        role: "EDITOR",
        isMaster: false,
      },
    });
    getClient.mockResolvedValueOnce({
      clientId: "claude-client",
      name: "Claude",
      uri: null,
      icon: "https://claude.example/icon.png",
      verified: true,
    });

    const { default: Page } =
      await import("@/app/admin/(auth)/mcp/consent/page");
    const element = (await Page({
      searchParams: Promise.resolve(signedQuery),
    })) as {
      props: {
        client: { name: string; verified: boolean; icon: string | null };
      };
    };

    expect(element.props.client.verified).toBe(true);
    expect(element.props.client.icon).toBe("https://claude.example/icon.png");
  });

  it("never grants EDITOR the Settings write or Logs read scopes, even when requested", async () => {
    getSession.mockResolvedValueOnce({
      user: {
        id: "user-1",
        name: "Editor",
        email: "editor@example.test",
        role: "EDITOR",
        isMaster: false,
      },
    });
    getClient.mockResolvedValueOnce({
      clientId: "claude-client",
      name: "Claude",
      uri: null,
      icon: null,
    });

    const { default: Page } =
      await import("@/app/admin/(auth)/mcp/consent/page");
    const element = (await Page({
      searchParams: Promise.resolve({
        ...signedQuery,
        scope:
          "cms:read cms:pages:write cms:pages:publish cms:pages:unpublish " +
          "cms:media:write cms:scripts:write cms:scripts:publish cms:scripts:unpublish " +
          "cms:split-tests:write cms:settings:write cms:logs:read offline_access",
      }),
    })) as { props: { grantedScopes: string[]; role: string } };

    expect(element.props.grantedScopes).toContain("cms:split-tests:write");
    expect(element.props.grantedScopes).not.toContain("cms:settings:write");
    expect(element.props.grantedScopes).not.toContain("cms:logs:read");
    expect(element.props.role).toBe("EDITOR");
  });

  it("grants ADMIN the full requested scope set including Settings write and Logs read", async () => {
    getSession.mockResolvedValueOnce({
      user: {
        id: "user-2",
        name: "Admin",
        email: "admin@example.test",
        role: "ADMIN",
        isMaster: false,
      },
    });
    getClient.mockResolvedValueOnce({
      clientId: "claude-client",
      name: "Claude",
      uri: null,
      icon: null,
    });

    const { default: Page } =
      await import("@/app/admin/(auth)/mcp/consent/page");
    const element = (await Page({
      searchParams: Promise.resolve({
        ...signedQuery,
        scope: "cms:read cms:settings:write cms:logs:read offline_access",
      }),
    })) as { props: { grantedScopes: string[]; role: string } };

    expect(element.props.grantedScopes).toEqual(
      expect.arrayContaining([
        "cms:read",
        "cms:settings:write",
        "cms:logs:read",
      ]),
    );
    expect(element.props.role).toBe("ADMIN");
  });

  it("sends unauthenticated users back to login with the consent path", async () => {
    getSession.mockResolvedValueOnce(null);

    const { default: Page } =
      await import("@/app/admin/(auth)/mcp/consent/page");

    await expect(
      Page({ searchParams: Promise.resolve(signedQuery) }),
    ).rejects.toThrow("REDIRECT:/admin/login?next=");
    expect(redirect).toHaveBeenCalledWith(
      expect.stringContaining("/admin/login?next="),
    );
  });
});
