import { NextResponse } from "next/server";

import { getMediaApiContext, mediaApiError } from "@/lib/Modules/Media/Api";
import { mediaFolderService } from "@/lib/Modules/Media/FolderService";
import { mediaService } from "@/lib/Modules/Media/Service";
import type { MediaFileRecord } from "@/lib/Modules/Media/Types";
import {
  assertPanelMultipartLength,
  PanelMutationBodyError,
  panelMutationBodyErrorResponse,
  requireTrustedPanelMutation,
} from "@/lib/Modules/Panel/MutationSecurity";

const MAX_MULTIPART_FILE_BYTES = 200 * 1024 * 1024;

function parseStatus(
  value: string | null,
): MediaFileRecord["processingStatus"] | undefined {
  if (value === "PROCESSING" || value === "READY" || value === "FAILED")
    return value;
  return undefined;
}

function getTextField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

export async function GET(request: Request) {
  const context = await getMediaApiContext(request);
  if (!context)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const searchParams = new URL(request.url).searchParams;
    const folderId = searchParams.get("folderId") ?? undefined;
    const pageRaw = searchParams.get("page");
    const pageSizeRaw = searchParams.get("pageSize");
    const listOpts = {
      folderId,
      // Scope 3 — pasta-mãe agrega mídias das subpastas.
      includeDescendants: Boolean(folderId),
      search: searchParams.get("q") ?? undefined,
      processingStatus: parseStatus(searchParams.get("status")),
    };

    // page/pageSize → paginado (UI infinite scroll); sem → lista completa (picker/MCP legado).
    if (pageRaw != null || pageSizeRaw != null) {
      const page = Math.max(1, Number.parseInt(pageRaw ?? "1", 10) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number.parseInt(pageSizeRaw ?? "8", 10) || 8),
      );
      const [result, folders] = await Promise.all([
        mediaService.listMediaPaginated({ ...listOpts, page, pageSize }),
        mediaFolderService.listFolders(),
      ]);
      return NextResponse.json({
        media: result.items,
        folders,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    }

    const [media, folders] = await Promise.all([
      mediaService.listMedia(listOpts),
      mediaFolderService.listFolders(),
    ]);
    return NextResponse.json({ media, folders });
  } catch (error) {
    return mediaApiError(error);
  }
}

export async function POST(request: Request) {
  const gate = await requireTrustedPanelMutation(request);
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    assertPanelMultipartLength(request, MAX_MULTIPART_FILE_BYTES);
    form = await request.formData();
  } catch (error) {
    if (error instanceof PanelMutationBodyError) {
      return panelMutationBodyErrorResponse(error);
    }
    return NextResponse.json(
      { error: "Invalid multipart form data", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  const folderId = form.get("folderId");
  const files = form
    .getAll("files")
    .filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    const singleFile = form.get("file");
    if (singleFile instanceof File) files.push(singleFile);
  }

  if (typeof folderId !== "string" || !folderId.trim() || files.length === 0) {
    return NextResponse.json(
      {
        error: "A folder and at least one file are required",
        code: "VALIDATION_ERROR",
      },
      { status: 400 },
    );
  }

  try {
    const result = await mediaService.uploadMany(
      gate.userId,
      await Promise.all(
        files.map(async (file) => ({
          folderId,
          fileName: file.name,
          buffer:
            file.size > MAX_MULTIPART_FILE_BYTES
              ? Buffer.alloc(0)
              : Buffer.from(await file.arrayBuffer()),
          sizeBytes: file.size,
          alt: getTextField(form, "alt"),
          description: getTextField(form, "description"),
        })),
      ),
    );
    return NextResponse.json(result, {
      status: result.errors.length ? 207 : 201,
    });
  } catch (error) {
    return mediaApiError(error);
  }
}
