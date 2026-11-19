import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/app/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Bump when schema gains fields/models that a long-lived dev singleton must
 * re-read after `prisma generate` (delegates alone aren't enough — e.g.
 * Snippet.deletedAt soft-delete still left the old client running).
 */
const PRISMA_SCHEMA_REV = 3;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaRev?: number;
};

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter });
}

/**
 * In dev, Next keeps a long-lived Prisma singleton across hot reloads.
 * Stale after `prisma generate` → missing delegates or unknown args (500).
 * Recreate when rev bumps or a required delegate is missing.
 */
function getPrismaClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (
    existing &&
    globalForPrisma.prismaRev === PRISMA_SCHEMA_REV &&
    typeof (existing as { snippet?: unknown }).snippet !== "undefined" &&
    typeof (existing as { mediaFile?: unknown }).mediaFile !== "undefined" &&
    typeof (existing as { notification?: unknown }).notification !==
      "undefined" &&
    typeof (existing as { siteSettings?: unknown }).siteSettings !==
      "undefined" &&
    typeof (existing as { pageRevision?: unknown }).pageRevision !==
      "undefined" &&
    typeof (existing as { snippetRevision?: unknown }).snippetRevision !==
      "undefined"
  ) {
    return existing;
  }

  // Descarta singleton velho (sem novos campos) pra não vazar conexão.
  if (existing && process.env.NODE_ENV !== "production") {
    void existing.$disconnect().catch(() => undefined);
  }

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
    globalForPrisma.prismaRev = PRISMA_SCHEMA_REV;
  }
  return client;
}

export const prisma = getPrismaClient();
