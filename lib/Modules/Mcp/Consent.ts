import { prisma } from "@/lib/prisma";

export type McpOAuthClientPublic = {
  clientId: string;
  name: string | null;
  uri: string | null;
  icon: string | null;
  verified: boolean;
};

/**
 * Identidade confiável só quando o servidor marcou skipConsent.
 * DCR (RFC 7591) recusa skip_consent — cliente anônimo nunca passa daqui.
 */
export function isMcpOAuthClientVerified(client: {
  skipConsent?: boolean | null;
}): boolean {
  return client.skipConsent === true;
}

export async function getMcpOAuthClientPublic(
  clientId: string,
): Promise<McpOAuthClientPublic | null> {
  const client = await prisma.oauthClient.findUnique({
    where: { clientId },
    select: {
      clientId: true,
      name: true,
      uri: true,
      icon: true,
      skipConsent: true,
    },
  });

  if (!client) return null;

  return {
    clientId: client.clientId,
    name: client.name,
    uri: client.uri,
    icon: client.icon,
    verified: isMcpOAuthClientVerified(client),
  };
}
