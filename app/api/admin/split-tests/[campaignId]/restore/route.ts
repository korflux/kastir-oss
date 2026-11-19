import { NextResponse } from "next/server";

import { splitTestsApiError } from "@/lib/Modules/SplitTests/Api";
import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
} from "@/lib/Modules/Panel/MutationSecurity";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";

/** Restore individual: Master/Admin/Editor; bulk restore permanece privilegiado. */
export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const api = await getTrustedPanelMutationAuth(request);
  if (api.status !== "authenticated")
    return panelMutationAuthErrorResponse(api);

  try {
    const { campaignId } = await context.params;
    const campaign = await splitTestsService.restoreCampaign(
      api.userId,
      campaignId,
    );
    return NextResponse.json({ campaign });
  } catch (error) {
    return splitTestsApiError(error);
  }
}
