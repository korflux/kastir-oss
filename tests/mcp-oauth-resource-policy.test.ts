import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { BETTER_AUTH_URL: "http://localhost:3000" },
}));

describe("MCP OAuth resource policy", () => {
  it("requires the MCP resource on authorization requests", async () => {
    const { validateMcpOAuthResourceRequest } =
      await import("@/lib/Modules/Mcp/OAuthResourcePolicy");

    const missing = await validateMcpOAuthResourceRequest(
      new Request(
        "http://localhost:3000/api/auth/oauth2/authorize?client_id=client",
      ),
    );
    expect(missing?.status).toBe(400);

    const valid = await validateMcpOAuthResourceRequest(
      new Request(
        "http://localhost:3000/api/auth/oauth2/authorize?client_id=client&resource=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmcp",
      ),
    );
    expect(valid).toBeNull();
  });

  it("requires exactly the MCP resource on token and refresh requests", async () => {
    const { validateMcpOAuthResourceRequest } =
      await import("@/lib/Modules/Mcp/OAuthResourcePolicy");

    // RFC 8707 §2.2: refresh inherits the resource pinned at /authorize.
    const refreshWithoutResource = await validateMcpOAuthResourceRequest(
      new Request("http://localhost:3000/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token",
      }),
    );
    expect(refreshWithoutResource).toBeNull();

    // A refresh that sends the wrong resource is still rejected.
    const refreshWrongResource = await validateMcpOAuthResourceRequest(
      new Request("http://localhost:3000/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&resource=https%3A%2F%2Fother.example%2Fapi%2Fmcp",
      }),
    );
    expect(refreshWrongResource?.status).toBe(400);

    // authorization_code still requires it.
    const missing = await validateMcpOAuthResourceRequest(
      new Request("http://localhost:3000/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code",
      }),
    );
    expect(missing?.status).toBe(400);

    const otherResource = await validateMcpOAuthResourceRequest(
      new Request("http://localhost:3000/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "resource=https%3A%2F%2Fother.example%2Fapi%2Fmcp",
      }),
    );
    expect(otherResource?.status).toBe(400);

    const valid = await validateMcpOAuthResourceRequest(
      new Request("http://localhost:3000/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "resource=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmcp",
      }),
    );
    expect(valid).toBeNull();
  });

  it("accepts trailing slash on resource but rejects host/scheme mismatch and multi-value", async () => {
    const { validateMcpOAuthResourceRequest } =
      await import("@/lib/Modules/Mcp/OAuthResourcePolicy");

    const withSlash = await validateMcpOAuthResourceRequest(
      new Request(
        "http://localhost:3000/api/auth/oauth2/authorize?client_id=client&resource=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmcp%2F",
      ),
    );
    expect(withSlash).toBeNull();

    const wrongHost = await validateMcpOAuthResourceRequest(
      new Request(
        "http://localhost:3000/api/auth/oauth2/authorize?client_id=client&resource=http%3A%2F%2Fother.local%3A3000%2Fapi%2Fmcp",
      ),
    );
    expect(wrongHost?.status).toBe(400);

    const multi = await validateMcpOAuthResourceRequest(
      new Request(
        "http://localhost:3000/api/auth/oauth2/authorize?client_id=client&resource=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmcp&resource=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmcp",
      ),
    );
    expect(multi?.status).toBe(400);
  });

  it("rejects a token request body above the local size cap", async () => {
    const { validateMcpOAuthResourceRequest } =
      await import("@/lib/Modules/Mcp/OAuthResourcePolicy");

    const response = await validateMcpOAuthResourceRequest(
      new Request("http://localhost:3000/api/auth/oauth2/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": String(9 * 1024),
        },
        body: "grant_type=authorization_code&" + "a".repeat(9 * 1024),
      }),
    );

    expect(response?.status).toBe(413);
  });

  it("returns a generic 400 for malformed JSON token requests", async () => {
    const { validateMcpOAuthResourceRequest } =
      await import("@/lib/Modules/Mcp/OAuthResourcePolicy");

    const response = await validateMcpOAuthResourceRequest(
      new Request("http://localhost:3000/api/auth/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response?.status).toBe(400);
  });
});
