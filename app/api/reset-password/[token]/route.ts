import { usersApiError, usersPublicResponse } from "@/lib/Modules/Users/Api";
import { usersService } from "@/lib/Modules/Users/Service";
import { isUserTokenRequestAllowed } from "@/lib/Modules/Users/RateLimit";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (!(await isUserTokenRequestAllowed(request, token))) {
    return usersPublicResponse(
      { error: "Too many requests", code: "RATE_LIMITED" },
      429,
    );
  }

  try {
    const reset = await usersService.getPasswordResetMeta(token);
    return usersPublicResponse({ reset });
  } catch (error) {
    return usersApiError(error);
  }
}
