import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  NotificationDomainError,
  type NotificationDomainErrorCode,
} from "@/lib/Modules/Notifications/Types";

export type NotificationsApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getNotificationsApiContext(
  request: Request,
): Promise<NotificationsApiContext | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;

  try {
    return {
      userId: session.user.id,
      role: toEffectiveRole(session.user),
    };
  } catch {
    return null;
  }
}

const statusByError: Record<NotificationDomainErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
};

export function notificationsResponse<T>(body: T, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function notificationsApiError(error: unknown): NextResponse {
  if (error instanceof NotificationDomainError) {
    return notificationsResponse(
      { error: error.message, code: error.code },
      statusByError[error.code],
    );
  }

  if (error instanceof ZodError) {
    return notificationsResponse(
      { error: "Invalid notification request", code: "VALIDATION_ERROR" },
      422,
    );
  }

  return notificationsResponse(
    { error: "Unable to load notifications", code: "INTERNAL_ERROR" },
    500,
  );
}

export async function requireEmptyRequestBody(request: Request): Promise<void> {
  const body = await request.text();
  if (body.trim()) {
    throw new NotificationDomainError(
      "VALIDATION_ERROR",
      "The read request body must be empty",
    );
  }
}
