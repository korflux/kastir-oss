import { NextResponse } from "next/server";

import { stripClientControlledFields } from "@/lib/Modules/Pages/Api";
import {
  getTrustedPanelMutationAuth,
  PANEL_MUTATION_BODY_MAX_BYTES,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";
import { pageService } from "@/lib/Modules/Pages/Service";
import { revisionPinSchema } from "@/lib/Modules/Revisions/Schema";
import { revisionApiError } from "@/lib/Modules/Revisions/Api";

type RouteContext = {
  params: Promise<{ pageId: string; revisionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const authContext = await getTrustedPanelMutationAuth(request);
  if (authContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(authContext);

  let payload: unknown;
  try {
    payload = stripClientControlledFields(
      await readPanelMutationJson(request, PANEL_MUTATION_BODY_MAX_BYTES),
    );
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  const parsed = revisionPinSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid revision pin", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  try {
    const { pageId, revisionId } = await context.params;
    const revision = await pageService.setPageRevisionPinned(
      authContext.userId,
      pageId,
      revisionId,
      parsed.data.pinned,
    );
    return NextResponse.json({ revision });
  } catch (error) {
    return revisionApiError(error);
  }
}
