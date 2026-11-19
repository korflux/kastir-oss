import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { validateMcpOAuthResourceRequest } from "@/lib/Modules/Mcp/OAuthResourcePolicy";

const handlers = toNextJsHandler(auth);

export async function GET(request: Request): Promise<Response> {
  const resourceError = await validateMcpOAuthResourceRequest(request);
  return resourceError ?? handlers.GET(request);
}
