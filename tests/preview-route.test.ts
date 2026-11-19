import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getPreviewBySlug = vi.hoisted(() => vi.fn());
const compilePreviewHtml = vi.hoisted(() => vi.fn());
const shouldRedirectPreviewToPublic = vi.hoisted(() => vi.fn());
const isPreviewRequestAllowed = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession } },
}));

vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: {
    getPreviewBySlug,
    compilePreviewHtml,
    shouldRedirectPreviewToPublic,
  },
}));

vi.mock("@/lib/Modules/Pages/PreviewRateLimit", () => ({
  isPreviewRequestAllowed,
}));

function previewRequest(method: "GET" | "HEAD" = "GET") {
  return new Request("http://localhost:3000/p/draft-page", { method });
}

const context = { params: Promise.resolve({ slug: "draft-page" }) };

describe("private preview route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "user-1" } });
    isPreviewRequestAllowed.mockResolvedValue(true);
    getPreviewBySlug.mockResolvedValue({
      id: "page-1",
      slug: "draft-page",
      status: "DRAFT",
    });
    shouldRedirectPreviewToPublic.mockResolvedValue(false);
    compilePreviewHtml.mockResolvedValue("<html>draft</html>");
  });

  it("does not compile HTML for HEAD", async () => {
    const { HEAD } = await import("@/app/p/[slug]/route");
    const response = await HEAD(previewRequest("HEAD"), context);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(compilePreviewHtml).not.toHaveBeenCalled();
    expect(getPreviewBySlug).toHaveBeenCalledWith("draft-page");
  });

  it("compiles HTML only for GET", async () => {
    const { GET } = await import("@/app/p/[slug]/route");
    const response = await GET(previewRequest("GET"), context);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>draft</html>");
    expect(compilePreviewHtml).toHaveBeenCalledOnce();
  });

  it("returns 429 before looking up the page when the preview bucket is exhausted", async () => {
    isPreviewRequestAllowed.mockResolvedValueOnce(false);
    const { GET } = await import("@/app/p/[slug]/route");
    const response = await GET(previewRequest("GET"), context);

    expect(response.status).toBe(429);
    expect(getPreviewBySlug).not.toHaveBeenCalled();
    expect(compilePreviewHtml).not.toHaveBeenCalled();
  });
});
