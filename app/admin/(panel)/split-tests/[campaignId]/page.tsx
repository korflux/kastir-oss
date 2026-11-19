import { SplitTestsWorkspace } from "@/lib/Modules/SplitTests/Components/SplitTestsWorkspace";
import {
  canBulkMutate,
  requirePanelAccess,
} from "@/lib/Modules/Panel/Authorization";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";
import { prisma } from "@/lib/prisma";

type PageProps = { params: Promise<{ campaignId: string }> };

export default async function SplitTestCampaignPage({
  params,
  searchParams,
}: PageProps & {
  searchParams: Promise<{ created?: string | string[] }>;
}) {
  const { role } = await requirePanelAccess("/admin/split-tests");
  const [{ campaignId }, query] = await Promise.all([params, searchParams]);
  const created = Array.isArray(query.created)
    ? query.created[0]
    : query.created;
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
        campaignId={campaignId}
        dictionary={dictionary.splitTests}
        justCreated={created === "1"}
        publicOrigin={publicOrigin}
      />
    </div>
  );
}
