import { NextResponse } from "next/server";

import {
  getSplitTestsApiContext,
  splitTestsApiError,
  stripClientControlledFields,
} from "@/lib/Modules/SplitTests/Api";
import { listCampaignsQuerySchema } from "@/lib/Modules/SplitTests/Schema";
import {
  PANEL_MUTATION_BODY_MAX_BYTES,
  PanelMutationBodyError,
  panelMutationBodyErrorResponse,
  readPanelMutationJson,
  requireTrustedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";

export async function GET(request: Request) {
  const context = await getSplitTestsApiContext(request);
  if (!context)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  try {
    const query = listCampaignsQuerySchema.parse({
      search: params.get("search") ?? undefined,
      status: params.get("status") ?? undefined,
      trash: params.get("trash") ?? undefined,
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
    });
    const result = await splitTestsService.listCampaigns(query);
    return NextResponse.json(result);
  } catch (error) {
    return splitTestsApiError(error);
  }
}

export async function POST(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const payload = stripClientControlledFields(
      await readPanelMutationJson(request, PANEL_MUTATION_BODY_MAX_BYTES),
    );
    const campaign = await splitTestsService.createCampaign(
      gate.userId,
      payload,
    );
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof PanelMutationBodyError) {
      return panelMutationBodyErrorResponse(error);
    }
    return splitTestsApiError(error);
  }
}
