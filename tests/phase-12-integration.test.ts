import "dotenv/config";

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaClient } from "@/app/generated/prisma/client";
import { expireTrashedPages } from "@/lib/Jobs/expireTrashedPages";
import { pageSnapshotFingerprint } from "@/lib/Modules/Revisions/snapshot";
import { PageService } from "@/lib/Modules/Pages/Service";
import { createPageFileStore } from "@/lib/Publishing/fileStore";
import { rebuildSettings } from "@/lib/Publishing/settingsRebuild";

const integrationEnabled = process.env.PHASE_12_TEST === "1";
const databaseUrl = process.env.DATABASE_URL;
const describeIntegration = describe.skipIf(
  !integrationEnabled || !databaseUrl,
);

describeIntegration("Fase 12 side effects against development Postgres", () => {
  let database: PrismaClient;
  let actorId: string;
  let adminIds: string[];
  let editorIds: string[];
  let baseFolderId: string;
  let publicDir: string;
  const pageIds: string[] = [];
  const snippetIds: string[] = [];
  let originalHomePageId: string | null = null;

  beforeAll(async () => {
    publicDir = await mkdtemp(join(tmpdir(), "kastir-phase-12-"));
    process.env.PUBLIC_DIR = publicDir;
    database = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl! }),
    });

    const master = await database.user.findFirst({
      where: { isMaster: true },
      select: { id: true },
    });
    if (!master) throw new Error("DATABASE_URL has no master user");
    actorId = master.id;
    const users = await database.user.findMany({
      select: { id: true, role: true, isMaster: true },
    });
    adminIds = users
      .filter((user) => user.isMaster || user.role === "ADMIN")
      .map((user) => user.id);
    editorIds = users
      .filter((user) => !user.isMaster && user.role === "EDITOR")
      .map((user) => user.id);

    const baseFolder = await database.pageFolder.findFirst({
      where: { isBase: true },
      select: { id: true },
    });
    if (!baseFolder) throw new Error("Base page folder missing");
    baseFolderId = baseFolder.id;

    const settings = await database.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    originalHomePageId = settings?.homePageId ?? null;
  });

  afterAll(async () => {
    try {
      if (snippetIds.length)
        await database.snippet.deleteMany({
          where: { id: { in: snippetIds } },
        });
      if (pageIds.length)
        await database.page.deleteMany({ where: { id: { in: pageIds } } });
      await database.siteSettings.update({
        where: { id: "singleton" },
        data: { homePageId: originalHomePageId },
      });
      await rebuildSettings("ARTIFACTS", [], {
        database: database as never,
        fileStore: createPageFileStore(publicDir),
        publicDir,
      });
    } finally {
      await database?.$disconnect();
      if (publicDir) await rm(publicDir, { recursive: true, force: true });
    }
  });

  async function createPublishedPage(title: string) {
    const stamp = Date.now();
    const page = await database.page.create({
      data: {
        title,
        slug: `phase-12-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
        content: `<!doctype html><html><head></head><body><h1>${title}</h1></body></html>`,
        status: "PUBLISHED",
        folderId: baseFolderId,
        authorId: actorId,
        publishedAt: new Date(),
      },
    });
    pageIds.push(page.id);
    const snapshot = {
      title: page.title,
      slug: page.slug,
      content: page.content,
      seoTitle: page.seoTitle,
      seoDescription: page.seoDescription,
      seoKeyword: page.seoKeyword,
      folderId: page.folderId,
    };
    const revision = await database.pageRevision.create({
      data: {
        pageId: page.id,
        authorId: actorId,
        fingerprint: pageSnapshotFingerprint(snapshot),
        ...snapshot,
      },
    });
    await database.page.update({
      where: { id: page.id },
      data: { publishedRevisionId: revision.id },
    });
    await createPageFileStore(publicDir).write(page.slug, page.content);
    return page;
  }

  async function notificationsContaining(text: string) {
    return database.notification.findMany({
      where: { message: { contains: text } },
      select: { id: true, userId: true, message: true, link: true },
    });
  }

  it("disables an orphaned snippet and resets home without duplicating permanent-delete notices", async () => {
    const stamp = `Phase12 ${Date.now()}`;
    const page = await createPublishedPage(`${stamp} page`);
    const snippet = await database.snippet.create({
      data: {
        name: `${stamp} snippet`,
        location: "HEADER",
        content: "<!-- phase-12 -->",
        status: "PUBLISHED",
        scopeType: "SPECIFIC_PAGES",
      },
    });
    snippetIds.push(snippet.id);
    await database.snippetPageScope.create({
      data: { snippetId: snippet.id, pageId: page.id },
    });

    const service = new PageService(
      database as never,
      createPageFileStore(publicDir),
    );
    await service.trashPage(actorId, page.id);

    await expect(
      database.snippet.findUnique({ where: { id: snippet.id } }),
    ).resolves.toMatchObject({
      status: "DRAFT",
    });
    const snippetNotifications = await notificationsContaining(
      `${stamp} snippet`,
    );
    expect(
      snippetNotifications.filter((item) => adminIds.includes(item.userId)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ link: `/admin/custom-code/${snippet.id}` }),
      ]),
    );
    expect(
      snippetNotifications.some((item) => editorIds.includes(item.userId)),
    ).toBe(false);

    const beforePermanent = snippetNotifications.length;
    await service.permanentlyDeletePage(actorId, page.id, "MASTER");
    await expect(
      database.page.findUnique({ where: { id: page.id } }),
    ).resolves.toBeNull();
    await expect(
      notificationsContaining(`${stamp} snippet`),
    ).resolves.toHaveLength(beforePermanent);
  });

  it("resets the home pointer, removes the root alias, and expires old trash through the system actor", async () => {
    const stamp = `Phase12 home ${Date.now()}`;
    const home = await createPublishedPage(stamp);
    await database.siteSettings.update({
      where: { id: "singleton" },
      data: { homePageId: home.id },
    });

    const service = new PageService(
      database as never,
      createPageFileStore(publicDir),
    );
    await service.trashPage(actorId, home.id);

    await expect(
      database.siteSettings.findUnique({ where: { id: "singleton" } }),
    ).resolves.toMatchObject({
      homePageId: null,
    });
    await expect(
      readFile(join(publicDir, "index.html"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const homeNotifications = await notificationsContaining(stamp);
    expect(
      homeNotifications.filter((item) => adminIds.includes(item.userId)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ link: "/admin/settings" }),
      ]),
    );

    const oldPage = await database.page.create({
      data: {
        title: `${stamp} old trash`,
        slug: `phase-12-old-${Date.now()}`,
        content: "<p>old</p>",
        status: "DRAFT",
        folderId: baseFolderId,
        authorId: actorId,
        deletedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    pageIds.push(oldPage.id);
    const now = new Date("2026-02-15T00:00:00.000Z");
    await expect(expireTrashedPages(now, service)).resolves.toBe(1);
    await expect(
      database.page.findUnique({ where: { id: oldPage.id } }),
    ).resolves.toBeNull();
    await expect(
      database.logEntry.findFirst({
        where: {
          userId: "system:expire-trashed-pages",
          objectLabel: `${oldPage.title} (/${oldPage.slug})`,
        },
      }),
    ).resolves.toBeTruthy();
  });
});
