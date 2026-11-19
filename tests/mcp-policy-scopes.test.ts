import { describe, expect, it } from "vitest";

import {
  allowedMcpScopes,
  grantedOAuthConsentScopes,
  requireMcpAdministrator,
  requireMcpScope,
  roleAllowsOfflineAccess,
} from "@/lib/Modules/Mcp/Policy";
import { MCP_SCOPES } from "@/lib/Modules/Mcp/Scopes";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";
import { canMcp } from "@/lib/Modules/Mcp/Tools/Shared";

function context(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    actor: { id: "user-1", name: "User", email: "user@example.test" },
    userId: "user-1",
    role: "ADMIN",
    scopes: MCP_SCOPES,
    clientId: "client-1",
    resource: "https://public.example/api/mcp",
    requestId: "request-1",
    ...overrides,
  };
}

describe("MCP scope policy", () => {
  it("includes the phase 24 scopes in MCP_SCOPES", () => {
    expect(MCP_SCOPES).toContain("cms:split-tests:write");
    expect(MCP_SCOPES).toContain("cms:settings:write");
    expect(MCP_SCOPES).toContain("cms:logs:read");
  });

  it("never grants EDITOR offline_access even when the client requests it", () => {
    expect(roleAllowsOfflineAccess("EDITOR")).toBe(false);
    expect(roleAllowsOfflineAccess("ADMIN")).toBe(true);
    expect(roleAllowsOfflineAccess("MASTER")).toBe(true);
    expect(
      grantedOAuthConsentScopes(
        "EDITOR",
        ["cms:read"],
        ["cms:read", "offline_access"],
      ),
    ).toEqual(["cms:read"]);
    expect(
      grantedOAuthConsentScopes(
        "ADMIN",
        ["cms:read"],
        ["cms:read", "offline_access"],
      ),
    ).toEqual(["cms:read", "offline_access"]);
  });

  it("never grants EDITOR the Settings write or Logs read scopes", () => {
    const granted = allowedMcpScopes("EDITOR", MCP_SCOPES);
    expect(granted).not.toContain("cms:settings:write");
    expect(granted).not.toContain("cms:logs:read");
    expect(granted).toContain("cms:split-tests:write");
    expect(granted).toContain("cms:read");
  });

  it("grants ADMIN and MASTER the full set including the new scopes", () => {
    for (const role of ["ADMIN", "MASTER"] as const) {
      const granted = allowedMcpScopes(role, MCP_SCOPES);
      expect(granted).toContain("cms:split-tests:write");
      expect(granted).toContain("cms:settings:write");
      expect(granted).toContain("cms:logs:read");
    }
  });

  it("keeps requireMcpAdministrator throwing FORBIDDEN for EDITOR", () => {
    expect(() => requireMcpAdministrator(context({ role: "EDITOR" }))).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() =>
      requireMcpAdministrator(context({ role: "ADMIN" })),
    ).not.toThrow();
    expect(() =>
      requireMcpAdministrator(context({ role: "MASTER" })),
    ).not.toThrow();
  });

  it("requireMcpScope enforces granted scope and the role allowlist", () => {
    expect(() =>
      requireMcpScope(context({ scopes: ["cms:read"] }), "cms:settings:write"),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() =>
      requireMcpScope(
        context({ role: "EDITOR", scopes: MCP_SCOPES }),
        "cms:settings:write",
      ),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("denies capabilities that a forged scope cannot grant to the role", () => {
    const forgedEditor = context({ role: "EDITOR", scopes: MCP_SCOPES });

    expect(canMcp(forgedEditor, "settings", "write")).toBe(false);
    expect(canMcp(forgedEditor, "logs", "read")).toBe(false);
    expect(canMcp(forgedEditor, "scripts", "write")).toBe(true);
  });
});
