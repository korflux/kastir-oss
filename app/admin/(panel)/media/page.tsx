import { MediaWorkspace } from "@/lib/Modules/Media/Components/MediaWorkspace";
import {
  canBulkMutate,
  requirePanelAccess,
} from "@/lib/Modules/Panel/Authorization";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";

export default async function MediaPage() {
  const { role } = await requirePanelAccess("/admin/media");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);

  return (
    <div
      data-tour-anchor="tour-media"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <MediaWorkspace
        bulkDictionary={dictionary.bulk}
        canBulk={canBulkMutate(role)}
        dictionary={dictionary.media}
        folderDictionary={dictionary.folders}
      />
    </div>
  );
}
