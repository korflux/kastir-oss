import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { createAuthClient } from "better-auth/client";

/**
 * MCP metadata: resource client sem `auth`, de propósito.
 *
 * Passar a instância `auth` faria o `getProtectedResourceMetadata` aguardar
 * `auth.$context`, ou seja, importar e inicializar o Better Auth inteiro (adapter,
 * plugins e a semeadura do resource no banco) só para devolver um JSON estático
 * já definido por `Scopes.ts`. Sem `auth`, a rota de descoberta não toca no
 * banco nem no stack de auth; a resposta é a mesma porque a rota informa
 * `resource`, `authorization_servers` e `scopes_supported` explicitamente.
 *
 * `externalScopes`: sem `auth`, o pacote não conhece os escopos do provider e recusa
 * qualquer `scopes_supported` ("Unsupported scope"). Por isso a rota declara
 * `MCP_SCOPES` em `externalScopes` ao chamar `getProtectedResourceMetadata`.
 *
 * ponytail: `scopes_supported` é validado só contra `MCP_SCOPES` (a mesma lista que a
 * rota envia), e não contra `oauthProvider.scopes`; a divergência entre os dois não é
 * detectada em runtime. Hoje `lib/auth.ts` deriva os escopos de `MCP_SCOPES` e
 * tests/mcp-oauth-config.test.ts trava a lista do provider. Voltar a ler `auth` se o
 * provider passar a ter escopos que não vêm de `MCP_SCOPES`.
 *
 * ponytail: `dpop_signing_alg_values_supported` publica o default do pacote em vez
 * de ler o provider (tests/mcp-oauth-config.test.ts trava `dpop` sem customização).
 * Se `lib/auth.ts` passar a configurar `dpop.signingAlgorithms`, voltar a passar
 * `auth` a `oauthProviderResourceClient` e remover `externalScopes` da rota: com
 * `auth` e `externalScopes` juntos o pacote lança `BetterAuthError` ("external scopes
 * should not be provided with one authorization server").
 */
function createMcpOAuthResourceClient() {
  return createAuthClient({
    plugins: [oauthProviderResourceClient()],
  });
}

let resourceClient: ReturnType<typeof createMcpOAuthResourceClient> | undefined;

/** MCP metadata: cria o resource client somente quando a rota recebe request. */
export function getMcpOAuthResourceClient() {
  return (resourceClient ??= createMcpOAuthResourceClient());
}
