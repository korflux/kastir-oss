import { NextResponse } from "next/server";

import {
  getPageApiContext,
  pageApiError,
  stripClientControlledFields,
} from "@/lib/Modules/Pages/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { folderService } from "@/lib/Modules/Pages/FolderService";
import { listPagesQuerySchema } from "@/lib/Modules/Pages/Schema";
import { pageService } from "@/lib/Modules/Pages/Service";

export async function GET(request: Request) {
  const context = await getPageApiContext(request);
  if (!context)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const params = new URL(request.url).searchParams;
    const query = listPagesQuerySchema.parse({
      search: params.get("search") ?? undefined,
      trash: params.get("trash") ?? undefined,
    });
    const [pages, folders] = await Promise.all([
      pageService.listPages({
        includeDeleted: query.trash,
        search: query.search,
      }),
      folderService.listFolders(),
    ]);
    return NextResponse.json({ pages, folders });
  } catch (error) {
    return pageApiError(error);
  }
}

export async function POST(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  let payload: unknown;
  try {
    payload = stripClientControlledFields(await request.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  try {
    const page = await pageService.createPage(gate.userId, payload);
    return NextResponse.json({ page }, { status: 201 });
  } catch (error) {
    return pageApiError(error);
  }
}
