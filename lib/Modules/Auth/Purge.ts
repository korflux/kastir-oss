import { prisma } from "@/lib/prisma";
import {
  SESSION_EXPIRED_PURGE_BATCH_SIZE,
  VERIFICATION_EXPIRED_PURGE_BATCH_SIZE,
} from "@/lib/Modules/Auth/Retention";

type ExpiredRowsTable = {
  findMany(args: {
    where: { expiresAt: { lt: Date } };
    orderBy: { expiresAt: "asc" };
    take: number;
    select: { id: true };
  }): Promise<Array<{ id: string }>>;
  deleteMany(args: {
    where: { id: { in: string[] } };
  }): Promise<{ count: number }>;
};

/** Shared batched, cutoff-bounded delete loop for any expiresAt-keyed table. */
async function purgeExpiredRows(
  table: ExpiredRowsTable,
  now: Date,
  batchSize: number,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const rows = await table.findMany({
      where: { expiresAt: { lt: now } },
      orderBy: { expiresAt: "asc" },
      take: batchSize,
      select: { id: true },
    });
    if (rows.length === 0) break;

    const result = await table.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    deleted += result.count;

    if (rows.length < batchSize) break;
  }

  return deleted;
}

export async function purgeExpiredSessions(
  now = new Date(),
  options: {
    batchSize?: number;
    database?: { session: ExpiredRowsTable };
  } = {},
): Promise<number> {
  const database =
    options.database ?? (prisma as unknown as { session: ExpiredRowsTable });
  return purgeExpiredRows(
    database.session,
    now,
    options.batchSize ?? SESSION_EXPIRED_PURGE_BATCH_SIZE,
  );
}

export async function purgeExpiredVerifications(
  now = new Date(),
  options: {
    batchSize?: number;
    database?: { verification: ExpiredRowsTable };
  } = {},
): Promise<number> {
  const database =
    options.database ??
    (prisma as unknown as { verification: ExpiredRowsTable });
  return purgeExpiredRows(
    database.verification,
    now,
    options.batchSize ?? VERIFICATION_EXPIRED_PURGE_BATCH_SIZE,
  );
}
