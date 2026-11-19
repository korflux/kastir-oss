import { afterEach, describe, expect, it, vi } from "vitest";

const validEnv = {
  DATABASE_URL: "postgresql://kastir:kastir@localhost:5432/kastir",
  REDIS_URL: "redis://:kastir@localhost:6379",
  NEXTAUTH_SECRET: "a-secret-with-at-least-thirty-two-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  MASTER_EMAIL: "admin@example.com",
  MASTER_PASSWORD: "change-me",
};

describe("environment validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("parses required values and applies safe defaults", async () => {
    for (const [name, value] of Object.entries(validEnv)) {
      vi.stubEnv(name, value);
    }

    const { env } = await import("@/lib/env");

    expect(env.MASTER_FORCE_RESET).toBe(false);
    expect(env.PANEL_LANGUAGE).toBe("en");
    expect(env.AUTH_TRUST_PROXY).toBe(false);
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
  });

  it("reports the missing required field", async () => {
    for (const [name, value] of Object.entries(validEnv)) {
      if (name !== "MASTER_EMAIL") vi.stubEnv(name, value);
    }
    vi.stubEnv("MASTER_EMAIL", "");

    await expect(import("@/lib/env")).rejects.toThrow(/MASTER_EMAIL/);
  });

  it("requires BETTER_AUTH_URL", async () => {
    for (const [name, value] of Object.entries(validEnv)) {
      if (name !== "BETTER_AUTH_URL") vi.stubEnv(name, value);
    }
    // O teste prova ausência do campo mesmo quando o runner injeta um ambiente válido.
    vi.stubEnv("BETTER_AUTH_URL", "");

    await expect(import("@/lib/env")).rejects.toThrow(/BETTER_AUTH_URL/);
  });

  it("parses the string false as false", async () => {
    for (const [name, value] of Object.entries(validEnv)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("MASTER_FORCE_RESET", "false");
    vi.stubEnv("AUTH_TRUST_PROXY", "true");

    const { env } = await import("@/lib/env");

    expect(env.MASTER_FORCE_RESET).toBe(false);
    expect(env.AUTH_TRUST_PROXY).toBe(true);
  });
});
