import { prisma } from "@/lib/prisma";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import {
  McpAuthorizationError,
  McpConnectionNotFoundError,
} from "@/lib/Modules/Mcp/Errors";

export type McpConnection = {
  id: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    role: EffectiveRole;
  };
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  lastTokenIssuedAt: string | null;
  active: boolean;
};

type ConnectionUser = {
  id: string;
  name: string;
  email: string;
  role: unknown;
  isMaster: boolean;
};

function isAdministrator(role: EffectiveRole): boolean {
  return role === "MASTER" || role === "ADMIN";
}

function toRole(user: ConnectionUser): EffectiveRole {
  if (user.isMaster) return "MASTER";
  if (user.role === "ADMIN" || user.role === "EDITOR") return user.role;
  throw new Error("Invalid panel role");
}

export async function listMcpConnections(
  viewerId: string,
  viewerRole: EffectiveRole,
): Promise<McpConnection[]> {
  const where = isAdministrator(viewerRole) ? {} : { userId: viewerId };
  const consents = await prisma.oauthConsent.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      clientId: true,
      userId: true,
      scopes: true,
      createdAt: true,
      updatedAt: true,
      oauthclient: {
        select: {
          name: true,
          uri: true,
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isMaster: true,
        },
      },
    },
  });

  const userIds = consents.flatMap((consent) =>
    consent.userId ? [consent.userId] : [],
  );
  const clientIds = consents.map((consent) => consent.clientId);
  const [accessTokens, refreshTokens] = await prisma.$transaction([
    prisma.oauthAccessToken.findMany({
      where: {
        clientId: { in: clientIds },
        userId: { in: userIds },
      },
      select: {
        clientId: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
    prisma.oauthRefreshToken.findMany({
      where: {
        clientId: { in: clientIds },
        userId: { in: userIds },
      },
      select: {
        clientId: true,
        userId: true,
        expiresAt: true,
        revoked: true,
      },
    }),
  ]);
  const now = Date.now();

  return consents.flatMap((consent) => {
    if (!consent.user || !consent.userId) return [];

    const user = consent.user;
    const role = toRole(user);
    const access = accessTokens.filter(
      (token) =>
        token.clientId === consent.clientId && token.userId === consent.userId,
    );
    const refresh = refreshTokens.filter(
      (token) =>
        token.clientId === consent.clientId && token.userId === consent.userId,
    );
    const latestAccess = [...access].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    )[0];
    const active =
      access.some((token) => token.expiresAt.getTime() > now) ||
      refresh.some(
        (token) => !token.revoked && token.expiresAt.getTime() > now,
      );

    return [
      {
        id: consent.id,
        clientId: consent.clientId,
        clientName: consent.oauthclient?.name ?? consent.clientId,
        clientUri: consent.oauthclient?.uri ?? null,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role,
        },
        scopes: consent.scopes,
        createdAt: consent.createdAt.toISOString(),
        updatedAt: consent.updatedAt.toISOString(),
        lastTokenIssuedAt: latestAccess?.createdAt.toISOString() ?? null,
        active,
      },
    ];
  });
}

export async function revokeMcpConnection(
  connectionId: string,
  viewerId: string,
  viewerRole: EffectiveRole,
): Promise<void> {
  const consent = await prisma.oauthConsent.findUnique({
    where: { id: connectionId },
    select: { id: true, clientId: true, userId: true },
  });

  if (!consent || !consent.userId) {
    throw new McpConnectionNotFoundError();
  }

  if (consent.userId !== viewerId && !isAdministrator(viewerRole)) {
    throw new McpAuthorizationError();
  }

  await prisma.$transaction([
    prisma.oauthAccessToken.deleteMany({
      where: {
        clientId: consent.clientId,
        userId: consent.userId,
      },
    }),
    prisma.oauthRefreshToken.deleteMany({
      where: {
        clientId: consent.clientId,
        userId: consent.userId,
      },
    }),
    prisma.oauthConsent.delete({
      where: { id: consent.id },
    }),
  ]);
}
