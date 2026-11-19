import { backupApiError, backupResponse } from "@/lib/Modules/Backup/Api";
import { getBackupMaxBytes } from "@/lib/Modules/Backup/constants";
import { importConfirmSchema } from "@/lib/Modules/Backup/Schema";
import {
  assertPanelMultipartLength,
  PanelMutationBodyError,
  panelMutationBodyErrorResponse,
  requireTrustedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";
import { backupService } from "@/lib/Modules/Backup/Service";

export async function POST(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    backupService.assertAdmin(gate.role);

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      try {
        assertPanelMultipartLength(request, getBackupMaxBytes());
      } catch (error) {
        if (error instanceof PanelMutationBodyError) {
          return panelMutationBodyErrorResponse(error);
        }
        throw error;
      }
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return backupResponse(
          { error: "Missing file", code: "VALIDATION_ERROR" },
          422,
        );
      }
      const maxBytes = getBackupMaxBytes();
      if (typeof file.size === "number" && file.size > maxBytes) {
        return backupResponse(
          {
            error: `Package exceeds maximum size of ${maxBytes} bytes`,
            code: "PACKAGE_INVALID",
          },
          422,
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > maxBytes) {
        return backupResponse(
          {
            error: `Package exceeds maximum size of ${maxBytes} bytes`,
            code: "PACKAGE_INVALID",
          },
          422,
        );
      }
      const sourceOrigin = form.get("sourceOrigin");
      const targetOrigin = form.get("targetOrigin");
      const job = await backupService.stageImport(gate.userId, buffer, {
        sourceOrigin:
          typeof sourceOrigin === "string" && sourceOrigin
            ? sourceOrigin
            : undefined,
        targetOrigin:
          typeof targetOrigin === "string" && targetOrigin
            ? targetOrigin
            : undefined,
        requestOrigin: request.headers.get("origin"),
      });
      return backupResponse({ job }, 202);
    }

    const body = await request.json();
    const parsed = importConfirmSchema.safeParse(body);
    if (!parsed.success || !parsed.data.jobId) {
      return backupResponse(
        {
          error: "Invalid import confirmation",
          code: "VALIDATION_ERROR",
        },
        422,
      );
    }

    const job = await backupService.confirmImport(
      gate.userId,
      parsed.data.jobId,
      parsed.data.confirmation,
      {
        sourceOrigin: parsed.data.sourceOrigin,
        targetOrigin: parsed.data.targetOrigin,
      },
    );

    return backupResponse({ job }, 202);
  } catch (error) {
    return backupApiError(error);
  }
}
