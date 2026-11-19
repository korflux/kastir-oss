import { NextResponse } from "next/server";

import {
  getMediaApiContext,
  mediaApiError,
  stripClientControlledFields,
} from "@/lib/Modules/Media/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { mediaService } from "@/lib/Modules/Media/Service";

type RouteContext = { params: Promise<{ mediaId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getMediaApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { mediaId } = await context.params;
    return NextResponse.json({ media: await mediaService.getMedia(mediaId) });
  } catch (error) {
    return mediaApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  let payload: unknown;
  try {
    payload = stripClientControlledFields(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  try {
    const { mediaId } = await context.params;
    const media = await mediaService.updateMetadata(gate.userId, {
      ...(payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload
        : {}),
      id: mediaId,
    });
    return NextResponse.json({ media });
  } catch (error) {
    return mediaApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    const { mediaId } = await context.params;
    await mediaService.delete(gate.userId, mediaId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return mediaApiError(error);
  }
}
