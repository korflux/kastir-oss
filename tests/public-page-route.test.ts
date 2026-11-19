import { beforeEach, describe, expect, it, vi } from "vitest";

const { read } = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock("@/lib/Publishing/fileStore", () => ({
  createPageFileStore: vi.fn(() => ({ read })),
}));

import { HEAD, GET } from "@/app/[...slug]/route";

const context = (slug: string[]) => ({
  params: Promise.resolve({ slug }),
});

describe("development public page route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves a published page at its clean URL", async () => {
    read.mockResolvedValue("<h1>Landing</h1>");

    const response = await GET(
      new Request("http://localhost/landing?utm_source=test"),
      context(["landing"]),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toBe("<h1>Landing</h1>");
    expect(read).toHaveBeenCalledWith("landing");
  });

  it("returns 404 when the clean page file is missing", async () => {
    read.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/missing"),
      context(["missing"]),
    );

    expect(response.status).toBe(404);
  });

  it("supports HEAD without returning the published body", async () => {
    read.mockResolvedValue("<h1>Landing</h1>");

    const response = await HEAD(
      new Request("http://localhost/landing", { method: "HEAD" }),
      context(["landing"]),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
  });
});
