import { NextResponse } from "next/server";

import {
  getPageApiContext,
  pageApiError,
  stripClientControlledFields,
} from "@/lib/Modules/Pages/Api";
import {
  getTrustedPanelMutationAuth,
  PANEL_EDITOR_BODY_MAX_BYTES,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";
import { pageService } from "@/lib/Modules/Pages/Service";

type RouteContext = { params: Promise<{ pageId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getPageApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { pageId } = await context.params;
    const page = await pageService.getPage(pageId);
    return NextResponse.json({ page });
  } catch (error) {
    return pageApiError(error);
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
    const { pageId } = await context.params;
    const page = await pageService.updatePage(authContext.userId, {
      ...(payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload
        : {}),
      id: pageId,
    });
    return NextResponse.json({ page });
  } catch (error) {
    return pageApiError(error);
  }
}

/** Soft-delete: EDITOR também move para a lixeira; permanent fica em rota própria. */
export async function DELETE(request: Request, context: RouteContext) {
  const apiContext = await getTrustedPanelMutationAuth(request);
  if (apiContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(apiContext);

  try {
    const { pageId } = await context.params;
    const page = await pageService.trashPage(apiContext.userId, pageId);
    return NextResponse.json({ page });
  } catch (error) {
    return pageApiError(error);
  }
}
