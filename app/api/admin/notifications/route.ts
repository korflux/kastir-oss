import {
  getNotificationsApiContext,
  notificationsApiError,
  notificationsResponse,
} from "@/lib/Modules/Notifications/Api";
import { parseNotificationsQuery } from "@/lib/Modules/Notifications/Schema";
import { notificationsService } from "@/lib/Modules/Notifications/Service";

export async function GET(request: Request) {
  const context = await getNotificationsApiContext(request);
  if (!context) {
    return notificationsResponse(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      401,
    );
  }

  try {
    const options = parseNotificationsQuery(new URL(request.url).searchParams);
    const [result, unreadCount] = await Promise.all([
      notificationsService.listNotifications(context.userId, options),
      notificationsService.unreadCount(context.userId),
    ]);
    return notificationsResponse({
      ...result,
      unreadCount,
    });
  } catch (error) {
    return notificationsApiError(error);
  }
}
