import { NextResponse } from "next/server";

import { getPageApiContext } from "@/lib/Modules/Pages/Api";
import { pageService } from "@/lib/Modules/Pages/Service";
import { revisionApiError, revisionService } from "@/lib/Modules/Revisions/Api";

type RouteContext = {
  params: Promise<{ pageId: string; revisionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const apiContext = await getPageApiContext(_request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { pageId, revisionId } = await context.params;
    await pageService.getPage(pageId);
    const revision = await revisionService().getPageRevisionForPage(
      revisionId,
      pageId,
    );
    return NextResponse.json({ revision });
  } catch (error) {
    return revisionApiError(error);
  }
}
