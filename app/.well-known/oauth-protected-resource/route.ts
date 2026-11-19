import { env } from "@/lib/env";
import {
  getMcpIssuerUrl,
  getMcpResourceUrl,
  MCP_SCOPES,
} from "@/lib/Modules/Mcp/Scopes";
import { getMcpOAuthResourceClient } from "@/lib/Modules/Mcp/OAuthResource";

/**
 * RFC 9728: metadata do recurso protegido MCP, servido sem inicializar o Better Auth.
 * Os escopos vêm de `MCP_SCOPES`, a mesma fonte que `lib/auth.ts` entrega ao
 * provider; o resource client sem `auth` não os conhece, então a validação deles
 * exige declará-los como `externalScopes` (ver `OAuthResource.ts`).
 */
export async function GET(): Promise<Response> {
  const metadata =
    await getMcpOAuthResourceClient().getProtectedResourceMetadata(
      {
        resource: getMcpResourceUrl(env.BETTER_AUTH_URL),
        authorization_servers: [getMcpIssuerUrl(env.BETTER_AUTH_URL)],
        scopes_supported: [...MCP_SCOPES],
        bearer_methods_supported: ["header"],
      },
      { externalScopes: [...MCP_SCOPES] },
    );

  return Response.json(metadata, {
    headers: {
      "Cache-Control":
        "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400",
    },
  });
}
