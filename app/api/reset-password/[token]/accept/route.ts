import {
  usersApiError,
  readJson,
  usersPublicResponse,
} from "@/lib/Modules/Users/Api";
import { usersService } from "@/lib/Modules/Users/Service";
import { isUserTokenAcceptAllowed } from "@/lib/Modules/Users/RateLimit";

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
    await usersService.resetPassword(token, await readJson(request));
    return usersPublicResponse({ ok: true });
  } catch (error) {
    return usersApiError(error);
  }
}
