import { NextResponse } from "next/server";

import { getCustomCodeApiContext } from "@/lib/Modules/CustomCode/Api";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";
import { revisionListQuerySchema } from "@/lib/Modules/Revisions/Schema";
import { revisionApiError, revisionService } from "@/lib/Modules/Revisions/Api";

type RouteContext = { params: Promise<{ snippetId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getCustomCodeApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { snippetId } = await context.params;
    const snippet = await customCodeService.getSnippet(snippetId);
    const query = revisionListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      return NextResponse.json(
        { error: "Invalid revision query", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    const revisions = await revisionService().listSnippetRevisions({
      snippetId: snippet.id,
      publishedRevisionId: snippet.publishedRevisionId ?? null,
      page: query.data.page,
      pageSize: query.data.pageSize,
    });
    return NextResponse.json(revisions);
  } catch (error) {
    return revisionApiError(error);
  }
}
