import {
  backupApiError,
  backupResponse,
  getBackupApiContext,
} from "@/lib/Modules/Backup/Api";
import { backupAutoScheduleSchema } from "@/lib/Modules/Backup/Schema";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { backupService } from "@/lib/Modules/Backup/Service";

export async function GET(request: Request) {
  const context = await getBackupApiContext(request);
  if (!context) {
    return backupResponse({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  try {
    backupService.assertAdmin(context.role);
    const [snapshots, schedule] = await Promise.all([
      backupService.listSnapshots(),
      backupService.getAutoSchedule(),
    ]);
    return backupResponse({ snapshots, schedule });
  } catch (error) {
    return backupApiError(error);
  }
}

export async function POST(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    backupService.assertAdmin(gate.role);
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      enabled?: unknown;
      intervalDays?: unknown;
      hour?: unknown;
      minute?: unknown;
    };

    if (body.action === "export") {
      const job = await backupService.startExport(gate.userId);
      return backupResponse({ job }, 202);
    }

    if (body.action === "schedule") {
      const parsed = backupAutoScheduleSchema.safeParse({
        enabled: body.enabled,
        intervalDays: body.intervalDays,
        hour: body.hour,
        minute: body.minute,
      });
      if (!parsed.success) {
        return backupResponse(
          { error: "Invalid backup schedule", code: "VALIDATION_ERROR" },
          422,
        );
      }
      const schedule = await backupService.updateAutoSchedule(
        gate.userId,
        parsed.data,
      );
      return backupResponse({ schedule });
    }

    return backupResponse(
      { error: "Unknown action", code: "VALIDATION_ERROR" },
      422,
    );
  } catch (error) {
    return backupApiError(error);
  }
}
