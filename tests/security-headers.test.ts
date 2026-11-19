import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

describe("security headers", () => {
  it("keeps the server-side SVG sanitizer external to preserve jsdom assets", () => {
    expect(nextConfig.serverExternalPackages).toContain("isomorphic-dompurify");
  });

  // Guard da decisão de manter o AGENTS.md só com as regras do projeto: sem
  // isso, `next dev` (16.3+) volta a injetar o bloco `nextjs-agent-rules`.
  it("keeps Next's agent-rules auto-generation off so AGENTS.md stays project-owned", () => {
    expect(nextConfig.agentRules).toBe(false);
  });

  it("hardens every admin response without affecting published pages", async () => {
    const routes = await nextConfig.headers?.();
    const admin = routes?.find((route) => route.source === "/admin/:path*");
    const headers = Object.fromEntries(
      admin?.headers.map(({ key, value }) => [key, value]) ?? [],
    );

    expect(headers).toMatchObject({
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    // Content-Security-Policy needs a per-request nonce and is set in
    // proxy.ts instead — see tests/proxy.test.ts.
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("adds nosniff and Referrer-Policy to published pages without XFO or HSTS", async () => {
    const routes = await nextConfig.headers?.();
    const published = routes?.find((route) => route.source === "/:path*");
    const headers = Object.fromEntries(
      published?.headers.map(({ key, value }) => [key, value]) ?? [],
    );

    expect(headers).toEqual({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("adds transport-safe headers to private preview responses", async () => {
    const routes = await nextConfig.headers?.();
    const preview = routes?.find((route) => route.source === "/p/:path*");
    const headers = Object.fromEntries(
      preview?.headers.map(({ key, value }) => [key, value]) ?? [],
    );

    expect(headers).toMatchObject({
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("adds transport-safe headers to API responses", async () => {
    const routes = await nextConfig.headers?.();
    const api = routes?.find((route) => route.source === "/api/:path*");
    const headers = Object.fromEntries(
      api?.headers.map(({ key, value }) => [key, value]) ?? [],
    );

    expect(headers).toMatchObject({
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000",
      "X-Content-Type-Options": "nosniff",
    });
  });
});
