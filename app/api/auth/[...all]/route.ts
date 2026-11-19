import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import {
  isAuthRequestAllowed,
  isEmailSignInRequest,
} from "@/lib/auth-rate-limit";
import { env } from "@/lib/env";
import { getPanelDictionary } from "@/lib/i18n/panel";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

export async function POST(request: Request): Promise<Response> {
  if (isEmailSignInRequest(request) && !(await isAuthRequestAllowed(request))) {
    const dictionary = getPanelDictionary(env.PANEL_LANGUAGE);
    return Response.json(
      { message: dictionary.login.tooManyAttempts },
      {
        status: 429,
        headers: { "Retry-After": "60" },
      },
    );
  }

  return handlers.POST(request);
}

export const PATCH = handlers.PATCH;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
