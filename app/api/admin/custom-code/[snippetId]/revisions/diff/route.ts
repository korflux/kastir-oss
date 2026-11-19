import { NextResponse } from "next/server";

import { getCustomCodeApiContext } from "@/lib/Modules/CustomCode/Api";
import { toSnippetRevisionSnapshot } from "@/lib/Modules/CustomCode/lifecycle";
import { customCodeService } from "@/lib/Modules/CustomCode/Service";
import { revisionDiffQuerySchema } from "@/lib/Modules/Revisions/Schema";
import { revisionApiError, revisionService } from "@/lib/Modules/Revisions/Api";

type RouteContext = { params: Promise<{ snippetId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const apiContext = await getCustomCodeApiContext(request);
  if (!apiContext)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { snippetId } = await context.params;
    const snippet = await customCodeService.getSnippet(snippetId);
    const query = revisionDiffQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      return NextResponse.json(
        { error: "Invalid revision query", code: "VALIDATION_ERROR" },
        { status: 400 },
      );
    }
    const diff = await revisionService().diffSnippetRevision({
      snippetId: snippet.id,
      fromRevisionId: query.data.from,
      to:
        query.data.to === "draft"
          ? { kind: "draft", snapshot: toSnippetRevisionSnapshot(snippet) }
          : { kind: "revision", revisionId: query.data.to },
    });
    return NextResponse.json(diff);
  } catch (error) {
    return revisionApiError(error);
  }
}
