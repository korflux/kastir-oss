import { describe, expect, it, vi } from "vitest";

const { expire } = vi.hoisted(() => ({ expire: vi.fn().mockResolvedValue(3) }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/Modules/Notifications/Service", () => ({
  expireReadNotifications: expire,
}));

import { processExpireReadNotificationsJob } from "@/lib/Jobs/expireReadNotifications";
import { dispatchPublishingJob } from "@/lib/Publishing/worker";

describe("notification expiration job", () => {
  it("delegates expiration to the service without carrying notification state", async () => {
    await processExpireReadNotificationsJob({} as never);

    expect(expire).toHaveBeenCalledOnce();
  });

  it("is dispatchable alongside the existing publishing jobs", async () => {
    const handler = vi.fn();

    await dispatchPublishingJob(
      { data: { type: "expire-read-notifications" } } as never,
      { "expire-read-notifications": handler },
    );

    expect(handler).toHaveBeenCalledOnce();
  });
});
