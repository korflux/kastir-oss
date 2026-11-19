import { NextResponse } from "next/server";

import {
  splitTestsApiError,
  stripClientControlledFields,
} from "@/lib/Modules/SplitTests/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";

type RouteContext = {
  params: Promise<{ campaignId: string; destinationId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { campaignId, destinationId } = await context.params;
    const payload = stripClientControlledFields(await request.json());
    const campaign = await splitTestsService.updateDestination(
      gate.userId,
      campaignId,
      destinationId,
      payload,
    );
    return NextResponse.json({ campaign });
  } catch (error) {
    return splitTestsApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { campaignId, destinationId } = await context.params;
    const campaign = await splitTestsService.deleteDestination(
      gate.userId,
      campaignId,
      destinationId,
    );
    return NextResponse.json({ campaign });
  } catch (error) {
    return splitTestsApiError(error);
  }
}
