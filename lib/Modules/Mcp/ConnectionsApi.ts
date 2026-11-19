import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import {
  McpAuthorizationError,
  McpConnectionNotFoundError,
} from "@/lib/Modules/Mcp/Errors";

export type McpConnectionsApiContext = {
  userId: string;
  role: "MASTER" | "ADMIN" | "EDITOR";
};

export async function getMcpConnectionsApiContext(
  request: Request,
): Promise<McpConnectionsApiContext | null> {
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

export function mcpConnectionsError(error: unknown): NextResponse {
  if (
    error instanceof McpAuthorizationError ||
    error instanceof McpConnectionNotFoundError
  ) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      error: "Unable to complete the MCP connection operation",
      code: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}

export function mcpConnectionsResponse<T>(body: T, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
