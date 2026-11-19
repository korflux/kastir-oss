import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  publishPage,
  permanentlyDeletePage,
  getPage,
  restorePageRevision,
  setPageRevisionPinned,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  publishPage: vi.fn(),
  permanentlyDeletePage: vi.fn(),
  getPage: vi.fn(),
  restorePageRevision: vi.fn(),
  setPageRevisionPinned: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: {
    publishPage,
    permanentlyDeletePage,
    getPage,
    restorePageRevision,
    setPageRevisionPinned,
  },
}));

import { POST as publish } from "@/app/api/admin/pages/[pageId]/publish/route";
import { POST as permanentlyDelete } from "@/app/api/admin/pages/[pageId]/permanently-delete/route";
import { GET as preview } from "@/app/api/admin/pages/[pageId]/preview/route";
import { POST as restoreRevision } from "@/app/api/admin/pages/[pageId]/revisions/[revisionId]/restore/route";
import { POST as pinRevision } from "@/app/api/admin/pages/[pageId]/revisions/[revisionId]/pin/route";

const params = Promise.resolve({ pageId: "page-id" });

describe("admin page action APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    getSession.mockResolvedValue({
      user: { id: "master-id", role: "ADMIN", isMaster: true },
    });
    publishPage.mockResolvedValue({ id: "page-id", status: "PUBLISHED" });
    permanentlyDeletePage.mockResolvedValue(undefined);
    getPage.mockResolvedValue({ id: "page-id", content: "<h1>Draft</h1>" });
  });

  it("publishes through the synchronous Service action", async () => {
    const response = await publish(
      new Request("http://localhost", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(publishPage).toHaveBeenCalledWith("master-id", "page-id");
  });

  it("passes the server-derived role to permanent deletion", async () => {
    const response = await permanentlyDelete(
      new Request("http://localhost", {
        body: JSON.stringify({ confirmed: true }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        method: "POST",
      }),
      { params },
    );

    expect(response.status).toBe(204);
    expect(permanentlyDeletePage).toHaveBeenCalledWith(
      "master-id",
      "page-id",
      "MASTER",
    );
  });

  it("serves preview privately and never as a public slug route", async () => {
    const response = await preview(new Request("http://localhost"), { params });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.text()).resolves.toBe("<h1>Draft</h1>");
  });

  it("restores a revision through the authenticated mutation boundary", async () => {
    restorePageRevision.mockResolvedValue({
      id: "page-id",
      hasUnpublishedChanges: true,
    });
    const revisionParams = Promise.resolve({
      pageId: "page-id",
      revisionId: "rev-1",
    });
    const response = await restoreRevision(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
          content: "<script>nope</script>",
        }),
      }),
      { params: revisionParams },
    );

    expect(response.status).toBe(400);
    expect(restorePageRevision).not.toHaveBeenCalled();

    const accepted = await restoreRevision(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
        }),
      }),
      { params: revisionParams },
    );
    expect(accepted.status).toBe(200);
    expect(restorePageRevision).toHaveBeenCalledWith(
      "master-id",
      "page-id",
      "rev-1",
      new Date("2026-08-13T12:00:00.000Z"),
    );
  });

  it("pins a revision without accepting extra control fields", async () => {
    setPageRevisionPinned.mockResolvedValue({ id: "rev-1", pinned: true });
    const revisionParams = Promise.resolve({
      pageId: "page-id",
      revisionId: "rev-1",
    });
    const rejected = await pinRevision(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ pinned: true, extra: true }),
      }),
      { params: revisionParams },
    );
    expect(rejected.status).toBe(400);

    const accepted = await pinRevision(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({ pinned: true }),
      }),
      { params: revisionParams },
    );
    expect(accepted.status).toBe(200);
    expect(setPageRevisionPinned).toHaveBeenCalledWith(
      "master-id",
      "page-id",
      "rev-1",
      true,
    );
  });
});
