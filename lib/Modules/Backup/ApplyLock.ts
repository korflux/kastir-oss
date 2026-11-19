import type { PrismaClient } from "@/app/generated/prisma/client";

import { BACKUP_APPLY_LOCK_NAME } from "@/lib/Modules/Backup/constants";

type TxLike = {
  $executeRaw: PrismaClient["$executeRaw"];
};

/**
 * Take a transaction-scoped advisory lock so concurrent import/restore
 * cannot interleave wipe/insert. Must run inside an open Prisma transaction.
 */
export async function acquireBackupApplyLock(tx: TxLike): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BACKUP_APPLY_LOCK_NAME}))`;
}
