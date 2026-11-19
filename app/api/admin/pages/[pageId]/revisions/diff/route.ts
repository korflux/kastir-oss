import { NextResponse } from "next/server";

import { getPageApiContext } from "@/lib/Modules/Pages/Api";
import { toPageSnapshot } from "@/lib/Modules/Pages/lifecycle";
import { pageService } from "@/lib/Modules/Pages/Service";
import { revisionDiffQuerySchema } from "@/lib/Modules/Revisions/Schema";
import { revisionApiError, revisionService } from "@/lib/Modules/Revisions/Api";

type RouteContext = { params: Promise<{ pageId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getPageApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { pageId } = await context.params;
    const page = await pageService.getPage(pageId);
    const query = revisionDiffQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      return NextResponse.json(
        { error: "Invalid revision query", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    const diff = await revisionService().diffPageRevision({
      pageId: page.id,
      fromRevisionId: query.data.from,
      to:
        query.data.to === "draft"
          ? { kind: "draft", snapshot: toPageSnapshot(page) }
          : { kind: "revision", revisionId: query.data.to },
    });
    return NextResponse.json(diff);
  } catch (error) {
    return revisionApiError(error);
  }
}
