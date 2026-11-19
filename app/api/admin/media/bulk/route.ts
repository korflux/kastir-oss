import { NextResponse } from "next/server";

import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  panelMutationForbiddenResponse,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";
import { canBulkMutate } from "@/lib/Modules/Panel/Policy";
import { bulkMediaSchema } from "@/lib/Modules/Media/Schema";
import { mediaService } from "@/lib/Modules/Media/Service";
import {
  MediaDomainError,
  type MediaDomainErrorCode,
} from "@/lib/Modules/Media/Types";
import {
  bulkResponseStatus,
  runBulk,
  type BulkFailure,
} from "@/lib/Modules/Shared/Bulk";

const safeMessageByCode: Record<
  MediaDomainErrorCode | "INTERNAL_ERROR",
  string
> = {
  VALIDATION_ERROR: "Media data is invalid",
  NOT_FOUND: "Media was not found",
  CONFLICT: "Media conflicts with another resource",
  INVALID_STATE: "Media is not in an eligible state",
  BASE_FOLDER_PROTECTED: "The selected folder is protected",
  FOLDER_DEPTH_EXCEEDED: "The selected folder is too deep",
  UPLOAD_FAILED: "Media processing could not be completed",
  INTERNAL_ERROR: "Unable to complete the media operation",
};

/** Converts a media-domain failure to a safe item-level response. */
function mediaBulkFailure(id: string, error: unknown): BulkFailure {
  const code =
    error instanceof MediaDomainError ? error.code : "INTERNAL_ERROR";
  return { id, code, message: safeMessageByCode[code] };
}

export async function POST(request: Request) {
  const authContext = await getTrustedPanelMutationAuth(request);
  if (authContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(authContext);

  const context = authContext;

  // Bulk é uma permissão de mutação e não pode depender do controle da UI.
  if (!canBulkMutate(context.role)) {
    return panelMutationForbiddenResponse();
  }

  let body: unknown;
  try {
    body = await readPanelMutationJson(request);
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  const parsed = bulkMediaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bulk payload", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const result = await runBulk(
    parsed.data.ids,
    async (id) => {
      if (parsed.data.action === "move-folder") {
        await mediaService.updateMetadata(context.userId, {
          id,
          folderId: parsed.data.folderId,
        });
        return;
      }
      if (parsed.data.action === "convert-webp") {
        await mediaService.convertToWebp(context.userId, id);
        return;
      }
      await mediaService.delete(context.userId, id);
    },
    mediaBulkFailure,
  );

  return NextResponse.json(result, { status: bulkResponseStatus(result) });
}
