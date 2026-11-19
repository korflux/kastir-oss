import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, updateMetadata, convertToWebp, deleteMedia } = vi.hoisted(
  () => ({
    getSession: vi.fn(),
    updateMetadata: vi.fn(),
    convertToWebp: vi.fn(),
    deleteMedia: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/Modules/Media/Service", () => ({
  mediaService: {
    updateMetadata,
    convertToWebp,
    delete: deleteMedia,
  },
}));

import { POST } from "@/app/api/admin/media/bulk/route";
import { MediaDomainError } from "@/lib/Modules/Media/Types";

const mediaOne = "00000000-0000-4000-8000-000000000001";
const mediaTwo = "00000000-0000-4000-8000-000000000002";
const folderId = "clh5q6m1v0002qz9j8r2w4x7a";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/media/bulk", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000")
        .origin,
    },
  });
}

describe("admin media bulk API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });
    updateMetadata.mockResolvedValue({ id: mediaOne });
    convertToWebp.mockResolvedValue({ id: mediaOne });
    deleteMedia.mockResolvedValue(undefined);
  });

  it("requires a session and blocks Editor before parsing the payload", async () => {
    getSession.mockResolvedValueOnce(null);
    await expect(
      POST(request({ action: "delete", ids: [mediaOne] })),
    ).resolves.toMatchObject({ status: 401 });

    getSession.mockResolvedValueOnce({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });
    const response = await POST(request({ action: "delete", ids: [] }));

    expect(response.status).toBe(403);
    expect(deleteMedia).not.toHaveBeenCalled();
  });

  it("rejects wrong actions, malformed IDs, missing folder and forged role", async () => {
    for (const body of [
      { action: "trash", ids: [mediaOne] },
      { action: "delete", ids: [] },
      { action: "delete", ids: ["not-a-uuid"] },
      { action: "move-folder", ids: [mediaOne] },
      { action: "delete", ids: [mediaOne], role: "MASTER" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }

    expect(updateMetadata).not.toHaveBeenCalled();
    expect(convertToWebp).not.toHaveBeenCalled();
    expect(deleteMedia).not.toHaveBeenCalled();
  });

  it("moves, converts and deletes through the individual services", async () => {
    await expect(
      POST(request({ action: "move-folder", ids: [mediaOne], folderId })),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      POST(request({ action: "convert-webp", ids: [mediaOne] })),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      POST(request({ action: "delete", ids: [mediaOne] })),
    ).resolves.toMatchObject({ status: 200 });

    expect(updateMetadata).toHaveBeenCalledWith("admin-id", {
      id: mediaOne,
      folderId,
    });
    expect(convertToWebp).toHaveBeenCalledWith("admin-id", mediaOne);
    expect(deleteMedia).toHaveBeenCalledWith("admin-id", mediaOne);
  });

  it("deduplicates and reports a safe partial result", async () => {
    deleteMedia.mockImplementation(async (_userId: string, id: string) => {
      if (id === mediaTwo) {
        throw new MediaDomainError("NOT_FOUND", "internal media detail");
      }
    });

    const response = await POST(
      request({ action: "delete", ids: [mediaOne, mediaOne, mediaTwo] }),
    );

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toEqual({
      ok: [mediaOne],
      failed: [
        { id: mediaTwo, code: "NOT_FOUND", message: "Media was not found" },
      ],
    });
    expect(deleteMedia).toHaveBeenNthCalledWith(1, "admin-id", mediaOne);
    expect(deleteMedia).toHaveBeenNthCalledWith(2, "admin-id", mediaTwo);
  });
});
