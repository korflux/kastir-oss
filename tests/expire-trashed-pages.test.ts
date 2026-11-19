import { describe, expect, it, vi } from "vitest";

const {
  expireTrashedPages: expirePages,
  expireTrashedSnippets: expireScripts,
  expireTrashedCampaigns: expireCampaigns,
} = vi.hoisted(() => ({
  expireTrashedPages: vi.fn().mockResolvedValue(2),
  expireTrashedSnippets: vi.fn().mockResolvedValue(1),
  expireTrashedCampaigns: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: { expireTrashedPages: expirePages },
}));
vi.mock("@/lib/Modules/CustomCode/Service", () => ({
  customCodeService: { expireTrashedSnippets: expireScripts },
}));
vi.mock("@/lib/Modules/SplitTests/Service", () => ({
  splitTestsService: { expireTrashedCampaigns: expireCampaigns },
}));

import {
  expireTrashedPages,
  processExpireTrashedPagesJob,
  trashCutoff,
} from "@/lib/Jobs/expireTrashedPages";

describe("trash expiration job", () => {
  it("uses an injectable clock and delegates to PageService", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    await expect(expireTrashedPages(now)).resolves.toBe(2);
    expect(expirePages).toHaveBeenCalledWith(now);
    expect(trashCutoff(now)).toEqual(new Date("2026-07-02T00:00:00.000Z"));
  });

  it("is dispatchable as a BullMQ job and sweeps pages + scripts + split tests", async () => {
    await processExpireTrashedPagesJob({} as never);
    expect(expirePages).toHaveBeenCalled();
    expect(expireScripts).toHaveBeenCalled();
    expect(expireCampaigns).toHaveBeenCalled();
  });
});
