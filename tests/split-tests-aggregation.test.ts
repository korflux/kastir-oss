import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  listDailyStats,
  rollupEventsOlderThan,
} from "@/lib/Modules/SplitTests/Aggregation";

type Event = {
  id: string;
  campaignId: string;
  destinationId: string;
  createdAt: Date;
};

type DailyStat = {
  campaignId: string;
  destinationId: string;
  day: Date;
  hits: number;
};

type FakeDb = {
  splitRedirectEvent: {
    findMany(args: {
      where: { createdAt: { lt: Date } };
      take: number;
    }): Promise<Event[]>;
    deleteMany(args: {
      where: { id: { in: string[] } };
    }): Promise<{ count: number }>;
  };
  splitRedirectDailyStat: {
    upsert(args: {
      where: { destinationId_day: { destinationId: string; day: Date } };
      create: DailyStat;
      update: { hits: { increment: number } };
    }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T>;
};

function createFakeDb(events: Event[]) {
  const store = [...events];
  const stats: DailyStat[] = [];

  const db: FakeDb = {
    splitRedirectEvent: {
      findMany: async ({
        where,
        take,
      }: {
        where: { createdAt: { lt: Date } };
        take: number;
      }) =>
        store
          .filter((event) => event.createdAt < where.createdAt.lt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, take)
          .map((event) => ({ ...event })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const ids = new Set(where.id.in);
        const before = store.length;
        for (let i = store.length - 1; i >= 0; i -= 1) {
          if (ids.has(store[i].id)) store.splice(i, 1);
        }
        return { count: before - store.length };
      },
    },
    splitRedirectDailyStat: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { destinationId_day: { destinationId: string; day: Date } };
        create: DailyStat;
        update: { hits: { increment: number } };
      }) => {
        const existing = stats.find(
          (stat) =>
            stat.destinationId === where.destinationId_day.destinationId &&
            stat.day.getTime() === where.destinationId_day.day.getTime(),
        );
        if (existing) {
          existing.hits += update.hits.increment;
        } else {
          stats.push({ ...create });
        }
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => {
      const storeSnapshot = store.map((event) => ({ ...event }));
      const statsSnapshot = stats.map((stat) => ({ ...stat }));
      try {
        return await fn(db);
      } catch (error) {
        store.length = 0;
        store.push(...storeSnapshot);
        stats.length = 0;
        stats.push(...statsSnapshot);
        throw error;
      }
    },
  };

  return { db, remainingEvents: store, stats };
}

describe("rollupEventsOlderThan", () => {
  it("aggregates events into daily stats and purges the raw rows", async () => {
    const day1 = new Date("2026-01-01T10:00:00.000Z");
    const day2 = new Date("2026-01-02T10:00:00.000Z");
    const events: Event[] = [
      { id: "e1", campaignId: "c1", destinationId: "d1", createdAt: day1 },
      {
        id: "e2",
        campaignId: "c1",
        destinationId: "d1",
        createdAt: new Date(day1.getTime() + 1000),
      },
      { id: "e3", campaignId: "c1", destinationId: "d2", createdAt: day1 },
      { id: "e4", campaignId: "c1", destinationId: "d1", createdAt: day2 },
    ];
    const { db, remainingEvents, stats } = createFakeDb(events);

    const result = await rollupEventsOlderThan(
      new Date("2026-01-03T00:00:00.000Z"),
      {
        database: db as never,
        batchSize: 10,
      },
    );

    expect(result.purged).toBe(4);
    expect(result.rolledUp).toBe(4);
    expect(remainingEvents).toHaveLength(0);
    expect(stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destinationId: "d1",
          hits: 2,
          day: new Date("2026-01-01T00:00:00.000Z"),
        }),
        expect.objectContaining({
          destinationId: "d2",
          hits: 1,
          day: new Date("2026-01-01T00:00:00.000Z"),
        }),
        expect.objectContaining({
          destinationId: "d1",
          hits: 1,
          day: new Date("2026-01-02T00:00:00.000Z"),
        }),
      ]),
    );
  });

  it("does not touch events at or after the cutoff", async () => {
    const old = new Date("2026-01-01T00:00:00.000Z");
    const recent = new Date("2026-01-10T00:00:00.000Z");
    const events: Event[] = [
      { id: "e1", campaignId: "c1", destinationId: "d1", createdAt: old },
      { id: "e2", campaignId: "c1", destinationId: "d1", createdAt: recent },
    ];
    const { db, remainingEvents } = createFakeDb(events);

    await rollupEventsOlderThan(new Date("2026-01-05T00:00:00.000Z"), {
      database: db as never,
      batchSize: 10,
    });

    expect(remainingEvents.map((event) => event.id)).toEqual(["e2"]);
  });

  it("is idempotent — running twice does not double count", async () => {
    const day1 = new Date("2026-01-01T10:00:00.000Z");
    const events: Event[] = [
      { id: "e1", campaignId: "c1", destinationId: "d1", createdAt: day1 },
    ];
    const { db, stats } = createFakeDb(events);
    const cutoff = new Date("2026-01-03T00:00:00.000Z");

    await rollupEventsOlderThan(cutoff, {
      database: db as never,
      batchSize: 10,
    });
    await rollupEventsOlderThan(cutoff, {
      database: db as never,
      batchSize: 10,
    });

    expect(stats).toHaveLength(1);
    expect(stats[0].hits).toBe(1);
  });

  it("paginates across multiple batches", async () => {
    const events: Event[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      campaignId: "c1",
      destinationId: "d1",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    }));
    const { db, remainingEvents, stats } = createFakeDb(events);

    const result = await rollupEventsOlderThan(
      new Date("2026-01-02T00:00:00.000Z"),
      {
        database: db as never,
        batchSize: 2,
      },
    );

    expect(result.purged).toBe(5);
    expect(remainingEvents).toHaveLength(0);
    expect(stats).toEqual([
      expect.objectContaining({ destinationId: "d1", hits: 5 }),
    ]);
  });

  it("keeps a batch atomic — a failed delete after the upsert leaves nothing to double-count on retry", async () => {
    const day1 = new Date("2026-01-01T10:00:00.000Z");
    const events: Event[] = [
      { id: "e1", campaignId: "c1", destinationId: "d1", createdAt: day1 },
    ];
    const { db, remainingEvents, stats } = createFakeDb(events);
    db.splitRedirectEvent.deleteMany = async () => {
      throw new Error("simulated delete failure");
    };

    await expect(
      rollupEventsOlderThan(new Date("2026-01-03T00:00:00.000Z"), {
        database: db as never,
        batchSize: 10,
      }),
    ).rejects.toThrow("simulated delete failure");

    // Nothing committed: if the upsert had stuck around despite the delete
    // failing, a retry would re-process this same (still-present) event and
    // double the hit count.
    expect(stats).toHaveLength(0);
    expect(remainingEvents.map((event) => event.id)).toEqual(["e1"]);

    db.splitRedirectEvent.deleteMany = async ({
      where,
    }: {
      where: { id: { in: string[] } };
    }) => {
      const ids = new Set(where.id.in);
      const before = remainingEvents.length;
      for (let i = remainingEvents.length - 1; i >= 0; i -= 1) {
        if (ids.has(remainingEvents[i].id)) remainingEvents.splice(i, 1);
      }
      return { count: before - remainingEvents.length };
    };

    await rollupEventsOlderThan(new Date("2026-01-03T00:00:00.000Z"), {
      database: db as never,
      batchSize: 10,
    });

    expect(stats).toEqual([
      expect.objectContaining({ destinationId: "d1", hits: 1 }),
    ]);
  });
});

describe("listDailyStats", () => {
  type StatRow = DailyStat;

  function createFakeStatsDb(rows: StatRow[]) {
    type Where = {
      campaignId: string;
      destinationId?: string;
      day: { gte: Date; lte: Date };
    };
    const matches = (row: StatRow, where: Where) =>
      row.campaignId === where.campaignId &&
      (where.destinationId === undefined ||
        row.destinationId === where.destinationId) &&
      row.day.getTime() >= where.day.gte.getTime() &&
      row.day.getTime() <= where.day.lte.getTime();

    return {
      splitRedirectDailyStat: {
        findMany: async ({
          where,
          skip,
          take,
        }: {
          where: Where;
          skip: number;
          take: number;
        }) =>
          rows
            .filter((row) => matches(row, where))
            .sort(
              (a, b) =>
                a.day.getTime() - b.day.getTime() ||
                a.destinationId.localeCompare(b.destinationId),
            )
            .slice(skip, skip + take),
        count: async ({ where }: { where: Where }) =>
          rows.filter((row) => matches(row, where)).length,
      },
    };
  }

  const rows: StatRow[] = [
    {
      campaignId: "c1",
      destinationId: "d1",
      day: new Date("2026-01-01T00:00:00.000Z"),
      hits: 3,
    },
    {
      campaignId: "c1",
      destinationId: "d2",
      day: new Date("2026-01-01T00:00:00.000Z"),
      hits: 2,
    },
    {
      campaignId: "c1",
      destinationId: "d1",
      day: new Date("2026-01-02T00:00:00.000Z"),
      hits: 5,
    },
    {
      campaignId: "c1",
      destinationId: "d1",
      day: new Date("2026-01-05T00:00:00.000Z"),
      hits: 1,
    },
    {
      campaignId: "c2",
      destinationId: "d3",
      day: new Date("2026-01-01T00:00:00.000Z"),
      hits: 9,
    },
  ];

  it("returns an empty page when nothing matches the range", async () => {
    const db = createFakeStatsDb(rows);
    const result = await listDailyStats(
      {
        campaignId: "c1",
        from: new Date("2026-02-01T00:00:00.000Z"),
        to: new Date("2026-02-28T00:00:00.000Z"),
      },
      { database: db as never },
    );

    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it("is inclusive on both ends of the day range", async () => {
    const db = createFakeStatsDb(rows);
    const result = await listDailyStats(
      {
        campaignId: "c1",
        from: new Date("2026-01-01T12:00:00.000Z"),
        to: new Date("2026-01-02T00:00:00.000Z"),
      },
      { database: db as never },
    );

    expect(result.total).toBe(3);
    expect(result.items).toEqual([
      {
        day: new Date("2026-01-01T00:00:00.000Z"),
        destinationId: "d1",
        hits: 3,
      },
      {
        day: new Date("2026-01-01T00:00:00.000Z"),
        destinationId: "d2",
        hits: 2,
      },
      {
        day: new Date("2026-01-02T00:00:00.000Z"),
        destinationId: "d1",
        hits: 5,
      },
    ]);
  });

  it("filters by destinationId and never crosses campaigns", async () => {
    const db = createFakeStatsDb(rows);
    const result = await listDailyStats(
      {
        campaignId: "c1",
        destinationId: "d1",
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-01-31T00:00:00.000Z"),
      },
      { database: db as never },
    );

    expect(result.items.every((item) => item.destinationId === "d1")).toBe(
      true,
    );
    expect(result.total).toBe(3);
  });

  it("paginates the result", async () => {
    const db = createFakeStatsDb(rows);
    const result = await listDailyStats(
      {
        campaignId: "c1",
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-01-31T00:00:00.000Z"),
        page: 2,
        pageSize: 2,
      },
      { database: db as never },
    );

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBe(4);
    expect(result.items).toHaveLength(2);
  });
});
