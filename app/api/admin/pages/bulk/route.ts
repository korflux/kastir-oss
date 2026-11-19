import { NextResponse } from "next/server";

import {
  getTrustedPanelMutationAuth,
  panelMutationAuthErrorResponse,
  panelMutationBodyErrorResponse,
  panelMutationForbiddenResponse,
  readPanelMutationJson,
} from "@/lib/Modules/Panel/MutationSecurity";
import { canBulkMutate } from "@/lib/Modules/Panel/Policy";
import { bulkPagesSchema } from "@/lib/Modules/Pages/Schema";
import { pageService } from "@/lib/Modules/Pages/Service";
import {
  PagesDomainError,
  type PageDomainErrorCode,
} from "@/lib/Modules/Pages/Types";
import {
  bulkResponseStatus,
  runBulk,
  type BulkFailure,
} from "@/lib/Modules/Shared/Bulk";

const safeMessageByCode: Record<
  PageDomainErrorCode | "INTERNAL_ERROR",
  string
> = {
  VALIDATION_ERROR: "Page data is invalid",
  NOT_FOUND: "Page was not found",
  CONFLICT: "Page conflicts with another resource",
  FORBIDDEN: "Page action is not allowed",
  INVALID_STATE: "Page is not in an eligible state",
  BASE_FOLDER_PROTECTED: "The selected folder is protected",
  FOLDER_DEPTH_EXCEEDED: "The selected folder is too deep",
  INTERNAL_ERROR: "Unable to complete the page operation",
};

/** Converts domain failures to a safe item-level response without leaking internals. */
function pageBulkFailure(id: string, error: unknown): BulkFailure {
  const code =
    error instanceof PagesDomainError ? error.code : "INTERNAL_ERROR";
  return { id, code, message: safeMessageByCode[code] };
}

export async function POST(request: Request) {
  const authContext = await getTrustedPanelMutationAuth(request);
  if (authContext.status !== "authenticated")
    return panelMutationAuthErrorResponse(authContext);

  const context = authContext;

  // Bulk é uma permissão de operação, não apenas de visualização do módulo.
  if (!canBulkMutate(context.role)) {
    return panelMutationForbiddenResponse();
  }

  let body: unknown;
  try {
    body = await readPanelMutationJson(request);
  } catch (error) {
    return panelMutationBodyErrorResponse(error);
  }

  const parsed = bulkPagesSchema.safeParse(body);
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
        await pageService.updatePage(context.userId, {
          id,
          folderId: parsed.data.folderId,
        });
        return;
      }

      // Reusa os serviços individuais, preservando estado, efeitos e auditoria.
      if (parsed.data.action === "restore") {
        await pageService.restorePage(context.userId, id);
        return;
      }

      if (parsed.data.action === "permanently-delete") {
        await pageService.permanentlyDeletePage(
          context.userId,
          id,
          context.role,
        );
        return;
      }

      await pageService.trashPage(context.userId, id);
    },
    pageBulkFailure,
  );

  return NextResponse.json(result, { status: bulkResponseStatus(result) });
}
