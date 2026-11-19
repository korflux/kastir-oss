import { SplitTestsWorkspace } from "@/lib/Modules/SplitTests/Components/SplitTestsWorkspace";
import {
  canBulkMutate,
  requirePanelAccess,
} from "@/lib/Modules/Panel/Authorization";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { prisma } from "@/lib/prisma";

export default async function SplitTestsPage() {
  const { role } = await requirePanelAccess("/admin/split-tests");
  const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
  const settings = await prisma.siteSettings.findUnique({
    where: { id: "singleton" },
  });
  const publicOrigin = getPublicOrigin({
    siteUrl: settings?.siteUrl,
    fallbackOrigin: env.BETTER_AUTH_URL,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SplitTestsWorkspace
        bulkDictionary={dictionary.bulk}
        canBulk={canBulkMutate(role)}
        dictionary={dictionary.splitTests}
        publicOrigin={publicOrigin}
      />
    </div>
  );
}
