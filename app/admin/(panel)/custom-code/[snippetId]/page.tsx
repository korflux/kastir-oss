import { CustomCodeWorkspace } from "@/lib/Modules/CustomCode/Components/CustomCodeWorkspace";
import {
  canBulkMutate,
  requirePanelAccess,
} from "@/lib/Modules/Panel/Authorization";
import { settingsService } from "@/lib/Modules/Settings/Service";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";

export default async function CustomCodeEditorPage({
  params,
}: {
  params: Promise<{ snippetId: string }>;
}) {
  const { role } = await requirePanelAccess("/admin/custom-code");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  const { snippetId } = await params;
  // Retenção e formatos de data do site: o bloco Versões mostra "X de <limite>" e datas no
  // fuso e formato configurados, como as listagens. Só esses campos seguem ao cliente.
  const settings = await settingsService.getSettings();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CustomCodeWorkspace
        bulkDictionary={dictionary.bulk}
        canBulk={canBulkMutate(role)}
        dictionary={dictionary.customCode}
        formatSettings={{
          timezone: settings.timezone,
          dateFormat: settings.dateFormat,
          timeFormat: settings.timeFormat,
          weekStartsOn: settings.weekStartsOn,
        }}
        locale={env.PANEL_LANGUAGE}
        revisionRetentionLimit={settings.revisionRetentionLimit}
        revisions={dictionary.revisions}
        snippetId={snippetId}
      />
    </div>
  );
}
