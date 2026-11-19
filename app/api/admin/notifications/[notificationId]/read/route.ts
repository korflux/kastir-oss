import {
  notificationsApiError,
  notificationsResponse,
  requireEmptyRequestBody,
} from "@/lib/Modules/Notifications/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { parseNotificationId } from "@/lib/Modules/Notifications/Schema";
import { notificationsService } from "@/lib/Modules/Notifications/Service";

type RouteContext = { params: Promise<{ notificationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  try {
    await requireEmptyRequestBody(request);
    const { notificationId } = await context.params;
    const notification = await notificationsService.markAsRead(
      gate.userId,
      parseNotificationId(notificationId),
    );
    const unreadCount = await notificationsService.unreadCount(gate.userId);

    return notificationsResponse({ notification, unreadCount });
  } catch (error) {
    return notificationsApiError(error);
  }
}
