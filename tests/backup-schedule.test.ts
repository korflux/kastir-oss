import { describe, expect, it } from "vitest";

import { nextBackupRunAt } from "@/lib/Modules/Backup/Schedule";

describe("nextBackupRunAt", () => {
  it("returns today's occurrence when the scheduled time is still ahead", () => {
    // 2026-03-15 10:00 UTC = 07:00 America/Sao_Paulo (UTC-3)
    const now = new Date("2026-03-15T10:00:00.000Z");
    const next = nextBackupRunAt(now, {
      intervalDays: 1,
      hour: 14,
      minute: 30,
      timezone: "America/Sao_Paulo",
    });
    // 14:30 SP = 17:30 UTC no mesmo dia
    expect(next.toISOString()).toBe("2026-03-15T17:30:00.000Z");
  });

  it("returns tomorrow when today's scheduled time already passed (interval 1)", () => {
    // 2026-03-15 20:00 UTC = 17:00 SP — horário 14:30 já passou
    const now = new Date("2026-03-15T20:00:00.000Z");
    const next = nextBackupRunAt(now, {
      intervalDays: 1,
      hour: 14,
      minute: 30,
      timezone: "America/Sao_Paulo",
    });
    expect(next.toISOString()).toBe("2026-03-16T17:30:00.000Z");
  });

  it("advances by intervalDays when today's time already passed", () => {
    const now = new Date("2026-03-15T20:00:00.000Z");
    const next = nextBackupRunAt(now, {
      intervalDays: 7,
      hour: 14,
      minute: 30,
      timezone: "America/Sao_Paulo",
    });
    // +7 dias a partir de 15 → 22 de março 14:30 SP
    expect(next.toISOString()).toBe("2026-03-22T17:30:00.000Z");
  });

  it("works in UTC without offset surprises", () => {
    const now = new Date("2026-06-01T08:00:00.000Z");
    const next = nextBackupRunAt(now, {
      intervalDays: 1,
      hour: 9,
      minute: 0,
      timezone: "UTC",
    });
    expect(next.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });

  it("handles day rollover caused by a positive UTC offset (Tokyo)", () => {
    // 2026-01-10 16:00 UTC = 2026-01-11 01:00 Asia/Tokyo (UTC+9)
    const now = new Date("2026-01-10T16:00:00.000Z");
    // Horário 02:00 Tokyo ainda à frente no dia 11 local
    const next = nextBackupRunAt(now, {
      intervalDays: 1,
      hour: 2,
      minute: 0,
      timezone: "Asia/Tokyo",
    });
    // 02:00 Tokyo em 11/jan = 2026-01-10 17:00 UTC
    expect(next.toISOString()).toBe("2026-01-10T17:00:00.000Z");
  });

  it("accepts the UTC±N shorthand Settings allows (Schema.ts timezoneSchema)", () => {
    // 2026-03-15 10:00 UTC = 07:00 UTC-3 — mesmo caso do teste IANA acima,
    // só que com o atalho que quebrava Intl.DateTimeFormat sem normalização.
    const now = new Date("2026-03-15T10:00:00.000Z");
    const next = nextBackupRunAt(now, {
      intervalDays: 1,
      hour: 14,
      minute: 30,
      timezone: "UTC-3",
    });
    expect(next.toISOString()).toBe("2026-03-15T17:30:00.000Z");
  });

  it("clamps invalid hour/minute and treats intervalDays < 1 as 1", () => {
    const now = new Date("2026-03-15T10:00:00.000Z");
    const next = nextBackupRunAt(now, {
      intervalDays: 0,
      hour: 99,
      minute: -5,
      timezone: "UTC",
    });
    // hour→23, minute→0, interval→1; 10:00 UTC, 23:00 ainda à frente
    expect(next.toISOString()).toBe("2026-03-15T23:00:00.000Z");
  });
});
