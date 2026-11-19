import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
const pageService = vi.hoisted(() => ({
  trashPage: vi.fn(),
  restorePage: vi.fn(),
  permanentlyDeletePage: vi.fn(),
}));
const customCodeService = vi.hoisted(() => ({
  trashSnippet: vi.fn(),
  restoreSnippet: vi.fn(),
}));
const splitTestsService = vi.hoisted(() => ({
  permanentlyDeleteCampaign: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/Pages/Service", () => ({ pageService }));
vi.mock("@/lib/Modules/CustomCode/Service", () => ({ customCodeService }));
vi.mock("@/lib/Modules/SplitTests/Service", () => ({ splitTestsService }));

import { DELETE as trashPage } from "@/app/api/admin/pages/[pageId]/route";
import { POST as restorePage } from "@/app/api/admin/pages/[pageId]/restore/route";
import { POST as permanentlyDeletePage } from "@/app/api/admin/pages/[pageId]/permanently-delete/route";
import { POST as restoreSnippet } from "@/app/api/admin/custom-code/[snippetId]/restore/route";
import { POST as permanentlyDeleteCampaign } from "@/app/api/admin/split-tests/[campaignId]/permanently-delete/route";

const trustedOrigin = "https://panel.example.com";

function mutationRequest(
  path: string,
  {
    headers = { origin: trustedOrigin },
    body,
  }: {
    headers?: Record<string, string>;
    body?: string;
  } = {},
) {
  return new Request(`${trustedOrigin}${path}`, {
    method: "POST",
    headers: body
      ? { ...headers, "content-type": "application/json" }
      : headers,
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BETTER_AUTH_URL", trustedOrigin);
  getSession.mockResolvedValue({
    user: { id: "admin-id", role: "ADMIN", isMaster: false },
  });
  pageService.trashPage.mockResolvedValue({ id: "page-id" });
  pageService.restorePage.mockResolvedValue({ id: "page-id" });
  pageService.permanentlyDeletePage.mockResolvedValue(undefined);
  customCodeService.trashSnippet.mockResolvedValue({ id: "snippet-id" });
  customCodeService.restoreSnippet.mockResolvedValue({ id: "snippet-id" });
  splitTestsService.permanentlyDeleteCampaign.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rotas individuais da lixeira", () => {
  it("rejeita restore de Pages vindo de origem externa", async () => {
    const response = await restorePage(
      mutationRequest("/api/admin/pages/page-id/restore", {
        headers: { origin: "https://attacker.example" },
      }),
      { params: Promise.resolve({ pageId: "page-id" }) },
    );

    expect(response.status).toBe(403);
    expect(pageService.restorePage).not.toHaveBeenCalled();
  });

  it("permite soft-delete e restore de Pages para EDITOR com origem confiável", async () => {
    getSession.mockResolvedValue({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });

    const trashResponse = await trashPage(
      new Request(`${trustedOrigin}/api/admin/pages/page-id`, {
        method: "DELETE",
        headers: { origin: trustedOrigin },
      }),
      { params: Promise.resolve({ pageId: "page-id" }) },
    );
    expect(trashResponse.status).toBe(200);
    expect(pageService.trashPage).toHaveBeenCalledWith("editor-id", "page-id");

    const restoreResponse = await restorePage(
      mutationRequest("/api/admin/pages/page-id/restore"),
      { params: Promise.resolve({ pageId: "page-id" }) },
    );
    expect(restoreResponse.status).toBe(200);
    expect(pageService.restorePage).toHaveBeenCalledWith(
      "editor-id",
      "page-id",
    );
  });

  it("permite restore de Custom Code para EDITOR com origem confiável", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });

    const response = await restoreSnippet(
      mutationRequest("/api/admin/custom-code/snippet-id/restore"),
      { params: Promise.resolve({ snippetId: "snippet-id" }) },
    );

    expect(response.status).toBe(200);
    expect(customCodeService.restoreSnippet).toHaveBeenCalledWith(
      "editor-id",
      "snippet-id",
    );
  });

  it("bloqueia exclusão permanente de Pages para EDITOR", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });

    const response = await permanentlyDeletePage(
      mutationRequest("/api/admin/pages/page-id/permanently-delete", {
        body: JSON.stringify({ confirmed: true }),
      }),
      { params: Promise.resolve({ pageId: "page-id" }) },
    );

    expect(response.status).toBe(403);
    expect(pageService.permanentlyDeletePage).not.toHaveBeenCalled();
  });

  it("exige confirmação no body antes de excluir Pages permanentemente", async () => {
    const response = await permanentlyDeletePage(
      mutationRequest("/api/admin/pages/page-id/permanently-delete"),
      { params: Promise.resolve({ pageId: "page-id" }) },
    );

    expect(response.status).toBe(400);
    expect(pageService.permanentlyDeletePage).not.toHaveBeenCalled();
  });

  it("exige confirmação no body antes de excluir Split Tests permanentemente", async () => {
    const response = await permanentlyDeleteCampaign(
      mutationRequest("/api/admin/split-tests/campaign-id/permanently-delete"),
      { params: Promise.resolve({ campaignId: "campaign-id" }) },
    );

    expect(response.status).toBe(400);
    expect(splitTestsService.permanentlyDeleteCampaign).not.toHaveBeenCalled();
  });
});
