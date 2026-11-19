import { NextResponse } from "next/server";

import { mediaApiError } from "@/lib/Modules/Media/Api";
import {
  assertPanelMultipartLength,
  PanelMutationBodyError,
  panelMutationBodyErrorResponse,
  requireTrustedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";
import { mediaService } from "@/lib/Modules/Media/Service";

const MAX_MULTIPART_FILE_BYTES = 200 * 1024 * 1024;

type RouteContext = { params: Promise<{ mediaId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    assertPanelMultipartLength(request, MAX_MULTIPART_FILE_BYTES);
    form = await request.formData();
  } catch (error) {
    if (error instanceof PanelMutationBodyError) {
      return panelMutationBodyErrorResponse(error);
    }
    return NextResponse.json(
      { error: "Invalid multipart form data", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "A replacement file is required", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  try {
    const { mediaId } = await context.params;
    const media = await mediaService.replace(gate.userId, mediaId, {
      fileName: file.name,
      buffer:
        file.size > MAX_MULTIPART_FILE_BYTES
          ? Buffer.alloc(0)
          : Buffer.from(await file.arrayBuffer()),
      sizeBytes: file.size,
    });
    return NextResponse.json({ media });
  } catch (error) {
    return mediaApiError(error);
  }
}
