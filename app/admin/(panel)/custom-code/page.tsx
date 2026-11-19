import { CustomCodeWorkspace } from "@/lib/Modules/CustomCode/Components/CustomCodeWorkspace";
import {
  canBulkMutate,
  requirePanelAccess,
} from "@/lib/Modules/Panel/Authorization";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";

export default async function CustomCodePage() {
  const { role } = await requirePanelAccess("/admin/custom-code");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  return (
    <div
      data-tour-anchor="tour-custom-code"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <CustomCodeWorkspace
        bulkDictionary={dictionary.bulk}
        canBulk={canBulkMutate(role)}
        dictionary={dictionary.customCode}
        revisions={dictionary.revisions}
      />
    </div>
  );
}
