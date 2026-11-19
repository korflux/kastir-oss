import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";

import { resolveClientIp } from "@/lib/auth-rate-limit";
import { isAdReviewCrawler } from "@/lib/Modules/SplitTests/adCrawlers";
import { redirectService } from "@/lib/Modules/SplitTests/RedirectService";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * Public split redirect.
 * External Location targets are intentional (admin-configured campaign destinations).
 */
async function resolveRedirect(request: NextRequest, context: RouteContext) {
  const { slug } = await context.params;
  return redirectService.resolve(slug, request.nextUrl.searchParams);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const result = await resolveRedirect(request, context);

  if (result.status === 404) {
    return new NextResponse(null, { status: 404 });
  }

  // Meta ad-review/link-preview crawlers issue a real GET — they need a valid
  // 307 but must not pollute hitCount / SplitRedirectEvent / Redis counters.
  const isCrawler = isAdReviewCrawler(request.headers.get("user-agent"));
  if (!isCrawler) {
    // The redirect is the user-facing critical path. Next keeps this callback
    // alive after the response while Redis/Postgres telemetry completes.
    after(() =>
      redirectService
        .recordHit(
          result.campaignId,
          result.destinationId,
          result.recordCounters,
          resolveClientIp(request),
        )
        .catch((error) => {
          console.error(
            "[Kastir] Split hit recording failed",
            error instanceof Error ? error.message : error,
          );
        }),
    );
  }

  return NextResponse.redirect(result.location, 307);
}

/** HEAD resolves the same Location but does not count as a hit (healthchecks/bots). */
export async function HEAD(request: NextRequest, context: RouteContext) {
  const result = await resolveRedirect(request, context);

  if (result.status === 404) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(null, {
    status: 307,
    headers: { Location: result.location },
  });
}

export async function POST() {
  return new NextResponse(null, {
    status: 405,
    headers: { Allow: "GET, HEAD" },
  });
}
