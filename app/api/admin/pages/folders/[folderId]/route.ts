import { NextResponse } from "next/server";

import {
  pageApiError,
  stripClientControlledFields,
} from "@/lib/Modules/Pages/Api";
import { requireTrustedPanelMutation } from "@/lib/Modules/Panel/MutationSecurity";
import { folderService } from "@/lib/Modules/Pages/FolderService";

type RouteContext = { params: Promise<{ folderId: string }> };

function asObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export async function PUT(request: Request, context: RouteContext) {
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
    const { folderId } = await context.params;
    const body = asObject(payload);

    // Scope 3 — move via newParentId no PUT (sem rota extra).
    if ("newParentId" in body) {
      const folder = await folderService.moveFolder(gate.userId, {
        id: folderId,
        newParentId: body.newParentId ?? null,
      });
      return NextResponse.json({ folder });
    }

    const folder = await folderService.updateFolder(gate.userId, {
      ...body,
      id: folderId,
    });
    return NextResponse.json({ folder });
  } catch (error) {
    return pageApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  let payload: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      payload = stripClientControlledFields(JSON.parse(text) as unknown);
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  try {
    const { folderId } = await context.params;
    const body = asObject(payload);
    await folderService.deleteFolder(gate.userId, {
      id: folderId,
      reassignToFolderId: body.reassignToFolderId,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return pageApiError(error);
  }
}
