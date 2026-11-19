import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const instance = {
    api: { getSession: vi.fn() },
    handler: vi.fn(),
    options: { plugins: [] },
    get receiver() {
      return this;
    },
  };

  return {
    betterAuth: vi.fn(() => instance),
    createAuthClient: vi.fn(() => ({
      getProtectedResourceMetadata: vi.fn(),
    })),
    instance,
    jwt: vi.fn(() => ({ id: "jwt" })),
    oauthProvider: vi.fn(() => ({ id: "oauth-provider" })),
    oauthProviderResourceClient: vi.fn((auth: object) => {
      Reflect.get(auth, "options");
      return { id: "oauth-resource-client" };
    }),
    prismaAdapter: vi.fn(() => ({ id: "prisma-adapter" })),
  };
});

vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/client", () => ({
  createAuthClient: mocks.createAuthClient,
}));
vi.mock("better-auth/plugins", () => ({ jwt: mocks.jwt }));
vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: mocks.oauthProvider,
}));
vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: mocks.oauthProviderResourceClient,
}));
vi.mock("@better-auth/prisma-adapter", () => ({
  prismaAdapter: mocks.prismaAdapter,
}));
vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
    NEXTAUTH_SECRET: "test-secret-with-at-least-32-characters",
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Modules/Auth/Password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

describe("lazy Better Auth singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not initialize auth or its plugins during module import", async () => {
    await import("@/lib/auth");

    expect(mocks.betterAuth).not.toHaveBeenCalled();
    expect(mocks.prismaAdapter).not.toHaveBeenCalled();
    expect(mocks.jwt).not.toHaveBeenCalled();
    expect(mocks.oauthProvider).not.toHaveBeenCalled();
  });

  it("initializes once on first access and forwards properties with the real receiver", async () => {
    const { auth } = await import("@/lib/auth");

    expect(auth.api).toBe(mocks.instance.api);
    expect(auth.handler).toBe(mocks.instance.handler);
    expect("handler" in auth).toBe(true);
    expect(Reflect.get(auth, "receiver")).toBe(mocks.instance);
    expect(auth.options).toBe(mocks.instance.options);
    expect(mocks.betterAuth).toHaveBeenCalledTimes(1);
  });

  it("keeps the protected-resource metadata route inert during import", async () => {
    await import("@/app/.well-known/oauth-protected-resource/route");

    expect(mocks.oauthProviderResourceClient).not.toHaveBeenCalled();
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
    expect(mocks.betterAuth).not.toHaveBeenCalled();
  });
});
