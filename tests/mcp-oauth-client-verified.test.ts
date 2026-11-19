import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isMcpOAuthClientVerified } from "@/lib/Modules/Mcp/Consent";

describe("MCP OAuth client verification", () => {
  it("treats DCR clients as unverified (skipConsent cannot be set via RFC 7591)", () => {
    expect(isMcpOAuthClientVerified({ skipConsent: null })).toBe(false);
    expect(isMcpOAuthClientVerified({ skipConsent: false })).toBe(false);
    expect(isMcpOAuthClientVerified({})).toBe(false);
  });

  it("treats only server-set skipConsent as verified identity", () => {
    expect(isMcpOAuthClientVerified({ skipConsent: true })).toBe(true);
  });
});
