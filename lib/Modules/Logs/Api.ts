import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  LogsDomainError,
  type LogsDomainErrorCode,
} from "@/lib/Modules/Logs/Service";

export type LogsApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getLogsApiContext(
  request: Request,
): Promise<LogsApiContext | null> {
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

const statusByError: Record<LogsDomainErrorCode, number> = {
  FORBIDDEN: 403,
};

export function logsResponse<T>(body: T, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function logsApiError(error: unknown): NextResponse {
  if (error instanceof LogsDomainError) {
    return logsResponse(
      { error: error.message, code: error.code },
      statusByError[error.code],
    );
  }

  if (error instanceof ZodError) {
    return logsResponse(
      { error: "Invalid log filters", code: "VALIDATION_ERROR" },
      422,
    );
  }

  return logsResponse(
    { error: "Unable to load audit logs", code: "INTERNAL_ERROR" },
    500,
  );
}
