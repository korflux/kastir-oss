import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession } },
}));

import { proxy } from "@/proxy";

describe("admin proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects anonymous users to login", async () => {
    getSession.mockResolvedValue(null);

    const response = await proxy(
      new NextRequest("http://localhost/admin/pages"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/admin/login",
    );
  });

  it("allows only the exact anonymous invite and reset pages", async () => {
    getSession.mockResolvedValue(null);

    const invite = await proxy(
      new NextRequest("http://localhost/admin/invite/raw-token"),
    );
    const reset = await proxy(
      new NextRequest("http://localhost/admin/reset-password/raw-token"),
    );
    const nested = await proxy(
      new NextRequest("http://localhost/admin/invite/raw-token/extra"),
    );

    expect(invite.status).toBe(200);
    expect(reset.status).toBe(200);
    expect(nested.status).toBe(307);
    expect(nested.headers.get("location")).toBe("http://localhost/admin/login");
  });

  it("leaves the login page and its continuation to the page handler", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/admin/login?next=%2Fp%2Flanding"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("marks login and MCP consent as noindex", async () => {
    const login = await proxy(new NextRequest("http://localhost/admin/login"));
    const consent = await proxy(
      new NextRequest("http://localhost/admin/mcp/consent"),
    );

    expect(login.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(consent.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("allows a master to access restricted routes and their subroutes", async () => {
    getSession.mockResolvedValue({
      user: { id: "master-id", role: "ADMIN", isMaster: true },
    });

    const response = await proxy(
      new NextRequest("http://localhost/admin/users/123"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("allows an admin to access setup subroutes", async () => {
    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });

    const logsResponse = await proxy(
      new NextRequest("http://localhost/admin/settings/logs"),
    );
    const settingsResponse = await proxy(
      new NextRequest("http://localhost/admin/settings/general"),
    );

    expect(logsResponse.status).toBe(200);
    expect(settingsResponse.status).toBe(200);
  });

  it("redirects an editor away from users, logs and settings", async () => {
    getSession.mockResolvedValue({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });

    const response = await proxy(
      new NextRequest("http://localhost/admin/users/123"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/admin/forbidden",
    );
  });

  it("fails closed for an invalid role", async () => {
    getSession.mockResolvedValue({
      user: { id: "unknown-id", role: "OWNER", isMaster: false },
    });

    const response = await proxy(
      new NextRequest("http://localhost/admin/settings/site"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/admin/forbidden",
    );
  });

  it("lets the forbidden page render for an authenticated invalid role", async () => {
    getSession.mockResolvedValue({
      user: { id: "unknown-id", role: "OWNER", isMaster: false },
    });

    const response = await proxy(
      new NextRequest("http://localhost/admin/forbidden"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("redirects unknown admin paths to forbidden", async () => {
    getSession.mockResolvedValue({
      user: { id: "master-id", role: "ADMIN", isMaster: true },
    });

    const response = await proxy(
      new NextRequest("http://localhost/admin/not-a-route"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/admin/forbidden",
    );
  });

  it("lets the MCP consent page through, logged in or not", async () => {
    const url =
      "http://localhost/admin/mcp/consent?client_id=c&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&exp=1&sig=s";

    getSession.mockResolvedValue(null);
    expect((await proxy(new NextRequest(url))).status).toBe(200);

    getSession.mockResolvedValue({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });
    expect((await proxy(new NextRequest(url))).status).toBe(200);
  });

  it("leaves non-admin requests untouched", async () => {
    getSession.mockResolvedValue(null);

    const response = await proxy(new NextRequest("http://localhost/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("sets a nonce-scoped CSP with no 'unsafe-inline' script source", async () => {
    getSession.mockResolvedValue(null);

    const response = await proxy(
      new NextRequest("http://localhost/admin/login"),
    );
    const csp = response.headers.get("Content-Security-Policy");

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("uses a fresh nonce per request and forwards it via x-nonce", async () => {
    getSession.mockResolvedValue(null);

    const first = await proxy(new NextRequest("http://localhost/admin/login"));
    const second = await proxy(new NextRequest("http://localhost/admin/login"));

    const firstNonce = first.headers
      .get("Content-Security-Policy")
      ?.match(/'nonce-([^']+)'/)?.[1];
    const secondNonce = second.headers
      .get("Content-Security-Policy")
      ?.match(/'nonce-([^']+)'/)?.[1];

    expect(firstNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(firstNonce);
  });

  it("still sets a CSP on login/forbidden redirects", async () => {
    getSession.mockResolvedValue({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });

    const response = await proxy(
      new NextRequest("http://localhost/admin/users/123"),
    );

    expect(response.headers.get("location")).toBe(
      "http://localhost/admin/forbidden",
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
  });
});
