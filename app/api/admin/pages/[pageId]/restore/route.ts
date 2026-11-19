import { NextResponse } from "next/server";

import { pageApiError } from "@/lib/Modules/Pages/Api";
import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
} from "@/lib/Modules/Panel/MutationSecurity";
import { pageService } from "@/lib/Modules/Pages/Service";

/** Restore individual: Master/Admin/Editor (matriz de produto); bulk continua privilegiado. */
export async function POST(
  request: Request,
  context: { params: Promise<{ pageId: string }> },
) {
  const apiContext = await getTrustedPanelMutationAuth(request);
  if (apiContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(apiContext);

  try {
    const { pageId } = await context.params;
    const page = await pageService.restorePage(apiContext.userId, pageId);
    return NextResponse.json({ page });
  } catch (error) {
    return pageApiError(error);
  }
}
