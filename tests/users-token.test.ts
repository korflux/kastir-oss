import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
    AUTH_TRUST_PROXY: false,
  },
}));

import {
  INVITE_TOKEN_BYTES,
  INVITE_TOKEN_TTL_MS,
  createTokenExpiry,
  digestToken,
  generateToken,
  isTokenUsable,
} from "@/lib/Modules/Users/Token";
import {
  buildUserTokenIpRateLimitKey,
  buildUserTokenRateLimitKey,
} from "@/lib/Modules/Users/RateLimit";

describe("user token helpers", () => {
  it("generates 32 random bytes and stores only a deterministic digest", () => {
    const raw = generateToken(() => Buffer.alloc(INVITE_TOKEN_BYTES, 7));

    expect(raw).toHaveLength(INVITE_TOKEN_BYTES * 2);
    expect(digestToken(raw)).toHaveLength(64);
    expect(digestToken(raw)).toBe(digestToken(raw));
    expect(digestToken(raw)).not.toBe(raw);
  });

  it("expires tokens exactly 24 hours after issuance", () => {
    const issuedAt = new Date("2026-07-17T12:00:00.000Z");
    const expiresAt = createTokenExpiry(issuedAt);

    expect(expiresAt.getTime() - issuedAt.getTime()).toBe(INVITE_TOKEN_TTL_MS);
    expect(isTokenUsable(expiresAt, new Date(expiresAt.getTime() - 1))).toBe(
      true,
    );
    expect(isTokenUsable(expiresAt, expiresAt)).toBe(false);
  });

  it("uses the trusted proxy IP only when configured and never includes the raw token", () => {
    const request = new Request(
      "https://panel.example.test/admin/invite/raw-token",
      {
        headers: { "x-forwarded-for": "203.0.113.10" },
      },
    );
    const withoutProxyTrust = buildUserTokenRateLimitKey(
      request,
      "raw-token",
      false,
    );
    const withProxyTrust = buildUserTokenRateLimitKey(
      request,
      "raw-token",
      true,
    );

    expect(withoutProxyTrust).not.toBe(withProxyTrust);
    expect(withoutProxyTrust).not.toContain("raw-token");
    expect(withProxyTrust).not.toContain("203.0.113.10");
  });

  it("keeps the accept IP bucket stable when the token rotates", () => {
    const first = new Request("https://panel.example.test/api/invite/one", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    const second = new Request("https://panel.example.test/api/invite/two", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    expect(buildUserTokenIpRateLimitKey(first, true)).toBe(
      buildUserTokenIpRateLimitKey(second, true),
    );
    expect(buildUserTokenRateLimitKey(first, "one", true)).not.toBe(
      buildUserTokenRateLimitKey(second, "two", true),
    );
  });
});
