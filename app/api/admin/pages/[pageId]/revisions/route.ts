import { NextResponse } from "next/server";

import { getPageApiContext } from "@/lib/Modules/Pages/Api";
import { pageService } from "@/lib/Modules/Pages/Service";
import { revisionListQuerySchema } from "@/lib/Modules/Revisions/Schema";
import { revisionApiError, revisionService } from "@/lib/Modules/Revisions/Api";

type RouteContext = { params: Promise<{ pageId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getPageApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { pageId } = await context.params;
    const page = await pageService.getPage(pageId);
    const query = revisionListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      return NextResponse.json(
        { error: "Invalid revision query", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    const revisions = await revisionService().listPageRevisions({
      pageId: page.id,
      publishedRevisionId: page.publishedRevisionId ?? null,
      page: query.data.page,
      pageSize: query.data.pageSize,
    });
    return NextResponse.json(revisions);
  } catch (error) {
    return revisionApiError(error);
  }
}
