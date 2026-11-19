import { NextResponse } from "next/server";

import {
  getPageApiContext,
  pageApiError,
  stripClientControlledFields,
} from "@/lib/Modules/Pages/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { folderService } from "@/lib/Modules/Pages/FolderService";

export async function GET(request: Request) {
  const context = await getPageApiContext(request);
  if (!context)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ folders: await folderService.listFolders() });
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
    const folder = await folderService.createFolder(gate.userId, payload);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    return pageApiError(error);
  }
}
