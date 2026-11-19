import { NextResponse } from "next/server";

import {
  getSplitTestsApiContext,
  splitTestsApiError,
  stripClientControlledFields,
} from "@/lib/Modules/SplitTests/Api";
import {
  getTrustedPanelMutationAuth,
  PANEL_EDITOR_BODY_MAX_BYTES,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";

type RouteContext = { params: Promise<{ campaignId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const api = await getSplitTestsApiContext(request);
  if (!api)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { campaignId } = await context.params;
    const campaign = await splitTestsService.getCampaign(campaignId);
    return NextResponse.json({ campaign });
  } catch (error) {
    return splitTestsApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const api = await getTrustedPanelMutationAuth(request);
  if (api.status !== "authenticated")
    return panelMutationAuthErrorResponse(api);

  let body: unknown;
  try {
    body = await readPanelMutationJson(request, PANEL_EDITOR_BODY_MAX_BYTES);
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  try {
    const { campaignId } = await context.params;
    const payload = stripClientControlledFields(body);
    const campaign = await splitTestsService.updateCampaign(
      api.userId,
      campaignId,
      payload,
    );
    return NextResponse.json({ campaign });
  } catch (error) {
    return splitTestsApiError(error);
  }
}

/** Soft delete → lixeira (paridade Pages; EDITOR incluído). */
export async function DELETE(request: Request, context: RouteContext) {
  const api = await getTrustedPanelMutationAuth(request);
  if (api.status !== "authenticated")
    return panelMutationAuthErrorResponse(api);

  try {
    const { campaignId } = await context.params;
    const campaign = await splitTestsService.trashCampaign(
      api.userId,
      campaignId,
    );
    return NextResponse.json({ campaign });
  } catch (error) {
    return splitTestsApiError(error);
  }
}
