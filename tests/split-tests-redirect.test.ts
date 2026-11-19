import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/env", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
    BETTER_AUTH_URL: "https://site.example",
  },
}));

import { createTestRedirectService } from "@/lib/Modules/SplitTests/RedirectService";
import { createMemorySplitCounters } from "@/lib/Modules/SplitTests/counters";

function createDb(
  campaign: {
    id: string;
    slug: string;
    status: "ACTIVE" | "PAUSED";
    destinations: Array<{
      id: string;
      url: string;
      sortOrder: number;
      hitCount: number;
      status: "ACTIVE" | "PAUSED";
    }>;
  } | null,
) {
  return {
    splitCampaign: {
      findUnique: vi.fn(async () => {
        if (!campaign) return null;
        return {
          ...campaign,
          destinations: campaign.destinations.filter(
            (d) => d.status === "ACTIVE",
          ),
        };
      }),
    },
    splitDestination: {
      update: vi.fn(async () => ({})),
    },
    splitRedirectEvent: {
      create: vi.fn(async () => ({})),
    },
    siteSettings: {
      findUnique: vi.fn(async () => ({ siteUrl: "https://site.example" })),
    },
  };
}

describe("RedirectService", () => {
  it("returns 404 for missing or paused campaigns", async () => {
    const missing = createTestRedirectService(createDb(null) as never);
    await expect(
      missing.resolve("nope", new URLSearchParams()),
    ).resolves.toEqual({ status: 404 });

    const paused = createTestRedirectService(
      createDb({
        id: "c1",
        slug: "x",
        status: "PAUSED",
        destinations: [
          {
            id: "d1",
            url: "https://a.example",
            sortOrder: 0,
            hitCount: 0,
            status: "ACTIVE",
          },
        ],
      }) as never,
    );
    await expect(paused.resolve("x", new URLSearchParams())).resolves.toEqual({
      status: 404,
    });
  });

  it("redirects a single destination with query preserved", async () => {
    const service = createTestRedirectService(
      createDb({
        id: "c1",
        slug: "campanha-a",
        status: "ACTIVE",
        destinations: [
          {
            id: "d1",
            url: "https://land.example/v1?internal=1",
            sortOrder: 0,
            hitCount: 0,
            status: "ACTIVE",
          },
        ],
      }) as never,
    );

    const result = await service.resolve(
      "campanha-a",
      new URLSearchParams("utm_source=meta&utm_campaign=bf"),
    );

    expect(result.status).toBe(307);
    if (result.status === 307) {
      const location = new URL(result.location);
      expect(location.searchParams.get("internal")).toBe("1");
      expect(location.searchParams.get("utm_source")).toBe("meta");
      expect(location.searchParams.get("utm_campaign")).toBe("bf");
      expect(result.destinationId).toBe("d1");
    }
  });

  it("picks the under-served destination after cold start", async () => {
    const counters = createMemorySplitCounters({
      c1: { d1: 40, d2: 10 },
    });
    const service = createTestRedirectService(
      createDb({
        id: "c1",
        slug: "balance",
        status: "ACTIVE",
        destinations: [
          {
            id: "d1",
            url: "https://a.example",
            sortOrder: 0,
            hitCount: 40,
            status: "ACTIVE",
          },
          {
            id: "d2",
            url: "https://b.example",
            sortOrder: 1,
            hitCount: 10,
            status: "ACTIVE",
          },
        ],
      }) as never,
      counters,
    );

    const result = await service.resolve("balance", new URLSearchParams());
    expect(result.status).toBe(307);
    if (result.status === 307) {
      expect(result.destinationId).toBe("d2");
    }
  });

  it("resolves internal destination paths against site origin", async () => {
    const service = createTestRedirectService(
      createDb({
        id: "c1",
        slug: "internal",
        status: "ACTIVE",
        destinations: [
          {
            id: "d1",
            url: "/oferta",
            sortOrder: 0,
            hitCount: 0,
            status: "ACTIVE",
          },
        ],
      }) as never,
    );

    const result = await service.resolve(
      "internal",
      new URLSearchParams("utm_source=x"),
    );
    expect(result.status).toBe(307);
    if (result.status === 307) {
      expect(result.location).toBe("https://site.example/oferta?utm_source=x");
    }
  });

  it("returns 404 when the destination URL cannot be merged", async () => {
    const service = createTestRedirectService(
      createDb({
        id: "c1",
        slug: "bad",
        status: "ACTIVE",
        destinations: [
          {
            id: "d1",
            url: "not a url",
            sortOrder: 0,
            hitCount: 0,
            status: "ACTIVE",
          },
        ],
      }) as never,
    );

    await expect(
      service.resolve("bad", new URLSearchParams()),
    ).resolves.toEqual({
      status: 404,
    });
  });

  it("awaits redis increment and skips counters when redis was down", async () => {
    const counters = createMemorySplitCounters({ c1: { d1: 0 } });
    const db = createDb({
      id: "c1",
      slug: "camp",
      status: "ACTIVE",
      destinations: [
        {
          id: "d1",
          url: "https://a.example",
          sortOrder: 0,
          hitCount: 0,
          status: "ACTIVE",
        },
      ],
    });
    const service = createTestRedirectService(db as never, counters);

    await service.recordHit("c1", "d1", true);
    const after = await counters.getHits("c1", ["d1"]);
    expect(after.get("d1")).toBe(1);
    // Durable Postgres write is fire-and-forget — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.splitRedirectEvent.create).toHaveBeenCalledTimes(1);

    await service.recordHit("c1", "d1", false);
    const still = await counters.getHits("c1", ["d1"]);
    expect(still.get("d1")).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.splitRedirectEvent.create).toHaveBeenCalledTimes(1);
  });

  it("gates durable writes on the telemetry rate limiter without affecting redis counters", async () => {
    const counters = createMemorySplitCounters({ c1: { d1: 0 } });
    const db = createDb({
      id: "c1",
      slug: "camp",
      status: "ACTIVE",
      destinations: [
        {
          id: "d1",
          url: "https://a.example",
          sortOrder: 0,
          hitCount: 0,
          status: "ACTIVE",
        },
      ],
    });
    let allowedCalls = 0;
    const gate = vi.fn(async () => {
      allowedCalls += 1;
      return allowedCalls <= 2;
    });
    const service = createTestRedirectService(db as never, counters, gate);

    await service.recordHit("c1", "d1", true, "1.2.3.4");
    await service.recordHit("c1", "d1", true, "1.2.3.4");
    await service.recordHit("c1", "d1", true, "1.2.3.4");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Redis counter (feeds the selector) increments on every hit regardless of the gate.
    const hits = await counters.getHits("c1", ["d1"]);
    expect(hits.get("d1")).toBe(3);
    // Durable Postgres write only happens while the gate allows it.
    expect(db.splitRedirectEvent.create).toHaveBeenCalledTimes(2);
    expect(gate).toHaveBeenCalledWith("1.2.3.4", "c1");
  });

  it("fails open (still writes) when the telemetry gate throws", async () => {
    const counters = createMemorySplitCounters({ c1: { d1: 0 } });
    const db = createDb({
      id: "c1",
      slug: "camp",
      status: "ACTIVE",
      destinations: [
        {
          id: "d1",
          url: "https://a.example",
          sortOrder: 0,
          hitCount: 0,
          status: "ACTIVE",
        },
      ],
    });
    const throwingGate = vi.fn(async () => {
      throw new Error("redis down");
    });
    const service = createTestRedirectService(
      db as never,
      counters,
      throwingGate,
    );

    await service.recordHit("c1", "d1", true, null);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(db.splitRedirectEvent.create).toHaveBeenCalledTimes(1);
  });

  it("keeps durable telemetry inside the post-response lifecycle", async () => {
    const counters = createMemorySplitCounters({ c1: { d1: 0 } });
    const db = createDb({
      id: "c1",
      slug: "camp",
      status: "ACTIVE",
      destinations: [
        {
          id: "d1",
          url: "https://a.example",
          sortOrder: 0,
          hitCount: 0,
          status: "ACTIVE",
        },
      ],
    });
    let resolveGate: (value: boolean) => void = () => {};
    const gate = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveGate = resolve;
        }),
    );
    const service = createTestRedirectService(db as never, counters, gate);
    const events: string[] = [];

    const recordHitPromise = service
      .recordHit("c1", "d1", true, "1.2.3.4")
      .then(() => events.push("recordHit-resolved"));

    // Flush pending microtasks without ever resolving the gate — recordHit
    // must remain pending so Next's after() lifecycle can keep the durable
    // write alive until the gate and database work finish.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([]);

    resolveGate(true);
    await recordHitPromise;
    expect(events).toEqual(["recordHit-resolved"]);
    expect(db.splitRedirectEvent.create).toHaveBeenCalledTimes(1);
  });
});
