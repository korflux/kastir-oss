import { describe, expect, it, vi } from "vitest";

const { expireStaleNotifications } = vi.hoisted(() => ({
  expireStaleNotifications: vi.fn().mockResolvedValue(2),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/Modules/Notifications/Service", () => ({
  expireStaleNotifications,
}));

import { processExpireStaleNotificationsJob } from "@/lib/Jobs/expireStaleNotifications";
import { dispatchPublishingJob } from "@/lib/Publishing/worker";

describe("stale notification expiration job", () => {
  it("delegates expiration to the service without carrying notification state", async () => {
    await processExpireStaleNotificationsJob({} as never);

    expect(expireStaleNotifications).toHaveBeenCalledOnce();
  });

  it("is dispatchable alongside the existing publishing jobs", async () => {
    const handler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "expire-stale-notifications" } } as never,
      { "expire-stale-notifications": handler },
    );

    expect(handler).toHaveBeenCalledOnce();
  });
});
