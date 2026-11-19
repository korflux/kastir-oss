import { describe, expect, it, vi } from "vitest";

const { purgeExpiredSessions } = vi.hoisted(() => ({
  purgeExpiredSessions: vi.fn().mockResolvedValue(2),
}));

vi.mock("@/lib/Modules/Auth/Purge", () => ({ purgeExpiredSessions }));

import {
  expireExpiredSessions,
  processExpireExpiredSessionsJob,
} from "@/lib/Jobs/expireExpiredSessions";

describe("expired sessions job", () => {
  it("delegates to purgeExpiredSessions with an injectable clock", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    await expect(expireExpiredSessions(now)).resolves.toBe(2);
    expect(purgeExpiredSessions).toHaveBeenCalledWith(now);
  });

  it("is dispatchable as a BullMQ job", async () => {
    await processExpireExpiredSessionsJob({} as never);
    expect(purgeExpiredSessions).toHaveBeenCalled();
  });
});
