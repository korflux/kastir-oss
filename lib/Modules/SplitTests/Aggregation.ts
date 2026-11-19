import { prisma } from "@/lib/prisma";
import { SPLIT_EVENT_PURGE_BATCH_SIZE } from "@/lib/Modules/SplitTests/constants";

type RawEvent = {
  id: string;
  campaignId: string;
  destinationId: string;
  createdAt: Date;
};

type AggregationDatabase = {
  splitRedirectEvent: {
    findMany(args: {
      where: { createdAt: { lt: Date } };
      orderBy: { createdAt: "asc" };
      take: number;
    }): Promise<RawEvent[]>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
  splitRedirectDailyStat: {
    upsert(args: {
      where: { destinationId_day: { destinationId: string; day: Date } };
      create: {
        campaignId: string;
        destinationId: string;
        day: Date;
        hits: number;
      };
      update: { hits: { increment: number } };
    }): Promise<unknown>;
    findMany(args: {
      where: DailyStatWhere;
      orderBy: Array<{ day: "asc" } | { destinationId: "asc" }>;
      skip: number;
      take: number;
    }): Promise<DailyStatRow[]>;
    count(args: { where: DailyStatWhere }): Promise<number>;
  };
  $transaction<T>(fn: (tx: AggregationDatabase) => Promise<T>): Promise<T>;
};

type DailyStatWhere = {
  campaignId: string;
  destinationId?: string;
  day: { gte: Date; lte: Date };
};

type DailyStatRow = {
  campaignId: string;
  destinationId: string;
  day: Date;
  hits: number;
};

export type ListDailyStatsFilters = {
  campaignId: string;
  destinationId?: string;
  /** Inclusive UTC calendar day; time-of-day is ignored (truncated to day). */
  from: Date;
  /** Inclusive UTC calendar day; time-of-day is ignored (truncated to day). */
  to: Date;
  page?: number;
  pageSize?: number;
};

export type DailyStatItem = {
  day: Date;
  destinationId: string;
  hits: number;
};

export type ListDailyStatsResult = {
  items: DailyStatItem[];
  total: number;
  page: number;
  pageSize: number;
};

/** Truncates to a UTC calendar day — the rollup bucket key. */
function dayBucket(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Rolls raw SplitRedirectEvent rows older than `cutoff` into
 * SplitRedirectDailyStat (one row per destination/day), then purges the raw
 * rows just rolled up. Batched and idempotent: re-running over already
 * rolled-up (and since-deleted) events is a no-op. The upsert + delete for
 * each batch run inside a single transaction — if the delete fails (or the
 * job dies mid-batch), the upsert is rolled back too, so a BullMQ retry
 * re-processes the same batch cleanly instead of double-counting hits.
 */
export async function rollupEventsOlderThan(
  cutoff: Date,
  options: { batchSize?: number; database?: AggregationDatabase } = {},
): Promise<{ rolledUp: number; purged: number }> {
  const database =
    options.database ?? (prisma as unknown as AggregationDatabase);
  const batchSize = options.batchSize ?? SPLIT_EVENT_PURGE_BATCH_SIZE;

  let rolledUp = 0;
  let purged = 0;

  for (;;) {
    const events = await database.splitRedirectEvent.findMany({
      where: { createdAt: { lt: cutoff } },
      orderBy: { createdAt: "asc" },
      take: batchSize,
    });
    if (events.length === 0) break;

    const buckets = new Map<
      string,
      { campaignId: string; destinationId: string; day: Date; hits: number }
    >();
    for (const event of events) {
      const day = dayBucket(event.createdAt);
      const key = `${event.destinationId}:${day.toISOString()}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.hits += 1;
      } else {
        buckets.set(key, {
          campaignId: event.campaignId,
          destinationId: event.destinationId,
          day,
          hits: 1,
        });
      }
    }

    const { rolledUp: batchRolledUp, purged: batchPurged } =
      await database.$transaction(async (tx) => {
        let txRolledUp = 0;
        for (const bucket of buckets.values()) {
          await tx.splitRedirectDailyStat.upsert({
            where: {
              destinationId_day: {
                destinationId: bucket.destinationId,
                day: bucket.day,
              },
            },
            create: {
              campaignId: bucket.campaignId,
              destinationId: bucket.destinationId,
              day: bucket.day,
              hits: bucket.hits,
            },
            update: { hits: { increment: bucket.hits } },
          });
          txRolledUp += bucket.hits;
        }

        const result = await tx.splitRedirectEvent.deleteMany({
          where: { id: { in: events.map((event) => event.id) } },
        });

        return { rolledUp: txRolledUp, purged: result.count };
      });

    rolledUp += batchRolledUp;
    purged += batchPurged;

    if (events.length < batchSize) break;
  }

  return { rolledUp, purged };
}

const DAILY_STATS_MAX_PAGE_SIZE = 100;
const DAILY_STATS_DEFAULT_PAGE_SIZE = 20;

/**
 * Reads the SplitRedirectDailyStat rollup for a campaign over an inclusive
 * UTC day range — one row per destination/day. Only rolled-up days are
 * visible here; events not yet processed by rollupEventsOlderThan (still in
 * SplitRedirectEvent) intentionally do not appear, since this is a read over
 * the rollup table, not the raw event log.
 */
export async function listDailyStats(
  filters: ListDailyStatsFilters,
  options: { database?: AggregationDatabase } = {},
): Promise<ListDailyStatsResult> {
  const database =
    options.database ?? (prisma as unknown as AggregationDatabase);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(
    DAILY_STATS_MAX_PAGE_SIZE,
    Math.max(1, filters.pageSize ?? DAILY_STATS_DEFAULT_PAGE_SIZE),
  );

  const where: DailyStatWhere = {
    campaignId: filters.campaignId,
    ...(filters.destinationId ? { destinationId: filters.destinationId } : {}),
    day: { gte: dayBucket(filters.from), lte: dayBucket(filters.to) },
  };

  const [rows, total] = await Promise.all([
    database.splitRedirectDailyStat.findMany({
      where,
      orderBy: [{ day: "asc" }, { destinationId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    database.splitRedirectDailyStat.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      day: row.day,
      destinationId: row.destinationId,
      hits: row.hits,
    })),
    total,
    page,
    pageSize,
  };
}
