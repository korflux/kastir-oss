import { requirePanelAccess } from "@/lib/Modules/Panel/Authorization";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { settingsService } from "@/lib/Modules/Settings/Service";
import { SettingsWorkspace } from "@/lib/Modules/Settings/Components/SettingsWorkspace";

/**
 * Aba "Settings" dentro de /admin/settings (nome duplicado de propósito —
 * bate com o rótulo do Figma). Comportamento do site.
 */
export default async function SetupSettingsPage() {
  await requirePanelAccess("/admin/settings/settings");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  const [settings, options] = await Promise.all([
    settingsService.getSettings(),
    settingsService.listOptions(),
  ]);

  return (
    <SettingsWorkspace
      copy={dictionary.settings}
      initialSettings={settings}
      options={options}
    />
  );
}
