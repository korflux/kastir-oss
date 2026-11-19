import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  SettingsDomainError,
  type SettingsErrorCode,
} from "@/lib/Modules/Settings/Types";

export type SettingsApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getSettingsApiContext(
  request: Request,
): Promise<SettingsApiContext | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;
  try {
    return { userId: session.user.id, role: toEffectiveRole(session.user) };
  } catch {
    return null;
  }
}

const statusByError: Record<SettingsErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  CONFIRMATION_REQUIRED: 409,
  // Enqueue failure is reported as 202 + code on the PUT happy path; this maps
  // thrown QUEUE_FAILED domain errors if any caller raises them.
  QUEUE_FAILED: 202,
};

export function settingsResponse<T>(body: T, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function settingsApiError(error: unknown): NextResponse {
  if (error instanceof SettingsDomainError) {
    return settingsResponse(
      {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
      statusByError[error.code],
    );
  }
  if (error instanceof ZodError) {
    return settingsResponse(
      { error: "Invalid site settings", code: "VALIDATION_ERROR" },
      422,
    );
  }
  return settingsResponse(
    { error: "Unable to load site settings", code: "INTERNAL_ERROR" },
    500,
  );
}

export function stripSettingsClientFields(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const payload = { ...(value as Record<string, unknown>) };
  delete payload.userId;
  delete payload.role;
  delete payload.cloudflareApiTokenEncrypted;
  delete payload.cloudflareApiTokenConfigured;
  delete payload.homePage;
  delete payload.favicon;
  return payload;
}
