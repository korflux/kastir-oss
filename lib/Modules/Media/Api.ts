import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  MediaDomainError,
  type MediaDomainErrorCode,
} from "@/lib/Modules/Media/Types";

export type MediaApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getMediaApiContext(
  request: Request,
): Promise<MediaApiContext | null> {
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

const statusByError: Record<MediaDomainErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  BASE_FOLDER_PROTECTED: 409,
  FOLDER_DEPTH_EXCEEDED: 422,
  UPLOAD_FAILED: 422,
};

export function mediaApiError(error: unknown): NextResponse {
  if (error instanceof MediaDomainError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: statusByError[error.code] },
    );
  }

  return NextResponse.json(
    { error: "Unable to complete the media operation", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export function stripClientControlledFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const payload = { ...(value as Record<string, unknown>) };
  delete payload.userId;
  delete payload.authorId;
  delete payload.role;
  return payload;
}
