import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSession,
  updatePage,
  trashPage,
  restorePage,
  permanentlyDeletePage,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  updatePage: vi.fn(),
  trashPage: vi.fn(),
  restorePage: vi.fn(),
  permanentlyDeletePage: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/Pages/Service", () => ({
  pageService: {
    updatePage,
    trashPage,
    restorePage,
    permanentlyDeletePage,
  },
}));

import { POST } from "@/app/api/admin/pages/bulk/route";
import { PagesDomainError } from "@/lib/Modules/Pages/Types";

const pageOne = "clh5q6m1v0000qz9j8r2w4x7a";
const pageTwo = "clh5q6m1v0001qz9j8r2w4x7a";

function request(
  body: unknown,
  origin = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000")
    .origin,
) {
  return new Request("http://localhost/api/admin/pages/bulk", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin,
    },
  });
}

describe("admin pages bulk API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });
    updatePage.mockResolvedValue({ id: pageOne });
    trashPage.mockResolvedValue({ id: pageOne });
    restorePage.mockResolvedValue({ id: pageOne });
    permanentlyDeletePage.mockResolvedValue(undefined);
  });

  it("requires a session and blocks Editor before parsing the payload", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(
      POST(request({ action: "trash", ids: [pageOne] })),
    ).resolves.toMatchObject({
      status: 401,
    });

    getSession.mockResolvedValue({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });
    for (const action of ["trash", "restore", "permanently-delete"] as const) {
      const response = await POST(request({ action, ids: [] }));
      expect(response.status).toBe(403);
    }
    expect(updatePage).not.toHaveBeenCalled();
    expect(trashPage).not.toHaveBeenCalled();
    expect(restorePage).not.toHaveBeenCalled();
    expect(permanentlyDeletePage).not.toHaveBeenCalled();
  });

  it("rejects invalid roles and cross-origin bulk requests", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "owner-id", role: "OWNER", isMaster: false },
    });
    await expect(
      POST(request({ action: "trash", ids: [pageOne] })),
    ).resolves.toMatchObject({ status: 403 });

    await expect(
      POST(
        request(
          { action: "trash", ids: [pageOne] },
          "https://attacker.example",
        ),
      ),
    ).resolves.toMatchObject({ status: 403 });
    expect(trashPage).not.toHaveBeenCalled();
    expect(restorePage).not.toHaveBeenCalled();
    expect(permanentlyDeletePage).not.toHaveBeenCalled();
  });

  it("rejects malformed actions, IDs, destination and client identity", async () => {
    for (const body of [
      { action: "publish", ids: [pageOne] },
      { action: "trash", ids: [] },
      { action: "move-folder", ids: ["not-a-cuid"], folderId: pageTwo },
      { action: "move-folder", ids: [pageOne] },
      { action: "trash", ids: [pageOne], role: "MASTER" },
      { action: "restore", ids: [pageOne], role: "MASTER" },
      { action: "permanently-delete", ids: [pageOne] },
      { action: "permanently-delete", ids: [pageOne], confirmed: false },
      {
        action: "permanently-delete",
        ids: [pageOne],
        confirmed: true,
        userId: "attacker",
      },
      {
        action: "restore",
        ids: Array.from({ length: 201 }, () => pageOne),
      },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }

    expect(updatePage).not.toHaveBeenCalled();
    expect(trashPage).not.toHaveBeenCalled();
    expect(restorePage).not.toHaveBeenCalled();
    expect(permanentlyDeletePage).not.toHaveBeenCalled();
  });

  it("moves unique pages one by one and reports a safe partial result", async () => {
    updatePage.mockImplementation(
      async (_userId: string, input: { id: string }) => {
        if (input.id === pageTwo) {
          throw new PagesDomainError("NOT_FOUND", "internal page detail");
        }
        return { id: input.id };
      },
    );

    const response = await POST(
      request({
        action: "move-folder",
        ids: [pageOne, pageOne, pageTwo],
        folderId: "clh5q6m1v0002qz9j8r2w4x7a",
      }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [pageOne],
      failed: [
        {
          id: pageTwo,
          code: "NOT_FOUND",
          message: "Page was not found",
        },
      ],
    });
    expect(updatePage).toHaveBeenNthCalledWith(1, "admin-id", {
      id: pageOne,
      folderId: "clh5q6m1v0002qz9j8r2w4x7a",
    });
    expect(updatePage).toHaveBeenNthCalledWith(2, "admin-id", {
      id: pageTwo,
      folderId: "clh5q6m1v0002qz9j8r2w4x7a",
    });
  });

  it("sends trash through the existing page service", async () => {
    const response = await POST(request({ action: "trash", ids: [pageOne] }));

    expect(response.status).toBe(200);
    expect(trashPage).toHaveBeenCalledWith("admin-id", pageOne);
  });

  it("restores pages through the existing service and reports partial failures", async () => {
    restorePage.mockImplementation(async (_userId: string, id: string) => {
      if (id === pageTwo) {
        throw new PagesDomainError("NOT_FOUND", "internal page detail");
      }
      return { id };
    });

    const response = await POST(
      request({ action: "restore", ids: [pageOne, pageOne, pageTwo] }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [pageOne],
      failed: [
        {
          id: pageTwo,
          code: "NOT_FOUND",
          message: "Page was not found",
        },
      ],
    });
    expect(restorePage).toHaveBeenNthCalledWith(1, "admin-id", pageOne);
    expect(restorePage).toHaveBeenNthCalledWith(2, "admin-id", pageTwo);
  });

  it("permanently deletes through the service with the server-derived role", async () => {
    const response = await POST(
      request({
        action: "permanently-delete",
        ids: [pageOne],
        confirmed: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(permanentlyDeletePage).toHaveBeenCalledWith(
      "admin-id",
      pageOne,
      "ADMIN",
    );
  });
});
