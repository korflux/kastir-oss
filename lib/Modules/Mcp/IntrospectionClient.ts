import { createHmac } from "node:crypto";

import { symmetricEncrypt } from "better-auth/crypto";

import { env } from "@/lib/env";

export const DEFAULT_MCP_INTROSPECTION_CLIENT_ID = "kastir-mcp-resource-server";

const DERIVED_SECRET_CONTEXT = "kastir:mcp:introspection-client:v1";

export type McpIntrospectionCredentials = {
  clientId: string;
  clientSecret: string;
};

export function getMcpIntrospectionCredentials(): McpIntrospectionCredentials {
  const clientId =
    env.MCP_INTROSPECTION_CLIENT_ID ?? DEFAULT_MCP_INTROSPECTION_CLIENT_ID;
  const clientSecret =
    env.MCP_INTROSPECTION_CLIENT_SECRET ??
    createHmac("sha256", env.NEXTAUTH_SECRET)
      .update(DERIVED_SECRET_CONTEXT)
      .digest("base64url");

  return { clientId, clientSecret };
}

/** Matches Better Auth's encrypted OAuth client-secret storage. */
export function encryptMcpIntrospectionSecret(secret: string): Promise<string> {
  return symmetricEncrypt({ key: env.NEXTAUTH_SECRET, data: secret });
}
