import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { getMcpOAuthClientPublic } from "@/lib/Modules/Mcp/Consent";
import {
  getMcpConsentPath,
  getMcpOAuthRequest,
  type OAuthSearchParams,
} from "@/lib/Modules/Mcp/OAuthQuery";
import { allowedMcpScopes } from "@/lib/Modules/Mcp/Policy";
import { getMcpResourceUrl } from "@/lib/Modules/Mcp/Scopes";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import { ConsentScreen } from "@/lib/Modules/Mcp/Components/ConsentScreen";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<OAuthSearchParams>;
}) {
  const params = await searchParams;
  const oauthQuery = getMcpConsentPath(params);
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);

  if (!oauthQuery) {
    return (
      <main className="bg-canvas flex min-h-screen items-center justify-center px-6 py-16">
        <p className="text-destructive text-sm">
          {dictionary.mcpConsent.invalidRequest}
        </p>
      </main>
    );
  }

  // Auth do consentimento: só consulta sessão depois que existe request real.
  await connection();
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/admin/login?next=" + encodeURIComponent(oauthQuery));
  }

  let role;
  try {
    role = toEffectiveRole(session.user);
  } catch {
    return (
      <main className="bg-canvas flex min-h-screen items-center justify-center px-6 py-16">
        <p className="text-destructive text-sm">
          {dictionary.mcpConsent.invalidRole}
        </p>
      </main>
    );
  }

  const query = oauthQuery.slice("/admin/mcp/consent?".length);
  const request = getMcpOAuthRequest(query);
  const client = await getMcpOAuthClientPublic(request.clientId);
  const grantedScopes = allowedMcpScopes(role, request.requestedScopes);
  const verified = client?.verified === true;

  return (
    <ConsentScreen
      client={{
        clientId: request.clientId,
        name: client?.name ?? client?.uri ?? request.clientId,
        icon: verified ? (client?.icon ?? null) : null,
        verified,
      }}
      dictionary={dictionary.mcpConsent}
      grantedScopes={grantedScopes}
      oauthQuery={query}
      redirectUri={request.redirectUri}
      requestedScopes={request.requestedScopes}
      resource={request.resource ?? getMcpResourceUrl(env.BETTER_AUTH_URL)}
      role={role}
    />
  );
}
