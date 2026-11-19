import { NextResponse } from "next/server";

import { mediaApiError } from "@/lib/Modules/Media/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { mediaService } from "@/lib/Modules/Media/Service";

type RouteContext = { params: Promise<{ mediaId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { mediaId } = await context.params;
    const media = await mediaService.convertToWebp(gate.userId, mediaId);
    return NextResponse.json({ media }, { status: 202 });
  } catch (error) {
    return mediaApiError(error);
  }
}
