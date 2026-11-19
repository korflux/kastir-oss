import { createHash } from "node:crypto";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { McpAuthenticationError } from "@/lib/Modules/Mcp/Errors";
import { getMcpIssuerUrl, getMcpResourceUrl } from "@/lib/Modules/Mcp/Scopes";

type McpAccessTokenClaims = {
  active: true;
  iss: string;
  aud: string;
  client_id: string;
  sub: string;
  sid?: string;
  exp: number;
  iat: number;
  scope: string;
};

function hashStoredAccessToken(token: string): string {
  // Keep this aligned with Better Auth's default `storeTokens: "hashed"`.
  return createHash("sha256").update(token).digest("base64url");
}

function hasAllScopes(
  grantedScopes: string[],
  consentedScopes: string[],
): boolean {
  const consented = new Set(consentedScopes);
  return grantedScopes.every((scope) => consented.has(scope));
}

/**
 * Introspects the opaque token issued by the local Better Auth provider.
 *
 * Better Auth's generic introspection endpoint restricts a caller to tokens
 * issued to that same OAuth client. MCP clients are dynamic, so the resource
 * server validates the provider-owned token record directly instead.
 */
export async function introspectMcpAccessToken(
  token: string,
): Promise<McpAccessTokenClaims> {
  const accessToken = await prisma.oauthAccessToken.findUnique({
    where: { token: hashStoredAccessToken(token) },
    select: {
      clientId: true,
      sessionId: true,
      userId: true,
      expiresAt: true,
      createdAt: true,
      revoked: true,
      scopes: true,
      oauthclient: { select: { disabled: true } },
    },
  });

  if (
    !accessToken ||
    !accessToken.userId ||
    accessToken.revoked != null ||
    accessToken.expiresAt <= new Date() ||
    accessToken.oauthclient?.disabled
  ) {
    throw new McpAuthenticationError();
  }

  const consent = await prisma.oauthConsent.findFirst({
    where: {
      clientId: accessToken.clientId,
      userId: accessToken.userId,
    },
    orderBy: { updatedAt: "desc" },
    select: { scopes: true },
  });

  if (!consent || !hasAllScopes(accessToken.scopes, consent.scopes)) {
    throw new McpAuthenticationError();
  }

  return {
    active: true,
    iss: getMcpIssuerUrl(env.BETTER_AUTH_URL),
    aud: getMcpResourceUrl(env.BETTER_AUTH_URL),
    client_id: accessToken.clientId,
    sub: accessToken.userId,
    ...(accessToken.sessionId ? { sid: accessToken.sessionId } : {}),
    exp: Math.floor(accessToken.expiresAt.getTime() / 1_000),
    iat: Math.floor(accessToken.createdAt.getTime() / 1_000),
    scope: accessToken.scopes.join(" "),
  };
}
