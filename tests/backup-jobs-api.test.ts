import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const getJob = vi.hoisted(() => vi.fn());
const assertAdmin = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession } },
}));

vi.mock("@/lib/Modules/Backup/Service", () => ({
  backupService: { getJob, assertAdmin },
  BackupDomainError: class BackupDomainError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

describe("GET /api/admin/backup/jobs/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      user: { id: "admin", role: "ADMIN", isMaster: false },
    });
    assertAdmin.mockImplementation(() => undefined);
    getJob.mockResolvedValue(null);
  });

  it("returns 404 for a traversal jobId and never a foreign JSON body", async () => {
    const { GET } = await import("@/app/api/admin/backup/jobs/[jobId]/route");
    const response = await GET(
      new Request("http://localhost/api/admin/backup/jobs/..%2F..%2Fpackage"),
      { params: Promise.resolve({ jobId: "../../package" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Job not found",
      code: "NOT_FOUND",
    });
    expect(getJob).toHaveBeenCalledWith("../../package");
  });
});
