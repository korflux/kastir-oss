import { NextResponse } from "next/server";

import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  panelMutationForbiddenResponse,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";
import { canBulkMutate } from "@/lib/Modules/Panel/Policy";
import { bulkCustomCodeSchema } from "@/lib/Modules/CustomCode/Schema";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";
import {
  CustomCodeDomainError,
  type CustomCodeDomainErrorCode,
} from "@/lib/Modules/CustomCode/Types";
import {
  bulkResponseStatus,
  runBulk,
  type BulkFailure,
} from "@/lib/Modules/Shared/Bulk";

const safeMessageByCode: Record<
  CustomCodeDomainErrorCode | "INTERNAL_ERROR",
  string
> = {
  VALIDATION_ERROR: "Script data is invalid",
  NOT_FOUND: "Script was not found",
  CONFLICT: "Script conflicts with another resource",
  FORBIDDEN: "Script action is not allowed",
  INVALID_STATE: "Script is not in an eligible state",
  CONFIRMATION_REQUIRED: "Script action requires confirmation",
  QUEUE_FAILED: "Script processing could not be queued",
  INTERNAL_ERROR: "Unable to complete the script operation",
};

/** Converts a script-domain failure to a safe response item without internals. */
function customCodeBulkFailure(id: string, error: unknown): BulkFailure {
  const code =
    error instanceof CustomCodeDomainError ? error.code : "INTERNAL_ERROR";
  return { id, code, message: safeMessageByCode[code] };
}

export async function POST(request: Request) {
  const authContext = await getTrustedPanelMutationAuth(request);
  if (authContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(authContext);

  const context = authContext;

  // A seleção da UI é apenas conveniência; a API mantém o bloqueio de Editor.
  if (!canBulkMutate(context.role)) {
    return panelMutationForbiddenResponse();
  }

  let body: unknown;
  try {
    body = await readPanelMutationJson(request);
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  const parsed = bulkCustomCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bulk payload", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const result = await runBulk(
    parsed.data.ids,
    async (id) => {
      // Reusa as ações individuais para manter estado, auditoria e efeitos iguais.
      if (parsed.data.action === "restore") {
        await customCodeService.restoreSnippet(context.userId, id);
        return;
      }

      if (parsed.data.action === "permanently-delete") {
        await customCodeService.permanentlyDeleteSnippet(
          context.userId,
          id,
          context.role,
        );
        return;
      }

      await customCodeService.trashSnippet(context.userId, id);
    },
    customCodeBulkFailure,
  );

  return NextResponse.json(result, { status: bulkResponseStatus(result) });
}
