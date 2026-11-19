import { requirePanelAccess } from "@/lib/Modules/Panel/Authorization";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { settingsService } from "@/lib/Modules/Settings/Service";
import { GeneralWorkspace } from "@/lib/Modules/Settings/Components/GeneralWorkspace";

/** Aba General — identidade do site (Figma Setup.png). */
export default async function SetupGeneralPage() {
  await requirePanelAccess("/admin/settings/general");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  const [settings, options] = await Promise.all([
    settingsService.getSettings(),
    settingsService.listOptions(),
  ]);

  return (
    <GeneralWorkspace
      copy={dictionary.settings}
      initialSettings={settings}
      options={options}
    />
  );
}
