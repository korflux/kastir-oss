import { NextResponse } from "next/server";

import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  panelMutationForbiddenResponse,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";
import { canBulkMutate } from "@/lib/Modules/Panel/Policy";
import { bulkSplitTestsSchema } from "@/lib/Modules/SplitTests/Schema";
import { splitTestsService } from "@/lib/Modules/SplitTests/Service";
import {
  SplitTestsDomainError,
  type SplitTestsDomainErrorCode,
} from "@/lib/Modules/SplitTests/Types";
import {
  bulkResponseStatus,
  runBulk,
  type BulkFailure,
} from "@/lib/Modules/Shared/Bulk";

const safeMessageByCode: Record<
  SplitTestsDomainErrorCode | "INTERNAL_ERROR",
  string
> = {
  VALIDATION_ERROR: "Campaign data is invalid",
  NOT_FOUND: "Campaign was not found",
  CONFLICT: "Campaign conflicts with another resource",
  FORBIDDEN: "Campaign action is not allowed",
  INVALID_STATE: "Campaign is not in an eligible state",
  INTERNAL_ERROR: "Unable to complete the split test operation",
};

/** Converts a campaign-domain failure to a safe item-level result. */
function splitTestsBulkFailure(id: string, error: unknown): BulkFailure {
  const code =
    error instanceof SplitTestsDomainError ? error.code : "INTERNAL_ERROR";
  return { id, code, message: safeMessageByCode[code] };
}

export async function POST(request: Request) {
  const authContext = await getTrustedPanelMutationAuth(request);
  if (authContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(authContext);

  const context = authContext;

  // A permissão de lixeira em lote é revalidada no servidor para cada papel.
  if (!canBulkMutate(context.role)) {
    return panelMutationForbiddenResponse();
  }

  let body: unknown;
  try {
    body = await readPanelMutationJson(request);
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  const parsed = bulkSplitTestsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bulk payload", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const result = await runBulk(
    parsed.data.ids,
    async (id) => {
      // Reusa as ações individuais para preservar estado, auditoria e efeitos.
      if (parsed.data.action === "restore") {
        await splitTestsService.restoreCampaign(context.userId, id);
        return;
      }

      if (parsed.data.action === "permanently-delete") {
        await splitTestsService.permanentlyDeleteCampaign(
          context.userId,
          id,
          context.role,
        );
        return;
      }

      await splitTestsService.trashCampaign(context.userId, id);
    },
    splitTestsBulkFailure,
  );

  return NextResponse.json(result, { status: bulkResponseStatus(result) });
}
