import { NextResponse } from "next/server";

import {
  splitTestsApiError,
  stripClientControlledFields,
} from "@/lib/Modules/SplitTests/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";

type RouteContext = { params: Promise<{ campaignId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { campaignId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;

    if (Array.isArray(body.orderedIds)) {
      const campaign = await splitTestsService.reorderDestinations(
        gate.userId,
        campaignId,
        body.orderedIds as string[],
      );
      return NextResponse.json({ campaign });
    }

    const payload = stripClientControlledFields(body);
    const campaign = await splitTestsService.addDestination(
      gate.userId,
      campaignId,
      payload,
    );
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return splitTestsApiError(error);
  }
}
