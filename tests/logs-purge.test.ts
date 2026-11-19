import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { purgeLogEntriesOlderThan } from "@/lib/Modules/Logs/Purge";

function createFakeDb(entries: Array<{ id: string; createdAt: Date }>) {
  const store = [...entries];

  const db = {
    logEntry: {
      findMany: async ({
        where,
        take,
      }: {
        where: { createdAt: { lt: Date } };
        take: number;
      }) =>
        store
          .filter((entry) => entry.createdAt < where.createdAt.lt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, take)
          .map((entry) => ({ id: entry.id })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        const ids = new Set(where.id.in);
        const before = store.length;
        for (let i = store.length - 1; i >= 0; i -= 1) {
          if (ids.has(store[i].id)) store.splice(i, 1);
        }
        return { count: before - store.length };
      },
    },
  };

  return { db, remaining: store };
}

describe("purgeLogEntriesOlderThan", () => {
  it("deletes entries older than the cutoff and leaves recent ones", async () => {
    const cutoff = new Date("2026-01-01T00:00:00.000Z");
    const { db, remaining } = createFakeDb([
      { id: "e1", createdAt: new Date("2025-12-01T00:00:00.000Z") },
      { id: "e2", createdAt: new Date("2026-02-01T00:00:00.000Z") },
    ]);

    const deleted = await purgeLogEntriesOlderThan(cutoff, {
      database: db as never,
      batchSize: 10,
    });

    expect(deleted).toBe(1);
    expect(remaining.map((entry) => entry.id)).toEqual(["e2"]);
  });

  it("paginates across multiple batches", async () => {
    const cutoff = new Date("2026-01-01T00:00:00.000Z");
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)),
    }));
    const { db, remaining } = createFakeDb(entries);

    const deleted = await purgeLogEntriesOlderThan(cutoff, {
      database: db as never,
      batchSize: 2,
    });

    expect(deleted).toBe(5);
    expect(remaining).toHaveLength(0);
  });

  it("is a no-op when nothing is past the cutoff", async () => {
    const cutoff = new Date("2020-01-01T00:00:00.000Z");
    const { db, remaining } = createFakeDb([
      { id: "e1", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    ]);

    const deleted = await purgeLogEntriesOlderThan(cutoff, {
      database: db as never,
      batchSize: 10,
    });

    expect(deleted).toBe(0);
    expect(remaining).toHaveLength(1);
  });
});
