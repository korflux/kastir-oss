import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  SplitTestsDomainError,
  type SplitTestsDomainErrorCode,
} from "@/lib/Modules/SplitTests/Types";

export type SplitTestsApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getSplitTestsApiContext(
  request: Request,
): Promise<SplitTestsApiContext | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;

  try {
    return { userId: session.user.id, role: toEffectiveRole(session.user) };
  } catch {
    return null;
  }
}

const statusByError: Record<SplitTestsDomainErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  FORBIDDEN: 403,
};

export function splitTestsApiError(error: unknown): NextResponse {
  if (error instanceof SplitTestsDomainError) {
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
      error: "Unable to complete the split test operation",
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
  delete payload.hitCount;
  delete payload.id;
  delete payload.createdAt;
  delete payload.updatedAt;
  return payload;
}
