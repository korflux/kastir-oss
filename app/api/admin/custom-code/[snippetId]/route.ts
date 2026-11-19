import { NextResponse } from "next/server";

import {
  customCodeApiError,
  getCustomCodeApiContext,
  stripClientControlledFields,
} from "@/lib/Modules/CustomCode/Api";
import {
  getTrustedPanelMutationAuth,
  PANEL_EDITOR_BODY_MAX_BYTES,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";

type RouteContext = { params: Promise<{ snippetId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getCustomCodeApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { snippetId } = await context.params;
    return NextResponse.json({
      snippet: await customCodeService.getSnippet(snippetId),
    });
  } catch (error) {
    return customCodeApiError(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const authContext = await getTrustedPanelMutationAuth(request);
  if (authContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(authContext);

  let payload: unknown;
  try {
    payload = stripClientControlledFields(
      await readPanelMutationJson(request, PANEL_EDITOR_BODY_MAX_BYTES),
    );
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  try {
    const { snippetId } = await context.params;
    const snippet = await customCodeService.updateSnippet(authContext.userId, {
      ...(payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload
        : {}),
      id: snippetId,
    });
    return NextResponse.json({ snippet });
  } catch (error) {
    return customCodeApiError(error);
  }
}

export const PATCH = PUT;

/** Soft delete → lixeira (paridade Pages; EDITOR incluído). */
export async function DELETE(request: Request, context: RouteContext) {
  const apiContext = await getTrustedPanelMutationAuth(request);
  if (apiContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(apiContext);

  try {
    const { snippetId } = await context.params;
    const snippet = await customCodeService.trashSnippet(
      apiContext.userId,
      snippetId,
    );
    return NextResponse.json({ snippet });
  } catch (error) {
    return customCodeApiError(error);
  }
}
