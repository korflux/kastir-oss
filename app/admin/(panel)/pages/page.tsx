import { PagesWorkspace } from "@/lib/Modules/Pages/Components/PagesWorkspace";
import {
  canBulkMutate,
  requirePanelAccess,
} from "@/lib/Modules/Panel/Authorization";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import { settingsService } from "@/lib/Modules/Settings/Service";

export default async function PagesPage() {
  const { role } = await requirePanelAccess("/admin/pages");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  const formatSettings = await settingsService.getSettings();
  const publicOrigin = getPublicOrigin({
    siteUrl: formatSettings.siteUrl,
    fallbackOrigin: env.BETTER_AUTH_URL,
  });

  return (
    <div
      data-tour-anchor="tour-pages"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <PagesWorkspace
        bulkDictionary={dictionary.bulk}
        canBulk={canBulkMutate(role)}
        dictionary={dictionary.pages}
        folderDictionary={dictionary.folders}
        formatSettings={{
          timezone: formatSettings.timezone,
          dateFormat: formatSettings.dateFormat,
          timeFormat: formatSettings.timeFormat,
          weekStartsOn: formatSettings.weekStartsOn,
        }}
        homePageId={formatSettings.homePageId}
        locale={env.PANEL_LANGUAGE}
        publicOrigin={publicOrigin}
      />
    </div>
  );
}
