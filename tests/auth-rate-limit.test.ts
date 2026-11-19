import { afterEach, describe, expect, it, vi } from "vitest";

const { emailLimit, ipLimit } = vi.hoisted(() => ({
  emailLimit: vi.fn().mockResolvedValue({ success: true }),
  ipLimit: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    REDIS_URL: "redis://:kastir@localhost:6379",
    AUTH_TRUST_PROXY: false,
  },
}));

vi.mock("@/lib/ratelimit", () => ({
  createRedisRateLimitClient: vi.fn(() => ({})),
  createRateLimiter: vi.fn(),
}));

vi.mock("@upstash/ratelimit", () => {
  let instance = 0;

  class RatelimitMock {
    limit = instance++ === 0 ? emailLimit : ipLimit;
    static fixedWindow(requests: number, window: string) {
      return { requests, window };
    }
  }

  return { Ratelimit: RatelimitMock };
});

import {
  buildSignInRateLimitKeys,
  isAuthRequestAllowed,
  isEmailSignInRequest,
  resolveClientIp,
  SIGN_IN_IP_RATE_LIMIT,
  SIGN_IN_RATE_LIMIT,
} from "@/lib/auth-rate-limit";

describe("authentication rate limit", () => {
  afterEach(() => {
    emailLimit.mockClear();
    ipLimit.mockClear();
  });

  it("ignores proxy headers unless trusted and prefers the proxy-owned real IP", () => {
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "198.51.100.20",
      },
    });

    expect(resolveClientIp(request, false)).toBeNull();
    expect(resolveClientIp(request, true)).toBe("198.51.100.20");
  });

  it("keeps the email bucket stable when a client spoofs forwarded IPs", () => {
    const first = new Request("http://localhost/api/auth/sign-in/email", {
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "198.51.100.20",
      },
    });
    const second = new Request("http://localhost/api/auth/sign-in/email", {
      headers: {
        "x-forwarded-for": "203.0.113.11",
        "x-real-ip": "198.51.100.20",
      },
    });

    const firstKeys = buildSignInRateLimitKeys(
      first,
      "Master@Example.com",
      true,
    );
    const secondKeys = buildSignInRateLimitKeys(
      second,
      "Master@Example.com",
      true,
    );

    expect(firstKeys.email).toMatch(/^[a-f0-9]{64}$/);
    expect(firstKeys.email).toBe(secondKeys.email);
    expect(firstKeys.ip).toBe(secondKeys.ip);
    expect(firstKeys.ip).not.toBe(firstKeys.email);
  });

  it("uses a hashed key and preserves the request body", async () => {
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
      body: JSON.stringify({ email: "Master@Example.com", password: "secret" }),
    });

    await expect(isAuthRequestAllowed(request)).resolves.toBe(true);
    await expect(request.json()).resolves.toEqual({
      email: "Master@Example.com",
      password: "secret",
    });

    const key = emailLimit.mock.calls[0]?.[0] as string;
    expect(key).toMatch(/^auth:sign-in:[a-f0-9]{64}$/);
    expect(key).not.toContain("Master");
    expect(ipLimit).not.toHaveBeenCalled();
    expect(SIGN_IN_RATE_LIMIT.requests).toBe(5);
    expect(SIGN_IN_IP_RATE_LIMIT.requests).toBeGreaterThan(
      SIGN_IN_RATE_LIMIT.requests,
    );
  });

  it("only applies to the Better Auth email sign-in endpoint", () => {
    expect(
      isEmailSignInRequest(
        new Request("http://localhost/api/auth/sign-in/email"),
      ),
    ).toBe(true);
    expect(
      isEmailSignInRequest(new Request("http://localhost/api/auth/session")),
    ).toBe(false);
  });
});
