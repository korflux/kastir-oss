import { prisma } from "@/lib/prisma";
import { LOG_ENTRY_PURGE_BATCH_SIZE } from "@/lib/Modules/Logs/Retention";

type LogEntryPurgeDatabase = {
  logEntry: {
    findMany(args: {
      where: { createdAt: { lt: Date } };
      orderBy: { createdAt: "asc" };
      take: number;
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
};

/** Batched, cutoff-bounded delete — mirrors expireTrashedPages' loop shape. */
export async function purgeLogEntriesOlderThan(
  cutoff: Date,
  options: { batchSize?: number; database?: LogEntryPurgeDatabase } = {},
): Promise<number> {
  const database =
    options.database ?? (prisma as unknown as LogEntryPurgeDatabase);
  const batchSize = options.batchSize ?? LOG_ENTRY_PURGE_BATCH_SIZE;

  let deleted = 0;
  for (;;) {
    const entries = await database.logEntry.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
      take: batchSize,
      select: { id: true },
    });
    if (entries.length === 0) break;

    const result = await database.logEntry.deleteMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
    });
    deleted += result.count;

    if (entries.length < batchSize) break;
  }

  return deleted;
}
