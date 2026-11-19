import { NextResponse } from "next/server";

import {
  customCodeApiError,
  getCustomCodeApiContext,
} from "@/lib/Modules/CustomCode/Api";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";

type RouteContext = { params: Promise<{ snippetId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getCustomCodeApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { snippetId } = await context.params;
    const selectors = await customCodeService.getScopeSelectors(snippetId);
    return NextResponse.json({ selectors });
  } catch (error) {
    return customCodeApiError(error);
  }
}
