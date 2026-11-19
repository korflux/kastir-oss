import {
  backupApiError,
  backupResponse,
  getBackupApiContext,
} from "@/lib/Modules/Backup/Api";
import { restoreConfirmSchema } from "@/lib/Modules/Backup/Schema";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { backupService } from "@/lib/Modules/Backup/Service";

type Params = { params: Promise<{ snapshotId: string }> };

export async function GET(request: Request, { params }: Params) {
  const context = await getBackupApiContext(request);
  if (!context) {
    return backupResponse({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  try {
    backupService.assertAdmin(context.role);
    const { snapshotId } = await params;
    const bytes = await backupService.readSnapshotBytes(snapshotId);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="kastir-backup-${snapshotId}.kastir"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return backupApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    backupService.assertAdmin(gate.role);
    const { snapshotId } = await params;
    await backupService.deleteSnapshot(snapshotId);
    return backupResponse({ ok: true });
  } catch (error) {
    return backupApiError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    backupService.assertAdmin(gate.role);
    const { snapshotId } = await params;
    const body = await request.json();
    const parsed = restoreConfirmSchema.safeParse({
      ...body,
      snapshotId,
    });
    if (!parsed.success) {
      return backupResponse(
        {
          error: "Type RESTAURAR to confirm restore",
          code: "CONFIRMATION_REQUIRED",
        },
        400,
      );
    }

    const job = await backupService.startRestore(
      gate.userId,
      snapshotId,
      parsed.data.confirmation,
    );
    return backupResponse({ job }, 202);
  } catch (error) {
    return backupApiError(error);
  }
}
