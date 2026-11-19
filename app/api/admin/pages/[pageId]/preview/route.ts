import { getPageApiContext, pageApiError } from "@/lib/Modules/Pages/Api";
import { pageService } from "@/lib/Modules/Pages/Service";

export async function GET(
  request: Request,
  context: { params: Promise<{ pageId: string }> },
) {
  const apiContext = await getPageApiContext(request);
  if (!apiContext) return new Response("Unauthorized", { status: 401 });

  try {
    const { pageId } = await context.params;
    const page = await pageService.getPage(pageId);
    return new Response(page.content, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-security-policy":
          "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:",
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return pageApiError(error);
  }
}
