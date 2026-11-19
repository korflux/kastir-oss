import { randomUUID } from "node:crypto";

import { PrismaClient } from "@/app/generated/prisma/client";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/Modules/Auth/Password";
import {
  encryptMcpIntrospectionSecret,
  getMcpIntrospectionCredentials,
} from "@/lib/Modules/Mcp/IntrospectionClient";
import { prisma } from "@/lib/prisma";

export type BootstrapDatabase = Pick<PrismaClient, "$transaction">;

const bootstrapLockName = "kastir:master-bootstrap";
const credentialProvider = "credential";
const credentialIssuer = "local:credential";
const mcpIntrospectionClientName = "Kastir MCP resource server";

function masterNameFromEmail(email: string): string {
  return email.split("@", 1)[0] ?? email;
}

export async function bootstrapMaster(
  database: BootstrapDatabase = prisma,
): Promise<void> {
  await database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${bootstrapLockName}))`;

    const { clientId, clientSecret } = getMcpIntrospectionCredentials();
    const introspectionClient = await tx.oauthClient.findUnique({
      where: { clientId },
    });

    if (!introspectionClient) {
      const now = new Date();
      await tx.oauthClient.create({
        data: {
          id: randomUUID(),
          clientId,
          clientSecret: await encryptMcpIntrospectionSecret(clientSecret),
          name: mcpIntrospectionClientName,
          tokenEndpointAuthMethod: "client_secret_post",
          applicationType: "web",
          disabled: false,
          createdAt: now,
          updatedAt: now,
        },
      });
    } else {
      await tx.oauthClient.update({
        where: { clientId },
        data: {
          clientSecret: await encryptMcpIntrospectionSecret(clientSecret),
          applicationType: "web",
          disabled: false,
          updatedAt: new Date(),
        },
      });
    }

    let master = await tx.user.findFirst({
      where: { isMaster: true },
    });

    if (!master) {
      const password = await hashPassword(env.MASTER_PASSWORD);
      master = await tx.user.create({
        data: {
          id: randomUUID(),
          name: masterNameFromEmail(env.MASTER_EMAIL),
          email: env.MASTER_EMAIL,
          emailVerified: false,
          role: "ADMIN",
          isMaster: true,
        },
      });

      await tx.account.create({
        data: {
          id: randomUUID(),
          issuer: credentialIssuer,
          accountId: master.id,
          providerId: credentialProvider,
          userId: master.id,
          password,
        },
      });
    } else {
      const account = await tx.account.findUnique({
        where: {
          issuer_accountId: {
            issuer: credentialIssuer,
            accountId: master.id,
          },
        },
      });

      if (!account) {
        await tx.account.create({
          data: {
            id: randomUUID(),
            issuer: credentialIssuer,
            accountId: master.id,
            providerId: credentialProvider,
            userId: master.id,
            password: await hashPassword(env.MASTER_PASSWORD),
          },
        });
      } else if (env.MASTER_FORCE_RESET) {
        await tx.user.update({
          where: { id: master.id },
          data: { email: env.MASTER_EMAIL },
        });
        await tx.account.update({
          where: { id: account.id },
          data: { password: await hashPassword(env.MASTER_PASSWORD) },
        });
      }
    }

    if (env.MASTER_FORCE_RESET) {
      // Private JWT keys are encrypted with NEXTAUTH_SECRET. A forced reset
      // rotates them so a reset environment cannot retain undecryptable keys.
      await tx.jwks.deleteMany();
    }

    const settings = await tx.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    if (!settings) {
      await tx.siteSettings.create({
        data: {
          id: "singleton",
          // O formulário exige título não vazio; o bootstrap deve criar um
          // registro que possa ser salvo novamente sem normalização especial.
          siteTitle: env.SITE_TITLE?.trim() || "Kastir",
        },
      });
    }

    const baseFolder = await tx.pageFolder.findFirst({
      where: { isBase: true },
    });

    if (!baseFolder) {
      await tx.pageFolder.create({
        data: {
          name: "Base",
          parentId: null,
          color: null,
          isBase: true,
        },
      });
    }

    const mediaBaseFolder = await tx.mediaFolder.findFirst({
      where: { isBase: true },
    });

    if (!mediaBaseFolder) {
      await tx.mediaFolder.create({
        data: {
          name: "Base",
          parentId: null,
          color: null,
          isBase: true,
        },
      });
    }
  });
}
