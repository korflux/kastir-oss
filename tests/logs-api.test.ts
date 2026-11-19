import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, listLogs } = vi.hoisted(() => ({
  getSession: vi.fn(),
  listLogs: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession } },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/Modules/Logs/Service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/Modules/Logs/Service")
  >("@/lib/Modules/Logs/Service");
  return {
    ...actual,
    logsService: { listLogs },
  };
});

import { GET } from "@/app/api/admin/logs/route";
import { LogsDomainError } from "@/lib/Modules/Logs/Service";

describe("logs HTTP contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      user: { id: "admin-id", role: "ADMIN", isMaster: false },
    });
    listLogs.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it("requires a session and returns forbidden for an Editor", async () => {
    getSession.mockResolvedValueOnce(null);
    const anonymous = await GET(new Request("http://localhost/api/admin/logs"));
    expect(anonymous.status).toBe(401);

    getSession.mockResolvedValueOnce({
      user: { id: "editor-id", role: "EDITOR", isMaster: false },
    });
    const editor = await GET(new Request("http://localhost/api/admin/logs"));
    expect(editor.status).toBe(403);
    expect(listLogs).not.toHaveBeenCalled();
  });

  it("parses filters and passes only the session actor to the Service", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/admin/logs?page=2&pageSize=20&userId=target-id&from=2026-07-17T12:00:00Z&to=2026-07-17T12:00:45Z&objectType=FOLDER",
      ),
    );

    expect(response.status).toBe(200);
    expect(listLogs).toHaveBeenCalledWith("admin-id", {
      page: 2,
      pageSize: 20,
      userId: "target-id",
      from: new Date("2026-07-17T12:00:00.000Z"),
      to: new Date("2026-07-17T12:00:45.999Z"),
      objectType: "FOLDER",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns an empty 200 result for a user id with no matching logs", async () => {
    listLogs.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });

    const response = await GET(
      new Request("http://localhost/api/admin/logs?userId=missing-id"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      total: 0,
      items: [],
    });
  });

  it("maps invalid filters and domain failures without exposing internals", async () => {
    const invalid = await GET(
      new Request("http://localhost/api/admin/logs?pageSize=101"),
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    listLogs.mockRejectedValueOnce(new LogsDomainError("FORBIDDEN", "safe"));
    const forbidden = await GET(new Request("http://localhost/api/admin/logs"));
    expect(forbidden.status).toBe(403);

    listLogs.mockRejectedValueOnce(new Error("database internals"));
    const internal = await GET(new Request("http://localhost/api/admin/logs"));
    expect(internal.status).toBe(500);
    await expect(internal.json()).resolves.not.toMatchObject({
      error: "database internals",
    });
  });
});
