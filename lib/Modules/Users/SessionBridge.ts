import { auth } from "@/lib/auth";

type HeadersWithGetSetCookie = Headers & {
  getSetCookie?: () => string[];
};

export type SessionBridgeResult = {
  success: boolean;
  setCookies: string[];
};

function responseCookies(response: Response): string[] {
  const headers = response.headers as HeadersWithGetSetCookie;
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const cookie = response.headers.get("set-cookie");
  return cookie ? [cookie] : [];
}

/**
 * Signs the just-created credential in through Better Auth and returns only
 * the cookie headers needed by the public route response.
 */
export async function signInAndForwardCookies(
  request: Request,
  email: string,
  password: string,
): Promise<SessionBridgeResult> {
  try {
    const response = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
      asResponse: true,
    });

    if (!(response instanceof Response) || !response.ok) {
      return { success: false, setCookies: [] };
    }

    return { success: true, setCookies: responseCookies(response) };
  } catch {
    return { success: false, setCookies: [] };
  }
}
