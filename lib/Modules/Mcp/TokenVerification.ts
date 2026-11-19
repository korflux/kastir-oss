import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import { getMcpResourceUrl } from "@/lib/Modules/Mcp/Scopes";
import { allowedMcpScopes } from "@/lib/Modules/Mcp/Policy";
import { McpAuthenticationError } from "@/lib/Modules/Mcp/Errors";
import { introspectMcpAccessToken } from "@/lib/Modules/Mcp/TokenIntrospection";
import type { McpToolContext } from "@/lib/Modules/Mcp/Types";

export function getMcpBearerToken(authorization: string | null): string {
  const parts = authorization?.trim().split(" ").filter(Boolean);

  if (
    !parts ||
    parts.length !== 2 ||
    parts[0].toLowerCase() !== "bearer" ||
    !parts[1]
  ) {
    throw new McpAuthenticationError();
  }

  return parts[1];
}

function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");

  const isSafeRequestId =
    supplied &&
    supplied.length <= 128 &&
    [...supplied].every((character) => {
      const code = character.charCodeAt(0);
      return code > 32 && code < 127;
    });

  if (isSafeRequestId) {
    return supplied;
  }

  return randomUUID();
}

function getClaimString(
  claims: Record<string, unknown>,
  key: string,
): string | null {
  const value = claims[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseRequestedScopes(claims: Record<string, unknown>): string[] {
  const scope = claims.scope;

  if (typeof scope !== "string") {
    return [];
  }

  return scope.trim().split(" ").filter(Boolean);
}

export async function authenticateMcpRequest(
  request: Request,
): Promise<McpToolContext> {
  const token = getMcpBearerToken(request.headers.get("authorization"));
  const resource = getMcpResourceUrl(env.BETTER_AUTH_URL);

  let claims: Record<string, unknown>;
  try {
    claims = await introspectMcpAccessToken(token);
  } catch {
    throw new McpAuthenticationError();
  }

  const userId = getClaimString(claims, "sub");
  const tokenClientId =
    getClaimString(claims, "client_id") ?? getClaimString(claims, "azp");

  if (!userId || !tokenClientId) {
    throw new McpAuthenticationError();
  }

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isMaster: true,
      },
    });
  } catch {
    throw new McpAuthenticationError();
  }

  if (!user) {
    throw new McpAuthenticationError();
  }

  let role;
  try {
    role = toEffectiveRole(user);
  } catch {
    throw new McpAuthenticationError();
  }

  return {
    actor: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    userId: user.id,
    role,
    scopes: allowedMcpScopes(role, parseRequestedScopes(claims)),
    clientId: tokenClientId,
    resource,
    requestId: getRequestId(request),
  };
}
