import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { auth } from "@/lib/auth";
import {
  BackupDomainError,
  type BackupDomainErrorCode,
} from "@/lib/Modules/Backup/Service";
import { PackageReaderError } from "@/lib/Modules/Backup/PackageReader";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";

export type BackupApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getBackupApiContext(
  request: Request,
): Promise<BackupApiContext | null> {
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

const statusByError: Record<BackupDomainErrorCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  CONFIRMATION_REQUIRED: 400,
  INCOMPATIBLE: 409,
  PACKAGE_INVALID: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export function backupResponse<T>(body: T, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function backupApiError(error: unknown): NextResponse {
  if (error instanceof BackupDomainError) {
    return backupResponse(
      { error: error.message, code: error.code },
      statusByError[error.code],
    );
  }

  if (error instanceof PackageReaderError) {
    return backupResponse({ error: error.message, code: error.code }, 422);
  }

  if (
    error instanceof Error &&
    (error as Error & { code?: string }).code === "RATE_LIMITED"
  ) {
    return backupResponse({ error: error.message, code: "RATE_LIMITED" }, 429);
  }

  if (error instanceof ZodError) {
    return backupResponse(
      { error: "Invalid backup request", code: "VALIDATION_ERROR" },
      422,
    );
  }

  return backupResponse(
    { error: "Backup operation failed", code: "INTERNAL_ERROR" },
    500,
  );
}
