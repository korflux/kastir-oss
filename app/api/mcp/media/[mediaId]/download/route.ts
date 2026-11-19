import { createMediaStorage } from "@/lib/Processing/mediaStorage";
import { mediaService } from "@/lib/Modules/Media/Service";
import { isValidMcpMediaDownloadSignature } from "@/lib/Modules/Mcp/MediaDownload";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ mediaId: string }>;
};

function unavailable(): Response {
  return Response.json(
    {
      error: { code: "NOT_FOUND", message: "Media download is not available" },
    },
    {
      status: 404,
      headers: {
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { mediaId } = await context.params;
  const url = new URL(request.url);
  if (
    !isValidMcpMediaDownloadSignature(
      mediaId,
      url.searchParams.get("expires"),
      url.searchParams.get("sig"),
    )
  ) {
    return unavailable();
  }

  try {
    const media = await mediaService.getMedia(mediaId);
    if (!(await mediaService.hasPublicBytes(media))) return unavailable();

    const bytes = await createMediaStorage().readPublic(
      media.id,
      media.fileName,
    );
    if (!bytes) return unavailable();

    const fileName = media.fileName.replace(/["\r\n]/g, "_");
    return new Response(new Uint8Array(bytes) as unknown as BodyInit, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${fileName}"`,
        "content-length": String(bytes.byteLength),
        "content-type": media.mimeType,
        "referrer-policy": "no-referrer",
        vary: "authorization",
      },
    });
  } catch {
    return unavailable();
  }
}
