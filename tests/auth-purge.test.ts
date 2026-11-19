import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  purgeExpiredSessions,
  purgeExpiredVerifications,
} from "@/lib/Modules/Auth/Purge";

function createFakeTable(rows: Array<{ id: string; expiresAt: Date }>) {
  const store = [...rows];

  const table = {
    findMany: async ({
      where,
      take,
    }: {
      where: { expiresAt: { lt: Date } };
      take: number;
    }) =>
      store
        .filter((row) => row.expiresAt < where.expiresAt.lt)
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
        .slice(0, take)
        .map((row) => ({ id: row.id })),
    deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
      const ids = new Set(where.id.in);
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i -= 1) {
        if (ids.has(store[i].id)) store.splice(i, 1);
      }
      return { count: before - store.length };
    },
  };

  return { table, remaining: store };
}

describe("purgeExpiredSessions", () => {
  it("deletes expired sessions and leaves valid ones", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const { table, remaining } = createFakeTable([
      { id: "s1", expiresAt: new Date(now.getTime() - 1_000) },
      { id: "s2", expiresAt: new Date(now.getTime() + 1_000) },
    ]);

    const deleted = await purgeExpiredSessions(now, {
      database: { session: table } as never,
      batchSize: 10,
    });

    expect(deleted).toBe(1);
    expect(remaining.map((row) => row.id)).toEqual(["s2"]);
  });

  it("paginates across multiple batches", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      expiresAt: new Date(now.getTime() - 1_000 + i),
    }));
    const { table, remaining } = createFakeTable(rows);

    const deleted = await purgeExpiredSessions(now, {
      database: { session: table } as never,
      batchSize: 2,
    });

    expect(deleted).toBe(5);
    expect(remaining).toHaveLength(0);
  });
});

describe("purgeExpiredVerifications", () => {
  it("deletes expired verifications and leaves valid ones", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const { table, remaining } = createFakeTable([
      { id: "v1", expiresAt: new Date(now.getTime() - 1_000) },
      { id: "v2", expiresAt: new Date(now.getTime() + 1_000) },
    ]);

    const deleted = await purgeExpiredVerifications(now, {
      database: { verification: table } as never,
      batchSize: 10,
    });

    expect(deleted).toBe(1);
    expect(remaining.map((row) => row.id)).toEqual(["v2"]);
  });
});
