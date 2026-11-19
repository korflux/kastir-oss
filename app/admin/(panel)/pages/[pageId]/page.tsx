import { PageEditorScreen } from "@/lib/Modules/Pages/Components/PageEditorScreen";
import { requirePanelAccess } from "@/lib/Modules/Panel/Authorization";
import { settingsService } from "@/lib/Modules/Settings/Service";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";

type PageRouteProps = {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{
    folderId?: string | string[];
  }>;
};

export default async function PageRoute({
  params,
  searchParams,
}: PageRouteProps) {
  await requirePanelAccess("/admin/pages");
  const [{ pageId }, query] = await Promise.all([params, searchParams]);
  const folderId = Array.isArray(query.folderId)
    ? query.folderId[0]
    : query.folderId;
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  // Retenção e formatos de data do site: o bloco Versões mostra "X de <limite>" e datas no
  // fuso e formato configurados, como as listagens.
  const settings = await settingsService.getSettings();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageEditorScreen
        dictionary={dictionary.pages}
        formatSettings={{
          timezone: settings.timezone,
          dateFormat: settings.dateFormat,
          timeFormat: settings.timeFormat,
          weekStartsOn: settings.weekStartsOn,
        }}
        initialFolderId={folderId}
        locale={env.PANEL_LANGUAGE}
        pageId={pageId}
        revisionRetentionLimit={settings.revisionRetentionLimit}
        revisions={dictionary.revisions}
      />
    </div>
  );
}
