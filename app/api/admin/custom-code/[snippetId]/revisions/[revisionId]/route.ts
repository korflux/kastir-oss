import { NextResponse } from "next/server";

import { getCustomCodeApiContext } from "@/lib/Modules/CustomCode/Api";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";
import { revisionApiError, revisionService } from "@/lib/Modules/Revisions/Api";

type RouteContext = {
  params: Promise<{ snippetId: string; revisionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getCustomCodeApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { snippetId, revisionId } = await context.params;
    await customCodeService.getSnippet(snippetId);
    const revision = await revisionService().getSnippetRevisionForSnippet(
      revisionId,
      snippetId,
    );
    return NextResponse.json({ revision });
  } catch (error) {
    return revisionApiError(error);
  }
}
