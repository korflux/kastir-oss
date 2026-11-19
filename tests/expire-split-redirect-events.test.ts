import { describe, expect, it, vi } from "vitest";

const { rollupEventsOlderThan } = vi.hoisted(() => ({
  rollupEventsOlderThan: vi.fn().mockResolvedValue({ rolledUp: 3, purged: 3 }),
}));

vi.mock("@/lib/Modules/SplitTests/Aggregation", () => ({
  rollupEventsOlderThan,
}));

import {
  expireSplitRedirectEvents,
  processExpireSplitRedirectEventsJob,
} from "@/lib/Jobs/expireSplitRedirectEvents";
import { SPLIT_EVENT_RETENTION_MS } from "@/lib/Modules/SplitTests/constants";

describe("split redirect events expiration job", () => {
  it("computes the cutoff from an injectable clock and delegates to rollupEventsOlderThan", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    await expect(expireSplitRedirectEvents(now)).resolves.toEqual({
      rolledUp: 3,
      purged: 3,
    });
    expect(rollupEventsOlderThan).toHaveBeenCalledWith(
      new Date(now.getTime() - SPLIT_EVENT_RETENTION_MS),
    );
  });

  it("is dispatchable as a BullMQ job", async () => {
    await processExpireSplitRedirectEventsJob({} as never);
    expect(rollupEventsOlderThan).toHaveBeenCalled();
  });
});
