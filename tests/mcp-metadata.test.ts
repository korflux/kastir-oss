import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Imports estáticos de propósito: o carregamento a frio do stack real do Better Auth
// (centenas de ms sozinho, vários segundos com a suíte concorrente) acontece na fase de
// coleta do arquivo, que não tem timeout por teste. Assim o timeout padrão mede só o que
// o teste afirma (init do provider e resposta da rota), não o custo de ler node_modules.
// O `vi.mock` abaixo é içado pelo Vitest acima destes imports.
// ponytail: a coleta não tem timeout por arquivo, então um import travado só cai no timeout
// do job de CI, revisitar se o Vitest passar a limitar o tempo de coleta.
import { GET as getAuthServerMetadata } from "@/app/.well-known/oauth-authorization-server/[...issuerPath]/route";
import { GET as getProtectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";

const mocks = vi.hoisted(() => ({
  // O provider 1.7 semeia o resource ao inicializar as rotas de metadata.
  findFirst: vi.fn().mockResolvedValue({
    id: "resource-id",
    identifier: "http://localhost:3000/api/mcp",
  }),
}));

vi.mock("@/lib/env", () => ({
  env: {
    BETTER_AUTH_URL: "http://localhost:3000",
    NEXTAUTH_SECRET: "test-secret-with-at-least-32-characters",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    oauthResource: {
      findFirst: mocks.findFirst,
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/Modules/Auth/Password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

describe("MCP OAuth metadata", () => {
  // O teste do authorization server inicializa o provider real (e chama findFirst);
  // zerar as chamadas antes de cada teste torna a asserção de rota estática independente da ordem.
  beforeEach(() => {
    mocks.findFirst.mockClear();
  });

  it("publishes the protected resource contract for the MCP endpoint", async () => {
    const response = await getProtectedResourceMetadata();
    const metadata = await response.json();

    expect(response.status).toBe(200);
    expect(metadata).toMatchObject({
      resource: "http://localhost:3000/api/mcp",
      authorization_servers: ["http://localhost:3000/api/auth"],
      scopes_supported: [
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
      ],
      bearer_methods_supported: ["header"],
    });
    // A rota é estática: não inicializa o Better Auth, logo não toca no banco.
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("publishes authorization server metadata at the root discovery alias", async () => {
    const response = await getAuthServerMetadata(
      new Request(
        "http://localhost:3000/.well-known/oauth-authorization-server/api/auth",
      ),
    );
    const metadata = await response.json();

    expect(response.status).toBe(200);
    expect(metadata).toMatchObject({
      issuer: "http://localhost:3000/api/auth",
      authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
      token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
    });
    // DCR (RFC 7591) must be advertised for clients like Codex that register dynamically.
    expect(typeof metadata.registration_endpoint).toBe("string");
    expect(metadata.registration_endpoint).toMatch(/\/api\/auth/);
  });

  it("forwards root OAuth metadata to Next instead of serving public files", async () => {
    const nginx = await readFile("nginx.conf", "utf8");

    expect(nginx).toContain("location ^~ /.well-known/");
    expect(nginx).toContain("proxy_pass http://kastir_next");
    expect(nginx).toContain("client_max_body_size 210m");
  });
});
