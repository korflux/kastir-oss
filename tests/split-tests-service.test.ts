import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { SplitTestsService } from "@/lib/Modules/SplitTests/Service";
import { SplitTestsDomainError } from "@/lib/Modules/SplitTests/Types";
import type {
  SplitCampaignRecord,
  SplitDestinationRecord,
} from "@/lib/Modules/SplitTests/Types";

type CampaignRow = SplitCampaignRecord & {
  destinations: SplitDestinationRecord[];
};

function createDatabase(initial: SplitCampaignRecord[] = []) {
  const campaigns: CampaignRow[] = initial.map((c) => ({
    ...c,
    destinations: [...(c.destinations ?? [])],
  }));
  const logs: Array<{ action: string; objectType: string }> = [];

  const database = {
    splitCampaign: {
      findUnique: vi.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) => {
          if (where.id) return campaigns.find((c) => c.id === where.id) ?? null;
          if (where.slug)
            return campaigns.find((c) => c.slug === where.slug) ?? null;
          return null;
        },
      ),
      findMany: vi.fn(
        async (args?: { where?: { deletedAt?: null | { not: null } } }) => {
          const where = args?.where ?? {};
          if (where.deletedAt === null) {
            return campaigns.filter((c) => c.deletedAt == null);
          }
          if (where.deletedAt && typeof where.deletedAt === "object") {
            return campaigns.filter((c) => c.deletedAt != null);
          }
          return campaigns;
        },
      ),
      count: vi.fn(
        async (args?: { where?: { deletedAt?: null | { not: null } } }) => {
          const rows = await database.splitCampaign.findMany(args);
          return rows.length;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const destCreate = data.destinations as
          { create: Array<Record<string, unknown>> } | undefined;
        const now = new Date();
        const destinations: SplitDestinationRecord[] = (
          destCreate?.create ?? []
        ).map((d, index) => ({
          id: String(d.id),
          campaignId: String(data.id),
          url: String(d.url),
          label: (d.label as string | null) ?? null,
          status: (d.status as SplitDestinationRecord["status"]) ?? "ACTIVE",
          sortOrder: Number(d.sortOrder ?? index),
          hitCount: Number(d.hitCount ?? 0),
          createdAt: now,
          updatedAt: now,
        }));
        const campaign: CampaignRow = {
          id: String(data.id),
          name: String(data.name),
          slug: String(data.slug),
          status: (data.status as SplitCampaignRecord["status"]) ?? "ACTIVE",
          authorId: String(data.authorId),
          destinations,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        campaigns.push(campaign);
        return campaign;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const campaign = campaigns.find((c) => c.id === where.id);
          if (!campaign) throw new Error("missing");
          Object.assign(campaign, data, { updatedAt: new Date() });
          return campaign;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = campaigns.findIndex((c) => c.id === where.id);
        if (index < 0) throw new Error("missing");
        return campaigns.splice(index, 1)[0];
      }),
    },
    splitDestination: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const c of campaigns) {
          const d = c.destinations?.find((x) => x.id === where.id);
          if (d) return d;
        }
        return null;
      }),
      findMany: vi.fn(async () =>
        campaigns.flatMap((c) => c.destinations ?? []),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const campaign = campaigns.find((c) => c.id === data.campaignId);
        if (!campaign) throw new Error("missing campaign");
        const now = new Date();
        const destination: SplitDestinationRecord = {
          id: String(data.id),
          campaignId: String(data.campaignId),
          url: String(data.url),
          label: (data.label as string | null) ?? null,
          status: (data.status as SplitDestinationRecord["status"]) ?? "ACTIVE",
          sortOrder: Number(data.sortOrder ?? 0),
          hitCount: Number(data.hitCount ?? 0),
          createdAt: now,
          updatedAt: now,
        };
        campaign.destinations = [...(campaign.destinations ?? []), destination];
        return destination;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          for (const c of campaigns) {
            const d = c.destinations?.find((x) => x.id === where.id);
            if (d) {
              Object.assign(d, data, { updatedAt: new Date() });
              return d;
            }
          }
          throw new Error("missing dest");
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const c of campaigns) {
          const index =
            c.destinations?.findIndex((x) => x.id === where.id) ?? -1;
          if (index >= 0 && c.destinations) {
            return c.destinations.splice(index, 1)[0];
          }
        }
        throw new Error("missing dest");
      }),
    },
    logEntry: {
      create: vi.fn(
        async ({ data }: { data: { action: string; objectType: string } }) => {
          logs.push(data);
          return data;
        },
      ),
    },
    $transaction: vi.fn(async <T>(cb: (tx: typeof database) => Promise<T>) =>
      cb(database),
    ),
    logs,
  };

  return database;
}

describe("SplitTestsService", () => {
  it("creates a campaign with destinations and logs SPLIT_TEST", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);

    const campaign = await service.createCampaign("user-1", {
      name: "Campanha A",
      destinations: [
        { url: "https://example.com/a", label: "Dest" },
        { url: "/oferta-b", label: "Dest" },
      ],
    });

    expect(campaign.slug).toBe("campanha-a");
    // Nova campanha nasce Draft (PAUSED) — redirect público só após publish.
    expect(campaign.status).toBe("PAUSED");
    expect(campaign.destinations).toHaveLength(2);
    expect(campaign.destinations[0].theoreticalWeight).toBe(50);
    expect(
      db.logs.some(
        (l) =>
          l.action === "SPLIT_CAMPAIGN_CREATED" &&
          l.objectType === "SPLIT_TEST",
      ),
    ).toBe(true);
  });

  it("rejects create destination without name (label)", async () => {
    const service = new SplitTestsService(createDatabase() as never);
    await expect(
      service.createCampaign("user-1", {
        name: "No label",
        destinations: [{ url: "https://example.com" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects create without destinations", async () => {
    const service = new SplitTestsService(createDatabase() as never);
    await expect(
      service.createCampaign("user-1", { name: "X", destinations: [] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    } satisfies Partial<SplitTestsDomainError>);
  });

  it("rejects invalid destination urls", async () => {
    const service = new SplitTestsService(createDatabase() as never);
    await expect(
      service.createCampaign("user-1", {
        name: "Bad",
        destinations: [{ url: "javascript:alert(1)", label: "Dest" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects duplicate slugs", async () => {
    const now = new Date();
    const db = createDatabase([
      {
        id: "c1",
        name: "Existing",
        slug: "campanha-a",
        status: "ACTIVE",
        authorId: "u",
        destinations: [],
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const service = new SplitTestsService(db as never);

    await expect(
      service.createCampaign("user-1", {
        name: "Other",
        slug: "campanha-a",
        destinations: [{ url: "https://example.com", label: "Dest" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("assigns theoretical weights 34/33/33 for three active destinations", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const campaign = await service.createCampaign("user-1", {
      name: "Triple",
      destinations: [
        { url: "https://a.example", label: "Dest" },
        { url: "https://b.example", label: "Dest" },
        { url: "https://c.example", label: "Dest" },
      ],
    });

    expect(campaign.destinations.map((d) => d.theoreticalWeight)).toEqual([
      34, 33, 33,
    ]);
  });

  it("pauses a destination and recalculates weights among active", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Pause me",
      destinations: [
        { url: "https://a.example", label: "Dest" },
        { url: "https://b.example", label: "Dest" },
      ],
    });

    const updated = await service.updateDestination(
      "user-1",
      created.id,
      created.destinations[1].id,
      { status: "PAUSED" },
    );

    const active = updated.destinations.filter((d) => d.status === "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0].theoreticalWeight).toBe(100);
    expect(
      updated.destinations.find((d) => d.status === "PAUSED")
        ?.theoreticalWeight,
    ).toBe(0);
  });

  it("refuses deleting the last destination", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "One",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });

    await expect(
      service.deleteDestination(
        "user-1",
        created.id,
        created.destinations[0].id,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses pausing the last active destination", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Solo active",
      destinations: [
        { url: "https://a.example", label: "Dest" },
        { url: "https://b.example", label: "Dest" },
      ],
    });

    await service.updateDestination(
      "user-1",
      created.id,
      created.destinations[1].id,
      {
        status: "PAUSED",
      },
    );

    await expect(
      service.updateDestination(
        "user-1",
        created.id,
        created.destinations[0].id,
        {
          status: "PAUSED",
        },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("updates destination url and label", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Edit dest",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });

    const updated = await service.updateDestination(
      "user-1",
      created.id,
      created.destinations[0].id,
      { url: "https://b.example/v2", label: "Variante B" },
    );

    expect(updated.destinations[0].url).toBe("https://b.example/v2");
    expect(updated.destinations[0].label).toBe("Variante B");
  });

  it("panel calls without audit keep logging with no MCP fields", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    await service.createCampaign("user-1", {
      name: "No audit",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });

    const entry = db.logs.find((l) => l.action === "SPLIT_CAMPAIGN_CREATED");
    expect(entry).toBeDefined();
    expect((entry as Record<string, unknown>).source).toBeUndefined();
  });

  it("propagates the MCP audit context into every mutation's log entry", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const audit = {
      source: "MCP" as const,
      tool: "kastir_split_tests_create",
      resource: "https://public.example/api/mcp",
      requestId: "request-1",
    };

    const created = await service.createCampaign(
      "user-1",
      {
        name: "Audited",
        destinations: [{ url: "https://a.example", label: "Dest" }],
      },
      audit,
    );
    await service.updateCampaign(
      "user-1",
      created.id,
      { name: "Renamed" },
      {
        ...audit,
        tool: "kastir_split_tests_update",
      },
    );
    const withDestination = await service.addDestination(
      "user-1",
      created.id,
      { url: "https://b.example", label: "Dest" },
      { ...audit, tool: "kastir_split_tests_destinations_create" },
    );
    await service.reorderDestinations(
      "user-1",
      created.id,
      withDestination.destinations.map((d) => d.id).reverse(),
      { ...audit, tool: "kastir_split_tests_destinations_reorder" },
    );

    for (const action of [
      "SPLIT_CAMPAIGN_CREATED",
      "SPLIT_CAMPAIGN_UPDATED",
      "SPLIT_DESTINATION_CREATED",
      "SPLIT_DESTINATION_UPDATED",
    ]) {
      const entry = db.logs.find((l) => l.action === action) as
        Record<string, unknown> | undefined;
      expect(entry, `expected a log entry for ${action}`).toBeDefined();
      expect(entry?.source).toBe("MCP");
      expect(entry?.requestId).toBe("request-1");
    }
  });

  it("propagates optional audit context on panel delete paths", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const audit = {
      source: "MCP" as const,
      tool: "not-a-real-mcp-delete-tool",
      resource: "https://public.example/api/mcp",
      requestId: "request-delete",
    };

    const created = await service.createCampaign("user-1", {
      name: "Delete me",
      destinations: [
        { url: "https://a.example", label: "Dest" },
        { url: "https://b.example", label: "Dest" },
      ],
    });
    await service.deleteDestination(
      "user-1",
      created.id,
      created.destinations[1].id,
      audit,
    );
    await service.trashCampaign("user-1", created.id, audit);

    const destDeleted = db.logs.find(
      (l) => l.action === "SPLIT_DESTINATION_DELETED",
    ) as Record<string, unknown> | undefined;
    const campaignDeleted = db.logs.find(
      (l) => l.action === "SPLIT_CAMPAIGN_TRASHED",
    ) as Record<string, unknown> | undefined;
    expect(destDeleted?.source).toBe("MCP");
    expect(destDeleted?.requestId).toBe("request-delete");
    expect(campaignDeleted?.source).toBe("MCP");
    expect(campaignDeleted?.requestId).toBe("request-delete");
  });

  it("rejects a stale expectedUpdatedAt on campaign update with CONFLICT", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Concurrency",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });

    await expect(
      service.updateCampaign("user-1", created.id, {
        name: "New name",
        expectedUpdatedAt: new Date(created.updatedAt.getTime() - 1000),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      service.updateCampaign("user-1", created.id, {
        name: "New name",
        expectedUpdatedAt: created.updatedAt,
      }),
    ).resolves.toMatchObject({ name: "New name" });
  });

  it("rejects a stale expectedUpdatedAt on destination update with CONFLICT", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Concurrency dest",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });
    const destination = created.destinations[0];

    await expect(
      service.updateDestination("user-1", created.id, destination.id, {
        label: "Stale",
        expectedUpdatedAt: new Date(destination.updatedAt.getTime() - 1000),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      service.updateDestination("user-1", created.id, destination.id, {
        label: "Fresh",
        expectedUpdatedAt: destination.updatedAt,
      }),
    ).resolves.toMatchObject({
      destinations: [expect.objectContaining({ label: "Fresh" })],
    });
  });

  it("rejects an invalid destination url on addDestination", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Add bad url",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });

    await expect(
      service.addDestination("user-1", created.id, {
        url: "javascript:alert(1)",
        label: "Dest",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an invalid destination url on updateDestination", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Update bad url",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });

    await expect(
      service.updateDestination(
        "user-1",
        created.id,
        created.destinations[0].id,
        {
          url: "data:text/html,<script>alert(1)</script>",
        },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects reorderDestinations when orderedIds don't match the campaign's destinations exactly", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Reorder mismatch",
      destinations: [
        { url: "https://a.example", label: "Dest" },
        { url: "https://b.example", label: "Dest" },
      ],
    });

    await expect(
      service.reorderDestinations("user-1", created.id, [
        created.destinations[0].id,
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      service.reorderDestinations("user-1", created.id, [
        created.destinations[0].id,
        "not-a-real-destination-id",
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects every mutation with NOT_FOUND when the campaign does not exist", async () => {
    const service = new SplitTestsService(createDatabase() as never);

    await expect(
      service.updateCampaign("user-1", "missing-campaign", { name: "X" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.addDestination("user-1", "missing-campaign", {
        url: "https://a.example",
        label: "Dest",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.updateDestination("user-1", "missing-campaign", "d1", {
        label: "X",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.reorderDestinations("user-1", "missing-campaign", ["d1"]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.getCampaign("missing-campaign")).rejects.toMatchObject(
      {
        code: "NOT_FOUND",
      },
    );
  });

  it("rejects updateDestination with NOT_FOUND when the destination doesn't belong to the campaign", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Wrong destination",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });

    await expect(
      service.updateDestination(
        "user-1",
        created.id,
        "not-a-real-destination-id",
        {
          label: "X",
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("trash pauses the campaign and hides it from the default list", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "To trash",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });
    await service.updateCampaign("user-1", created.id, { status: "ACTIVE" });

    const trashed = await service.trashCampaign("user-1", created.id);
    expect(trashed.deletedAt).toBeInstanceOf(Date);
    expect(trashed.status).toBe("PAUSED");

    const activeList = await service.listCampaigns();
    expect(activeList.items.map((item) => item.id)).not.toContain(created.id);

    const trashList = await service.listCampaigns({ includeDeleted: true });
    expect(trashList.items.map((item) => item.id)).toContain(created.id);
  });

  it("blocks mutations and slug reuse while a campaign is in the trash", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Reserved slug",
      slug: "promo",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });
    await service.trashCampaign("user-1", created.id);

    await expect(
      service.updateCampaign("user-1", created.id, { name: "Nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.addDestination("user-1", created.id, {
        url: "https://b.example",
        label: "Other",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // @unique no banco: slug na lixeira ainda está reservado.
    await expect(
      service.createCampaign("user-1", {
        name: "Other",
        slug: "promo",
        destinations: [{ url: "https://c.example", label: "Dest" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("restores from trash and permanently deletes only after trash", async () => {
    const db = createDatabase();
    const service = new SplitTestsService(db as never);
    const created = await service.createCampaign("user-1", {
      name: "Lifecycle",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });

    await expect(
      service.permanentlyDeleteCampaign("user-1", created.id, "MASTER"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    await service.trashCampaign("user-1", created.id);
    await expect(
      service.permanentlyDeleteCampaign("user-1", created.id, "EDITOR"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const restored = await service.restoreCampaign("user-1", created.id);
    expect(restored.deletedAt).toBeNull();
    expect(restored.status).toBe("PAUSED");

    await service.trashCampaign("user-1", created.id);
    await service.permanentlyDeleteCampaign("user-1", created.id, "ADMIN");
    await expect(service.getCampaign(created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("expires trashed campaigns past the retention window", async () => {
    const fixture = createDatabase();
    const service = new SplitTestsService(fixture as never);
    const camp = await service.createCampaign("user-1", {
      name: "Expire me",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });
    await service.trashCampaign("user-1", camp.id);
    await fixture.splitCampaign.update({
      where: { id: camp.id },
      data: { deletedAt: new Date("2020-01-01T00:00:00.000Z") },
    });

    const expired = await service.expireTrashedCampaigns(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(expired).toBe(1);
    await expect(
      service.getCampaign(camp.id, { includeDeleted: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects the expire job when a trashed campaign cannot be hard-deleted", async () => {
    const fixture = createDatabase();
    const service = new SplitTestsService(fixture as never);
    const camp = await service.createCampaign("user-1", {
      name: "Expire me",
      destinations: [{ url: "https://a.example", label: "Dest" }],
    });
    await service.trashCampaign("user-1", camp.id);
    await fixture.splitCampaign.update({
      where: { id: camp.id },
      data: { deletedAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    fixture.splitCampaign.delete = vi.fn(async () => {
      throw new Error("fk constraint");
    });

    await expect(
      service.expireTrashedCampaigns(new Date("2026-01-01T00:00:00.000Z")),
    ).rejects.toThrow(/1 failure/);
  });
});
