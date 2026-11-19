import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  UsersDomainError,
  type UsersDomainErrorCode,
} from "@/lib/Modules/Users/Types";

export type UsersApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getUsersApiContext(
  request: Request,
): Promise<UsersApiContext | null> {
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

const statusByError: Record<UsersDomainErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INVALID_TOKEN: 400,
  INVALID_STATE: 409,
};

function applyUsersSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Shared JSON response for public invite/reset routes. */
export function usersPublicResponse<T>(body: T, status = 200): NextResponse {
  return applyUsersSecurityHeaders(NextResponse.json(body, { status }));
}

export function usersApiError(error: unknown): NextResponse {
  if (error instanceof UsersDomainError) {
    return applyUsersSecurityHeaders(
      NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusByError[error.code] },
      ),
    );
  }

  if (error instanceof ZodError) {
    return applyUsersSecurityHeaders(
      NextResponse.json(
        { error: "Invalid user data", code: "VALIDATION_ERROR" },
        { status: 422 },
      ),
    );
  }

  return applyUsersSecurityHeaders(
    NextResponse.json(
      {
        error: "Unable to complete the user operation",
        code: "INTERNAL_ERROR",
      },
      { status: 500 },
    ),
  );
}

export function usersApiForbidden(): NextResponse {
  return usersPublicResponse({ error: "Forbidden", code: "FORBIDDEN" }, 403);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UsersDomainError("VALIDATION_ERROR", "Invalid JSON");
  }
}
