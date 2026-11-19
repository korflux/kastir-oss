import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { PREVIEW_HEADERS } from "@/lib/Modules/Pages/PreviewHeaders";
import { isPreviewRequestAllowed } from "@/lib/Modules/Pages/PreviewRateLimit";
import { getPublishedPagePath } from "@/lib/Modules/Pages/publicUrl";
import { pageService } from "@/lib/Modules/Pages/Service";
import { PagesDomainError } from "@/lib/Modules/Pages/Types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

function loginRedirect(request: Request, slug: string): NextResponse {
  const login = new URL("/admin/login", request.url);
  login.searchParams.set("next", `/p/${slug}`);
  return NextResponse.redirect(login, 302);
}

async function handlePreview(
  request: Request,
  context: RouteContext,
  method: "GET" | "HEAD",
): Promise<NextResponse> {
  const { slug } = await context.params;

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return loginRedirect(request, slug);
  }

  if (!(await isPreviewRequestAllowed(request, session.user.id))) {
    return new NextResponse(null, {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": "60",
      },
    });
  }

  try {
    const page = await pageService.getPreviewBySlug(slug);

    // Publicado idêntico ao rascunho → URL pública; rascunho sujo fica em /p/.
    if (await pageService.shouldRedirectPreviewToPublic(page)) {
      return NextResponse.redirect(
        new URL(getPublishedPagePath(page.slug), request.url),
        302,
      );
    }

    // HEAD só precisa do status/headers — recompilar o rascunho é CPU à toa.
    if (method === "HEAD") {
      return new NextResponse(null, { status: 200, headers: PREVIEW_HEADERS });
    }

    const html = await pageService.compilePreviewHtml(page);
    return new NextResponse(html, {
      status: 200,
      headers: PREVIEW_HEADERS,
    });
  } catch (error) {
    if (error instanceof PagesDomainError && error.code === "NOT_FOUND") {
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }
}

export function GET(request: Request, context: RouteContext) {
  return handlePreview(request, context, "GET");
}

export function HEAD(request: Request, context: RouteContext) {
  return handlePreview(request, context, "HEAD");
}
