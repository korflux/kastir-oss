import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  CustomCodeDomainError,
  type CustomCodeDomainErrorCode,
} from "@/lib/Modules/CustomCode/Types";

export type CustomCodeApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getCustomCodeApiContext(
  request: Request,
): Promise<CustomCodeApiContext | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;

  try {
    return { userId: session.user.id, role: toEffectiveRole(session.user) };
  } catch {
    return null;
  }
}

const statusByError: Record<CustomCodeDomainErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  FORBIDDEN: 403,
  CONFIRMATION_REQUIRED: 409,
  QUEUE_FAILED: 503,
};

export function customCodeApiError(error: unknown): NextResponse {
  if (error instanceof CustomCodeDomainError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: statusByError[error.code] },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid query", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      error: "Unable to complete the custom code operation",
      code: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}

export function stripClientControlledFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const payload = { ...(value as Record<string, unknown>) };
  delete payload.userId;
  delete payload.authorId;
  delete payload.role;
  delete payload.status;
  return payload;
}
