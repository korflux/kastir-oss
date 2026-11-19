import { NextResponse } from "next/server";

import { customCodeApiError } from "@/lib/Modules/CustomCode/Api";
import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
} from "@/lib/Modules/Panel/MutationSecurity";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";

/** Restore individual: Master/Admin/Editor; bulk restore permanece privilegiado. */
export async function POST(
  request: Request,
  context: { params: Promise<{ snippetId: string }> },
) {
  const apiContext = await getTrustedPanelMutationAuth(request);
  if (apiContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(apiContext);

  try {
    const { snippetId } = await context.params;
    const snippet = await customCodeService.restoreSnippet(
      apiContext.userId,
      snippetId,
    );
    return NextResponse.json({ snippet });
  } catch (error) {
    return customCodeApiError(error);
  }
}
