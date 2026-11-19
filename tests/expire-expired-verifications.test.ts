import { describe, expect, it, vi } from "vitest";

const { purgeExpiredVerifications } = vi.hoisted(() => ({
  purgeExpiredVerifications: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/Modules/Auth/Purge", () => ({ purgeExpiredVerifications }));

import {
  expireExpiredVerifications,
  processExpireExpiredVerificationsJob,
} from "@/lib/Jobs/expireExpiredVerifications";

describe("expired verifications job", () => {
  it("delegates to purgeExpiredVerifications with an injectable clock", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    await expect(expireExpiredVerifications(now)).resolves.toBe(1);
    expect(purgeExpiredVerifications).toHaveBeenCalledWith(now);
  });

  it("is dispatchable as a BullMQ job", async () => {
    await processExpireExpiredVerificationsJob({} as never);
    expect(purgeExpiredVerifications).toHaveBeenCalled();
  });
});
