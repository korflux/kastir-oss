import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { afterTask, resolve, recordHit } = vi.hoisted(() => ({
  afterTask: vi.fn(),
  resolve: vi.fn(),
  recordHit: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: afterTask,
  };
});
vi.mock("@/lib/Modules/SplitTests/RedirectService", () => ({
  redirectService: { resolve, recordHit },
}));
vi.mock("@/lib/auth-rate-limit", () => ({
  resolveClientIp: vi.fn(() => null),
}));

import { GET } from "@/app/s/[slug]/route";

describe("public split redirect route", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns the redirect without waiting for hit telemetry", async () => {
    resolve.mockResolvedValue({
      status: 307,
      location: "https://destination.example/landing",
      campaignId: "campaign-id",
      destinationId: "destination-id",
      recordCounters: true,
    });
    let releaseTelemetry = () => {};
    recordHit.mockImplementation(
      () =>
        new Promise<void>((resolvePromise) => {
          releaseTelemetry = resolvePromise;
        }),
    );

    const response = await GET(
      new NextRequest("http://localhost/s/campaign?utm_source=test"),
      { params: Promise.resolve({ slug: "campaign" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://destination.example/landing",
    );
    expect(afterTask).toHaveBeenCalledOnce();
    expect(recordHit).not.toHaveBeenCalled();

    const callback = afterTask.mock.calls[0]?.[0] as
      (() => Promise<void>) | undefined;
    expect(callback).toBeTypeOf("function");
    const telemetry = callback?.();
    expect(recordHit).toHaveBeenCalledWith(
      "campaign-id",
      "destination-id",
      true,
      null,
    );
    releaseTelemetry();
    await telemetry;
  });

  it("skips hit telemetry for Meta ad-review/preview crawlers", async () => {
    resolve.mockResolvedValue({
      status: 307,
      location: "https://destination.example/landing",
      campaignId: "campaign-id",
      destinationId: "destination-id",
      recordCounters: true,
    });

    const response = await GET(
      new NextRequest("http://localhost/s/campaign", {
        headers: {
          "user-agent":
            "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        },
      }),
      { params: Promise.resolve({ slug: "campaign" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://destination.example/landing",
    );
    expect(afterTask).not.toHaveBeenCalled();
    expect(recordHit).not.toHaveBeenCalled();
  });
});
