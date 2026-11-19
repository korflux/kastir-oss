import {
  backupApiError,
  backupResponse,
  getBackupApiContext,
} from "@/lib/Modules/Backup/Api";
import { backupService } from "@/lib/Modules/Backup/Service";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, { params }: Params) {
  const context = await getBackupApiContext(request);
  if (!context) {
    return backupResponse({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  try {
    backupService.assertAdmin(context.role);
    const { jobId } = await params;
    const job = await backupService.getJob(jobId);
    if (!job) {
      return backupResponse({ error: "Job not found", code: "NOT_FOUND" }, 404);
    }
    return backupResponse({ job });
  } catch (error) {
    return backupApiError(error);
  }
}
