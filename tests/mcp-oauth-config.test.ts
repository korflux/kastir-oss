import { describe, expect, it, vi } from "vitest";

// Import estático: a carga de lib/auth fica na coleta do arquivo, fora do timeout por teste,
// e o teste mede só a leitura das opções. Os `vi.mock` abaixo são içados acima deste import.
import { auth } from "@/lib/auth";

/**
 * Config OAuth do MCP: trava o que `lib/auth.ts` entrega ao plugin `oauthProvider`.
 *
 * Os pacotes do Better Auth são mockados de propósito. O custo de carregá-los a
 * frio (~650 ms de import sozinho, vários segundos quando a suíte roda concorrente)
 * era o que estourava o timeout padrão, e o objeto sob teste é a configuração do
 * Kastir, não o pacote. Cada mock devolve as opções recebidas em `options`, o mesmo
 * contrato do plugin real, então as asserções leem a configuração como ela é escrita.
 * O contrato com o provider real (aceitar essas opções e publicar o metadata) é
 * provado por tests/mcp-metadata.test.ts, que mantém o stack real.
 */
const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((options: object) => ({ options })),
  jwt: vi.fn((options: object) => ({ id: "jwt", options })),
  oauthProvider: vi.fn((options: object) => ({
    id: "oauth-provider",
    options,
  })),
  prismaAdapter: vi.fn(() => ({ id: "prisma-adapter" })),
}));

vi.mock("better-auth", () => ({ betterAuth: mocks.betterAuth }));
vi.mock("better-auth/plugins", () => ({ jwt: mocks.jwt }));
vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: mocks.oauthProvider,
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

describe("MCP OAuth configuration", () => {
  it("registers the modern provider with the CMS resource scopes", () => {
    const oauthPlugin = auth.options.plugins?.find(
      (plugin) => plugin.id === "oauth-provider",
    );

    expect(oauthPlugin).toBeDefined();
    expect(oauthPlugin?.options).toMatchObject({
      loginPage: "/admin/login",
      consentPage: "/admin/mcp/consent",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      scopes: [
        "cms:read",
        "cms:pages:write",
        "cms:pages:publish",
        "cms:pages:unpublish",
        "cms:media:write",
        "cms:scripts:write",
        "cms:scripts:publish",
        "cms:scripts:unpublish",
        "cms:split-tests:write",
        "cms:settings:write",
        "cms:logs:read",
        "offline_access",
      ],
      disableJwtPlugin: true,
      storeClientSecret: "encrypted",
      resources: [
        {
          identifier: "http://localhost:3000/api/mcp",
          name: "Kastir MCP",
          allowedScopes: [
            "cms:read",
            "cms:pages:write",
            "cms:pages:publish",
            "cms:pages:unpublish",
            "cms:media:write",
            "cms:scripts:write",
            "cms:scripts:publish",
            "cms:scripts:unpublish",
            "cms:split-tests:write",
            "cms:settings:write",
            "cms:logs:read",
            "offline_access",
          ],
        },
      ],
      enforcePerClientResources: false,
    });
  });

  it("keeps the package default DPoP algorithms that the protected-resource metadata publishes", () => {
    // A rota /.well-known/oauth-protected-resource não lê o provider (ver OAuthResource.ts):
    // customizar `dpop` aqui exige passar a publicar o mesmo valor lá.
    const oauthPlugin = auth.options.plugins?.find(
      (plugin) => plugin.id === "oauth-provider",
    );

    expect(oauthPlugin).toBeDefined();
    expect(oauthPlugin?.options).not.toHaveProperty("dpop");
  });
});
