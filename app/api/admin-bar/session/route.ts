import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { normalizePublicBarLocale } from "@/lib/i18n/publicBar";
import { env } from "@/lib/env";
import { toEffectiveRole } from "@/lib/Modules/Panel/Permissions";
import { checkAdminBarRateLimit } from "@/lib/Modules/Panel/PublicBarRateLimit";

function response<T>(body: T, status = 200): NextResponse {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const sessionUserId =
      typeof session?.user?.id === "string" && session.user.id.length > 0
        ? session.user.id
        : null;
    const rateLimit = await checkAdminBarRateLimit(request, sessionUserId);

    if (rateLimit.unavailable) {
      return response(
        { error: "Service unavailable", code: "RATE_LIMIT_UNAVAILABLE" },
        503,
      );
    }

    if (!rateLimit.allowed) {
      return response(
        { error: "Too many requests", code: "RATE_LIMITED" },
        429,
      );
    }

    if (!session?.user || !sessionUserId) {
      // The published bundle probes this endpoint for every visitor. An empty
      // successful DTO avoids a noisy 401 in the browser console while keeping
      // the response private and uncached.
      return response({
        user: null,
        locale: normalizePublicBarLocale(env.PANEL_LANGUAGE),
      });
    }

    if (
      typeof session.user.name !== "string" ||
      session.user.name.length === 0
    ) {
      return response({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    }

    let role: ReturnType<typeof toEffectiveRole>;
    try {
      role = toEffectiveRole(session.user);
    } catch {
      return response({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    }

    return response({
      user: {
        id: sessionUserId,
        name: session.user.name,
        role,
      },
      locale: normalizePublicBarLocale(env.PANEL_LANGUAGE),
    });
  } catch {
    return response(
      { error: "Service unavailable", code: "SERVICE_UNAVAILABLE" },
      503,
    );
  }
}
