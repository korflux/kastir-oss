"use client";

import { SplitTestEditor } from "@/lib/Modules/SplitTests/Components/SplitTestEditor";
import { SplitTestsList } from "@/lib/Modules/SplitTests/Components/SplitTestsList";
import type { SplitTestsCopy } from "@/lib/Modules/SplitTests/Components/SplitTestsTypes";
import type { PanelDictionary } from "@/lib/i18n/panel";

/** Seleciona lista ou editor sem assumir estado pertencente a cada fluxo. */
export function SplitTestsWorkspace({
  bulkDictionary,
  canBulk,
  dictionary,
  campaignId,
  justCreated = false,
  publicOrigin,
}: {
  bulkDictionary: PanelDictionary["bulk"];
  canBulk: boolean;
  dictionary: SplitTestsCopy;
  campaignId?: string;
  justCreated?: boolean;
  publicOrigin: string;
}) {
  return campaignId ? (
    <SplitTestEditor
      campaignId={campaignId}
      dictionary={dictionary}
      justCreated={justCreated}
      publicOrigin={publicOrigin}
    />
  ) : (
    <SplitTestsList
      bulkDictionary={bulkDictionary}
      canBulk={canBulk}
      dictionary={dictionary}
      publicOrigin={publicOrigin}
    />
  );
}
