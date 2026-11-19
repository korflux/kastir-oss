import { NextResponse } from "next/server";

import {
  customCodeApiError,
  getCustomCodeApiContext,
  stripClientControlledFields,
} from "@/lib/Modules/CustomCode/Api";
import { listSnippetsQuerySchema } from "@/lib/Modules/CustomCode/Schema";
import {
  PANEL_EDITOR_BODY_MAX_BYTES,
  PanelMutationBodyError,
  panelMutationBodyErrorResponse,
  readPanelMutationJson,
  requireTrustedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";

export async function GET(request: Request) {
  const context = await getCustomCodeApiContext(request);
  if (!context)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  try {
    const query = listSnippetsQuerySchema.parse({
      search: params.get("search") ?? undefined,
      status: params.get("status") ?? undefined,
      location: params.get("location") ?? undefined,
      trash: params.get("trash") ?? undefined,
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
    });
    const result = await customCodeService.listSnippets({
      search: query.search,
      status: query.status,
      location: query.location,
      includeDeleted: query.includeDeleted,
      page: query.page,
      pageSize: query.pageSize,
    });
    return NextResponse.json(result);
  } catch (error) {
    return customCodeApiError(error);
  }
}

export async function POST(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const payload = stripClientControlledFields(
      await readPanelMutationJson(request, PANEL_EDITOR_BODY_MAX_BYTES),
    );
    const snippet = await customCodeService.createSnippet(gate.userId, payload);
    return NextResponse.json({ snippet }, { status: 201 });
  } catch (error) {
    if (error instanceof PanelMutationBodyError) {
      return panelMutationBodyErrorResponse(error);
    }
    return customCodeApiError(error);
  }
}
