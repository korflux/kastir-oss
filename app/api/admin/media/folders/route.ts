import { NextResponse } from "next/server";

import {
  getMediaApiContext,
  mediaApiError,
  stripClientControlledFields,
} from "@/lib/Modules/Media/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { mediaFolderService } from "@/lib/Modules/Media/FolderService";

export async function GET(request: Request) {
  const context = await getMediaApiContext(request);
  if (!context)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({
      folders: await mediaFolderService.listFolders(),
    });
  } catch (error) {
    return mediaApiError(error);
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
    const folder = await mediaFolderService.createFolder(gate.userId, payload);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    return mediaApiError(error);
  }
}
