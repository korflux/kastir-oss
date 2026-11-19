import { mediaService } from "@/lib/Modules/Media/Service";
import { createMediaStorage } from "@/lib/Processing/mediaStorage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ mediaId: string; fileName: string }>;
};

/** Resposta uniforme para arquivo ausente, não pronto ou caminho divergente. */
function unavailable(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Serve uploads no runtime Next usado em desenvolvimento/E2E. Em produção o
 * Nginx entrega o mesmo volume diretamente, sem passar por esta rota.
 */
export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { mediaId, fileName } = await context.params;

  try {
    const media = await mediaService.getMedia(mediaId);
    if (
      media.fileName !== fileName ||
      !(await mediaService.hasPublicBytes(media))
    ) {
      return unavailable();
    }

    const bytes = await createMediaStorage().readPublic(mediaId, fileName);
    if (!bytes) return unavailable();

    return new Response(new Uint8Array(bytes) as unknown as BodyInit, {
      headers: {
        "cache-control": "public, no-cache",
        "content-length": String(bytes.byteLength),
        "content-type": media.mimeType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}
