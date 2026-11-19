import { NextResponse } from "next/server";

import { createPageFileStore } from "@/lib/Publishing/fileStore";
import { readPublicArtifact } from "@/lib/Publishing/publicArtifacts";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string[] }> };

// Nginx serves these files directly in the production container. This route
// keeps the canonical clean URL usable with the repository's `pnpm dev` E2E
// server, which runs Next without the production reverse proxy.
const pageFileStore = createPageFileStore();
const textArtifacts = new Map([
  ["robots.txt", "text/plain; charset=utf-8"],
  ["sitemap.xml", "application/xml; charset=utf-8"],
  ["llms.txt", "text/plain; charset=utf-8"],
]);

async function responseForPublishedPage(
  request: Request,
  context: RouteContext,
  method: "GET" | "HEAD",
): Promise<NextResponse> {
  const { slug } = await context.params;
  if (slug.length !== 1) return new NextResponse(null, { status: 404 });

  let content: string | null;
  const artifactContentType = textArtifacts.get(slug[0]);
  try {
    // Artefatos e páginas compartilham o volume PUBLIC_DIR; no servidor Next
    // esta rota reproduz o `try_files` que o Nginx faz em produção.
    content = artifactContentType
      ? await readPublicArtifact(slug[0])
      : await pageFileStore.read(slug[0]);
  } catch {
    content = null;
  }
  if (content === null) return new NextResponse(null, { status: 404 });

  return new NextResponse(method === "HEAD" ? null : content, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": artifactContentType ?? "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Kastir-Served-By": "next-dev-public",
      "X-Kastir-Request-Path": new URL(request.url).pathname,
    },
  });
}

export function GET(request: Request, context: RouteContext) {
  return responseForPublishedPage(request, context, "GET");
}

export function HEAD(request: Request, context: RouteContext) {
  return responseForPublishedPage(request, context, "HEAD");
}
