/**
 * Scope 3 — backfill manual: filhos diretos de Base viram raízes.
 *
 * Uso (dev/.env):
 *   pnpm exec tsx scripts/promote-base-child-folders.ts
 *
 * Idempotente. Não roda no boot.
 */

import "dotenv/config";

import { prisma } from "../lib/prisma";
import { promoteBaseChildFolders } from "../lib/Modules/Shared/promoteBaseChildFolders";

async function main() {
  const pages = await promoteBaseChildFolders({
    findMany: () =>
      prisma.pageFolder.findMany({
        select: { id: true, parentId: true, isBase: true },
      }),
    updateMany: (args) => prisma.pageFolder.updateMany(args),
  });

  const media = await promoteBaseChildFolders({
    findMany: () =>
      prisma.mediaFolder.findMany({
        select: { id: true, parentId: true, isBase: true },
      }),
    updateMany: (args) => prisma.mediaFolder.updateMany(args),
  });

  console.log(
    JSON.stringify(
      {
        pages,
        media,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
