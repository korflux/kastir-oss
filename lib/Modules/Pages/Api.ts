import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  PagesDomainError,
  type PageDomainErrorCode,
} from "@/lib/Modules/Pages/Types";

export type PageApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getPageApiContext(
  request: Request,
): Promise<PageApiContext | null> {
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

const statusByError: Record<PageDomainErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  INVALID_STATE: 409,
  BASE_FOLDER_PROTECTED: 409,
  FOLDER_DEPTH_EXCEEDED: 422,
};

export function pageApiError(error: unknown): NextResponse {
  if (error instanceof PagesDomainError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: statusByError[error.code] },
    );
  }

  return NextResponse.json(
    { error: "Unable to complete the page operation", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export function stripClientControlledFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const payload = { ...(value as Record<string, unknown>) };
  delete payload.authorId;
  delete payload.role;
  return payload;
}
