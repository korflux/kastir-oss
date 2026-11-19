import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, limit } = vi.hoisted(() => ({
  getSession: vi.fn(),
  limit: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/env", () => ({
  env: {
    REDIS_URL: "redis://:kastir@localhost:6379",
    AUTH_TRUST_PROXY: false,
    PANEL_LANGUAGE: "en",
  },
}));
vi.mock("@/lib/ratelimit", () => ({
  createRedisRateLimitClient: vi.fn(() => ({})),
}));
vi.mock("@upstash/ratelimit", () => {
  class RatelimitMock {
    limit = limit;

    static fixedWindow(requests: number, window: string) {
      return { requests, window };
    }
  }

  return { Ratelimit: RatelimitMock };
});

import { GET } from "@/app/api/admin-bar/session/route";
import {
  buildAdminBarRateLimitKey,
  checkAdminBarRateLimit,
} from "@/lib/Modules/Panel/PublicBarRateLimit";

describe("published admin bar session API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue({ success: true });
    getSession.mockResolvedValue({
      user: {
        id: "admin-id",
        name: "Panel Admin",
        email: "admin@example.com",
        role: "ADMIN",
        isMaster: false,
      },
      session: { id: "session-id", token: "secret-token" },
    });
  });

  it("returns only the minimal DTO for every effective role", async () => {
    for (const [role, isMaster] of [
      ["MASTER", true],
      ["ADMIN", false],
      ["EDITOR", false],
    ] as const) {
      getSession.mockResolvedValueOnce({
        user: {
          id: `${role.toLowerCase()}-id`,
          name: "Visible Name",
          email: "private@example.com",
          role: role === "MASTER" ? "ADMIN" : role,
          isMaster,
        },
        session: { id: "private-session", token: "private-token" },
      });

      const response = await GET(
        new Request("http://localhost/api/admin-bar/session"),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        user: {
          id: `${role.toLowerCase()}-id`,
          name: "Visible Name",
          role,
        },
        locale: "en",
      });
    }
  });

  it("returns a cache-safe empty DTO without a session", async () => {
    getSession.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://localhost/api/admin-bar/session"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      user: null,
      locale: "en",
    });
  });

  it("fails closed for an invalid persisted role", async () => {
    getSession.mockResolvedValueOnce({
      user: {
        id: "invalid-id",
        name: "Invalid Role",
        role: "OWNER",
        isMaster: false,
      },
    });

    const response = await GET(
      new Request("http://localhost/api/admin-bar/session"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    });
  });

  it("returns 429 without exposing session data when the dedicated limit is hit", async () => {
    limit.mockResolvedValueOnce({ success: false });

    const response = await GET(
      new Request("http://localhost/api/admin-bar/session"),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Too many requests",
      code: "RATE_LIMITED",
    });
  });

  it("returns 503 when the rate-limit dependency is unavailable", async () => {
    limit.mockRejectedValueOnce(new Error("redis unavailable"));

    const response = await GET(
      new Request("http://localhost/api/admin-bar/session"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Service unavailable",
      code: "RATE_LIMIT_UNAVAILABLE",
    });
  });

  it("uses digest-only keys and respects trusted proxy configuration", async () => {
    const request = new Request("http://localhost/site/index.html", {
      headers: {
        "user-agent": "private-agent",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });

    const untrusted = buildAdminBarRateLimitKey(request, null, false);
    const trusted = buildAdminBarRateLimitKey(request, null, true);
    const sessionKey = buildAdminBarRateLimitKey(
      request,
      "session-user",
      false,
    );
    // Without a trusted proxy, all anonymous traffic shares the unknown-ip bucket.
    const untrustedOther = buildAdminBarRateLimitKey(
      new Request("http://localhost/other", {
        headers: { "x-forwarded-for": "198.51.100.1" },
      }),
      null,
      false,
    );

    expect(untrusted).toMatch(/^[a-f0-9]{64}$/);
    expect(trusted).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set([untrusted, trusted, sessionKey]).size).toBe(3);
    expect(untrusted).toBe(untrustedOther);
    expect(untrusted).not.toContain("203.0.113.10");
    expect(untrusted).not.toContain("private-agent");

    await expect(checkAdminBarRateLimit(request, null)).resolves.toEqual({
      allowed: true,
      unavailable: false,
    });
    expect(limit).toHaveBeenLastCalledWith(
      expect.stringMatching(/^admin-bar:session:[a-f0-9]{64}$/),
    );
  });
});
