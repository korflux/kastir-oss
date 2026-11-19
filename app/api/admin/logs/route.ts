import {
  getLogsApiContext,
  logsApiError,
  logsResponse,
} from "@/lib/Modules/Logs/Api";
import { parseLogsQuery } from "@/lib/Modules/Logs/Schema";
import { logsService } from "@/lib/Modules/Logs/Service";

export async function GET(request: Request) {
  const context = await getLogsApiContext(request);
  if (!context) {
    return logsResponse({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  if (context.role === "EDITOR") {
    return logsResponse({ error: "Forbidden", code: "FORBIDDEN" }, 403);
  }

  try {
    const filters = parseLogsQuery(new URL(request.url).searchParams);
    return logsResponse(await logsService.listLogs(context.userId, filters));
  } catch (error) {
    return logsApiError(error);
  }
}
