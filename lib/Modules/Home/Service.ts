import { customCodeService } from "@/lib/Modules/CustomCode/Service";
import type { PanelOverview } from "@/lib/Modules/Home/Types";
import { mediaService } from "@/lib/Modules/Media/Service";
import { visibleMenuItems } from "@/lib/Modules/Panel/Permissions";
import type { EffectiveRole } from "@/lib/Modules/Panel/Types";
import { pageService } from "@/lib/Modules/Pages/Service";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";
import { usersService } from "@/lib/Modules/Users/Service";

function settledOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

/**
 * Orquestra contagens da Home. allSettled: falha isolada zera o card,
 * sem derrubar o painel inteiro.
 */
export async function getPanelOverview(
  role: EffectiveRole = "MASTER",
): Promise<PanelOverview> {
  const includeUsers = visibleMenuItems(role).some(
    (item) => item.key === "users",
  );
  const [pages, media, scripts, splitTests, users] = await Promise.allSettled([
    pageService.countOverview(),
    mediaService.countOverview(),
    customCodeService.countOverview(),
    splitTestsService.countOverview(),
    includeUsers
      ? usersService.countOverview()
      : Promise.resolve({ total: 0, adminCount: 0 }),
  ]);

  return {
    pages: settledOr(pages, { total: 0, publishedThisWeek: 0 }),
    media: settledOr(media, { total: 0, totalSizeBytes: 0 }),
    scripts: settledOr(scripts, { total: 0, draftCount: 0 }),
    splitTests: settledOr(splitTests, { total: 0, inactiveCount: 0 }),
    users: settledOr(users, { total: 0, adminCount: 0 }),
  };
}
