import { describe, expect, it, vi } from "vitest";

const { purgeLogEntriesOlderThan } = vi.hoisted(() => ({
  purgeLogEntriesOlderThan: vi.fn().mockResolvedValue(4),
}));

vi.mock("@/lib/Modules/Logs/Purge", () => ({ purgeLogEntriesOlderThan }));

import {
  expireLogEntries,
  processExpireLogEntriesJob,
} from "@/lib/Jobs/expireLogEntries";
import { LOG_ENTRY_RETENTION_MS } from "@/lib/Modules/Logs/Retention";

describe("log entry expiration job", () => {
  it("computes the cutoff from an injectable clock and delegates to purgeLogEntriesOlderThan", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    await expect(expireLogEntries(now)).resolves.toBe(4);
    expect(purgeLogEntriesOlderThan).toHaveBeenCalledWith(
      new Date(now.getTime() - LOG_ENTRY_RETENTION_MS),
    );
  });

  it("is dispatchable as a BullMQ job", async () => {
    await processExpireLogEntriesJob({} as never);
    expect(purgeLogEntriesOlderThan).toHaveBeenCalled();
  });
});
