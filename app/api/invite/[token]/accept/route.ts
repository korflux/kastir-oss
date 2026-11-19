import {
  usersApiError,
  readJson,
  usersPublicResponse,
} from "@/lib/Modules/Users/Api";
import { acceptInviteSchema } from "@/lib/Modules/Users/Schema";
import { usersService } from "@/lib/Modules/Users/Service";
import { UsersDomainError } from "@/lib/Modules/Users/Types";
import { isUserTokenAcceptAllowed } from "@/lib/Modules/Users/RateLimit";
import { signInAndForwardCookies } from "@/lib/Modules/Users/SessionBridge";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (!(await isUserTokenAcceptAllowed(request, token))) {
    return usersPublicResponse(
      { error: "Too many requests", code: "RATE_LIMITED" },
      429,
    );
  }

  try {
    const payload = await readJson(request);
    const parsed = acceptInviteSchema.safeParse(payload);
    if (!parsed.success) {
      throw new UsersDomainError("VALIDATION_ERROR", "Invalid user data");
    }

    const user = await usersService.acceptInvite(token, parsed.data);
    const bridge = await signInAndForwardCookies(
      request,
      parsed.data.email,
      parsed.data.password,
    );

    if (!bridge.success) {
      return usersPublicResponse(
        {
          error:
            "Account created, but automatic sign-in failed. Use the admin login page.",
          code: "SESSION_BRIDGE_FAILED",
        },
        503,
      );
    }

    const response = usersPublicResponse({ user }, 201);
    for (const cookie of bridge.setCookies) {
      response.headers.append("set-cookie", cookie);
    }
    return response;
  } catch (error) {
    return usersApiError(error);
  }
}
