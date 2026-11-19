import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, trashSnippet, restoreSnippet, permanentlyDeleteSnippet } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    trashSnippet: vi.fn(),
    restoreSnippet: vi.fn(),
    permanentlyDeleteSnippet: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/CustomCode/Service", () => ({
  customCodeService: {
    trashSnippet,
    restoreSnippet,
    permanentlyDeleteSnippet,
  },
}));

import { POST } from "@/app/api/admin/custom-code/bulk/route";
import { CustomCodeDomainError } from "@/lib/Modules/CustomCode/Types";

const snippetOne = "clh5q6m1v0000qz9j8r2w4x7a";
const snippetTwo = "clh5q6m1v0001qz9j8r2w4x7a";

function request(
  body: unknown,
  origin = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000")
    .origin,
) {
  return new Request("http://localhost/api/admin/custom-code/bulk", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { origin },
  });
}

describe("admin custom code bulk API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });
    trashSnippet.mockResolvedValue({ id: snippetOne });
    restoreSnippet.mockResolvedValue({ id: snippetOne });
    permanentlyDeleteSnippet.mockResolvedValue(undefined);
  });

  it("requires a session and blocks Editor before parsing the payload", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(
      POST(request({ action: "trash", ids: [snippetOne] })),
    ).resolves.toMatchObject({ status: 401 });

    getSession.mockResolvedValue({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });
    for (const action of ["trash", "restore", "permanently-delete"] as const) {
      const response = await POST(request({ action, ids: [] }));
      expect(response.status).toBe(403);
    }
    expect(trashSnippet).not.toHaveBeenCalled();
    expect(restoreSnippet).not.toHaveBeenCalled();
    expect(permanentlyDeleteSnippet).not.toHaveBeenCalled();
  });

  it("rejects invalid roles and cross-origin mutations before executing", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "owner-id", role: "OWNER", isMaster: false },
    });
    await expect(
      POST(request({ action: "restore", ids: [snippetOne] })),
    ).resolves.toMatchObject({ status: 403 });

    const response = await POST(
      request(
        { action: "restore", ids: [snippetOne] },
        "https://attacker.example",
      ),
    );

    expect(response.status).toBe(403);
    expect(trashSnippet).not.toHaveBeenCalled();
    expect(restoreSnippet).not.toHaveBeenCalled();
    expect(permanentlyDeleteSnippet).not.toHaveBeenCalled();
  });

  it("rejects invalid actions, IDs, confirmation and forged identity fields", async () => {
    for (const body of [
      { action: "publish", ids: [snippetOne] },
      { action: "trash", ids: [] },
      { action: "trash", ids: ["not-a-cuid"] },
      { action: "trash", ids: [snippetOne], userId: "attacker" },
      { action: "restore", ids: [snippetOne], role: "MASTER" },
      { action: "restore", ids: Array.from({ length: 201 }, () => snippetOne) },
      { action: "permanently-delete", ids: [snippetOne] },
      { action: "permanently-delete", ids: [snippetOne], confirmed: false },
      {
        action: "permanently-delete",
        ids: [snippetOne],
        confirmed: true,
        userId: "attacker",
      },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }

    expect(trashSnippet).not.toHaveBeenCalled();
    expect(restoreSnippet).not.toHaveBeenCalled();
    expect(permanentlyDeleteSnippet).not.toHaveBeenCalled();
  });

  it("trashes unique scripts in order and reports a safe partial result", async () => {
    trashSnippet.mockImplementation(async (_userId: string, id: string) => {
      if (id === snippetTwo) {
        throw new CustomCodeDomainError("NOT_FOUND", "internal detail");
      }
    });

    const response = await POST(
      request({ action: "trash", ids: [snippetOne, snippetOne, snippetTwo] }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [snippetOne],
      failed: [
        {
          id: snippetTwo,
          code: "NOT_FOUND",
          message: "Script was not found",
        },
      ],
    });
    expect(trashSnippet).toHaveBeenNthCalledWith(1, "admin-id", snippetOne);
    expect(trashSnippet).toHaveBeenNthCalledWith(2, "admin-id", snippetTwo);
  });

  it("restores unique scripts and reports a safe partial result", async () => {
    restoreSnippet.mockImplementation(async (_userId: string, id: string) => {
      if (id === snippetTwo) {
        throw new CustomCodeDomainError("INVALID_STATE", "internal detail");
      }
    });

    const response = await POST(
      request({ action: "restore", ids: [snippetOne, snippetOne, snippetTwo] }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [snippetOne],
      failed: [
        {
          id: snippetTwo,
          code: "INVALID_STATE",
          message: "Script is not in an eligible state",
        },
      ],
    });
    expect(restoreSnippet).toHaveBeenNthCalledWith(1, "admin-id", snippetOne);
    expect(restoreSnippet).toHaveBeenNthCalledWith(2, "admin-id", snippetTwo);
  });

  it("permanently deletes only after explicit confirmation and uses the server role", async () => {
    const response = await POST(
      request({
        action: "permanently-delete",
        ids: [snippetOne],
        confirmed: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(permanentlyDeleteSnippet).toHaveBeenCalledWith(
      "admin-id",
      snippetOne,
      "ADMIN",
    );
  });

  it("returns a safe partial result when a permanent delete is not in the trash", async () => {
    permanentlyDeleteSnippet.mockImplementation(
      async (_userId: string, id: string) => {
        if (id === snippetTwo) {
          throw new CustomCodeDomainError("INVALID_STATE", "internal detail");
        }
      },
    );

    const response = await POST(
      request({
        action: "permanently-delete",
        ids: [snippetOne, snippetTwo],
        confirmed: true,
      }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [snippetOne],
      failed: [
        {
          id: snippetTwo,
          code: "INVALID_STATE",
          message: "Script is not in an eligible state",
        },
      ],
    });
  });
});
