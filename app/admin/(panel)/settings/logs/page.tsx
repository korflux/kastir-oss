import { LogsWorkspace } from "@/lib/Modules/Logs/Components/LogsWorkspace";
import { requirePanelAccess } from "@/lib/Modules/Panel/Authorization";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { logsService } from "@/lib/Modules/Logs/Service";
import { settingsService } from "@/lib/Modules/Settings/Service";

/** Aba Logs — antiga /admin/logs (reskin leve na Task 5). */
export default async function SetupLogsPage() {
  const { session } = await requirePanelAccess("/admin/settings/logs");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  const [initialData, settings] = await Promise.all([
    logsService.listLogs(session.user.id, {
      page: 1,
      pageSize: 50,
    }),
    settingsService.getSettings(),
  ]);

  return (
    <div data-tour-anchor="tour-logs" className="min-h-0 flex-1">
      <LogsWorkspace
        copy={dictionary.logs}
        formatSettings={{
          timezone: settings.timezone,
          dateFormat: settings.dateFormat,
          timeFormat: settings.timeFormat,
          weekStartsOn: settings.weekStartsOn,
        }}
        initialData={initialData}
        locale={env.PANEL_LANGUAGE}
      />
    </div>
  );
}
