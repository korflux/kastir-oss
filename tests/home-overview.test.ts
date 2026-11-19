import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: { countOverview: vi.fn() },
}));
vi.mock("@/lib/Modules/Media/Service", () => ({
  mediaService: { countOverview: vi.fn() },
}));
vi.mock("@/lib/Modules/CustomCode/Service", () => ({
  customCodeService: { countOverview: vi.fn() },
}));
vi.mock("@/lib/Modules/SplitTests/Service", () => ({
  splitTestsService: { countOverview: vi.fn() },
}));
vi.mock("@/lib/Modules/Users/Service", () => ({
  usersService: { countOverview: vi.fn() },
}));

import { customCodeService } from "@/lib/Modules/CustomCode/Service";
import { getPanelOverview } from "@/lib/Modules/Home/Service";
import { mediaService } from "@/lib/Modules/Media/Service";
import { pageService } from "@/lib/Modules/Pages/Service";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";
import { usersService } from "@/lib/Modules/Users/Service";

describe("getPanelOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pageService.countOverview).mockResolvedValue({
      total: 32,
      publishedThisWeek: 8,
    });
    vi.mocked(mediaService.countOverview).mockResolvedValue({
      total: 63,
      totalSizeBytes: 183 * 1024 * 1024,
    });
    vi.mocked(customCodeService.countOverview).mockResolvedValue({
      total: 8,
      draftCount: 0,
    });
    vi.mocked(splitTestsService.countOverview).mockResolvedValue({
      total: 3,
      inactiveCount: 2,
    });
    vi.mocked(usersService.countOverview).mockResolvedValue({
      total: 6,
      adminCount: 3,
    });
  });

  it("returns the five module blocks", async () => {
    await expect(getPanelOverview("ADMIN")).resolves.toEqual({
      pages: { total: 32, publishedThisWeek: 8 },
      media: { total: 63, totalSizeBytes: 183 * 1024 * 1024 },
      scripts: { total: 8, draftCount: 0 },
      splitTests: { total: 3, inactiveCount: 2 },
      users: { total: 6, adminCount: 3 },
    });
  });

  it("falls back to zeros when one module rejects", async () => {
    vi.mocked(mediaService.countOverview).mockRejectedValue(
      new Error("db down"),
    );

    await expect(getPanelOverview("ADMIN")).resolves.toMatchObject({
      pages: { total: 32 },
      media: { total: 0, totalSizeBytes: 0 },
      scripts: { total: 8 },
    });
  });

  it("does not query user counts for EDITOR", async () => {
    const overview = await getPanelOverview("EDITOR");

    expect(usersService.countOverview).not.toHaveBeenCalled();
    expect(overview.users).toEqual({ total: 0, adminCount: 0 });
  });
});
