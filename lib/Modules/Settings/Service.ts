import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { logEvent, type LogEventContext } from "@/lib/Logging/logEvent";
import {
  getPublishingQueue,
  TRACKED_JOB_RETENTION,
  type PublishingQueue,
} from "@/lib/Publishing/queue";
import { encryptCloudflareToken } from "@/lib/Modules/Settings/Crypto";
import { getPublicOrigin } from "@/lib/Modules/Settings/publicOrigin";
import { effectiveRevisionRetentionLimit } from "@/lib/Modules/Settings/revisionRetention";
import {
  settingsInputSchema,
  settingsUpdateRequestSchema,
} from "@/lib/Modules/Settings/Schema";
import {
  SETTINGS_ID,
  SETTINGS_OPTIONS_LIMIT,
  SettingsDomainError,
  type PublicSiteSettings,
  type SettingsInput,
  type SettingsRebuildScope,
  type SiteSettingsRecord,
} from "@/lib/Modules/Settings/Types";

type SettingsRow = SiteSettingsRecord;

export type SettingsDatabase = {
  siteSettings: {
    findUnique(args: { where: { id: string } }): Promise<SettingsRow | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<SettingsRow>;
  };
  page: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      status: string;
      deletedAt: Date | null;
    } | null>;
    findMany(args: {
      where: { status: "PUBLISHED"; deletedAt: null };
      select?: Record<string, boolean>;
      orderBy?: { title: "asc" };
      take?: number;
    }): Promise<
      Array<{
        id: string;
        title: string;
        slug: string;
      }>
    >;
  };
  mediaFile: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      url: string;
      category: string;
      processingStatus: string;
    } | null>;
    findMany(args: {
      where: { processingStatus: "READY"; category: { in: string[] } };
      select?: Record<string, boolean>;
      orderBy?: { name: "asc" };
      take?: number;
    }): Promise<
      Array<{
        id: string;
        name: string;
        url: string;
        category: string;
      }>
    >;
  };
  logEntry: {
    create(args: {
      data: {
        userId: string;
        action: string;
        objectType: "SETTINGS";
        objectLabel: string;
        source?: "PANEL" | "MCP";
        tool?: string;
        resource?: string;
        requestId?: string;
      };
    }): Promise<unknown>;
  };
  $transaction(
    callback: (tx: SettingsDatabase) => Promise<unknown>,
  ): Promise<unknown>;
};

export type SettingsQueue = Pick<PublishingQueue, "add">;

export type SettingsRequestContext = {
  requestOrigin?: string | null;
} & LogEventContext;

export type SettingsUpdateResult = {
  settings: PublicSiteSettings;
  scope: SettingsRebuildScope;
  operationId: string | null;
  affectedPageIds: string[];
  queueStatus: "NONE" | "ENQUEUED" | "FAILED";
};

function asPublicSettings(row: SettingsRow): PublicSiteSettings {
  const { cloudflareApiTokenEncrypted, ...publicSettings } = row;
  return {
    ...publicSettings,
    revisionRetentionLimit: effectiveRevisionRetentionLimit(
      row.revisionRetentionLimit,
    ),
    cloudflareApiTokenConfigured: Boolean(cloudflareApiTokenEncrypted),
  };
}

function changed(before: SettingsRow, data: SettingsRow): Set<string> {
  const keys = [
    "siteTitle",
    "tagline",
    "seoDescription",
    "faviconMediaId",
    "siteUrl",
    "siteLanguage",
    "timezone",
    "dateFormat",
    "timeFormat",
    "weekStartsOn",
    "homePageId",
    "indexable",
    "allowAiCrawlers",
    "sitemapEnabled",
    "notFoundPageId",
    "notFoundRedirectToHome",
    "cloudflareZoneId",
    "webpConversionEnabled",
    "revisionRetentionLimit",
  ] as const;
  return new Set(keys.filter((key) => before[key] !== data[key]));
}

function scopeForChange(changedFields: Set<string>): SettingsRebuildScope {
  const globalFields = [
    "siteTitle",
    "seoDescription",
    "faviconMediaId",
    "siteLanguage",
    "indexable",
  ];
  const hasGlobal = globalFields.some((field) => changedFields.has(field));
  if (hasGlobal) return "GLOBAL";

  const hasArtifacts = [
    "allowAiCrawlers",
    "siteUrl",
    "sitemapEnabled",
    "notFoundPageId",
    "notFoundRedirectToHome",
  ].some((field) => changedFields.has(field));
  // Tagline only shows up on the compiled home page (compile.ts gates it on
  // `settings.isHome`), so it belongs with homePageId under HOME — not
  // GLOBAL, which would rewrite every published page for an invisible change.
  const hasHome =
    changedFields.has("homePageId") || changedFields.has("tagline");
  if (hasHome) return "HOME";
  if (hasArtifacts) return "ARTIFACTS";
  return "NONE";
}

async function validateReferences(
  database: SettingsDatabase,
  input: SettingsInput,
): Promise<void> {
  if (input.notFoundPageId && input.notFoundRedirectToHome) {
    // UI-only mutual exclusivity isn't enough — a direct API call could set
    // both, and regeneratePublicArtifacts would then silently prefer the
    // redirect and drop the custom page with no error surfaced anywhere.
    throw new SettingsDomainError(
      "VALIDATION_ERROR",
      "Custom 404 page and redirect-to-home are mutually exclusive; set at most one",
    );
  }

  if (input.homePageId) {
    const page = await database.page.findUnique({
      where: { id: input.homePageId },
    });
    if (!page || page.status !== "PUBLISHED" || page.deletedAt) {
      throw new SettingsDomainError(
        "CONFLICT",
        "Home page must be an active published page",
      );
    }
  }

  if (input.notFoundPageId) {
    const page = await database.page.findUnique({
      where: { id: input.notFoundPageId },
    });
    if (!page || page.status !== "PUBLISHED" || page.deletedAt) {
      throw new SettingsDomainError(
        "CONFLICT",
        "Custom 404 page must be an active published page",
      );
    }
  }

  if (input.faviconMediaId) {
    const media = await database.mediaFile.findUnique({
      where: { id: input.faviconMediaId },
    });
    if (
      !media ||
      media.processingStatus !== "READY" ||
      !["IMAGE_RASTER", "IMAGE_SVG"].includes(media.category)
    ) {
      throw new SettingsDomainError(
        "CONFLICT",
        "Favicon must be a ready image",
      );
    }
  }
}

export class SettingsService {
  constructor(
    private readonly database: SettingsDatabase = prisma as unknown as SettingsDatabase,
    private readonly queue?: SettingsQueue,
  ) {}

  private transaction<T>(
    callback: (tx: SettingsDatabase) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(callback) as Promise<T>;
  }

  async getSettings(): Promise<PublicSiteSettings> {
    const settings = await this.database.siteSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (!settings)
      throw new SettingsDomainError(
        "NOT_FOUND",
        "Site settings were not found",
      );
    return asPublicSettings(settings);
  }

  async listOptions(): Promise<{
    faviconMedia: Array<{
      id: string;
      name: string;
      url: string;
      category: string;
    }>;
    homePages: Array<{ id: string; title: string; slug: string }>;
  }> {
    const [faviconMedia, homePages] = await Promise.all([
      this.database.mediaFile.findMany({
        where: {
          processingStatus: "READY",
          category: { in: ["IMAGE_RASTER", "IMAGE_SVG"] },
        },
        select: { id: true, name: true, url: true, category: true },
        orderBy: { name: "asc" },
        take: SETTINGS_OPTIONS_LIMIT,
      }),
      this.database.page.findMany({
        where: { status: "PUBLISHED", deletedAt: null },
        select: { id: true, title: true, slug: true },
        orderBy: { title: "asc" },
        take: SETTINGS_OPTIONS_LIMIT,
      }),
    ]);

    return {
      faviconMedia,
      homePages: homePages.map(({ id, title, slug }) => ({ id, title, slug })),
    };
  }

  async updateSettings(
    actorId: string,
    rawInput: unknown,
    context: SettingsRequestContext = {},
  ): Promise<SettingsUpdateResult> {
    const { requestOrigin, ...audit } = context;
    void requestOrigin;
    const parsedRequest = settingsUpdateRequestSchema.parse(rawInput);
    const { confirmSiteUrl, ...settingsBody } = parsedRequest;
    const input = settingsInputSchema.parse(settingsBody) as SettingsInput;
    const operationId = randomUUID();

    const { settings, scope, affectedPageIds } = await this.transaction(
      async (tx) => {
        const before = await tx.siteSettings.findUnique({
          where: { id: SETTINGS_ID },
        });
        if (!before)
          throw new SettingsDomainError(
            "NOT_FOUND",
            "Site settings were not found",
          );

        const savedOrigin = before.siteUrl
          ? getPublicOrigin({ siteUrl: before.siteUrl })
          : null;
        const candidateOrigin = input.siteUrl
          ? getPublicOrigin({ siteUrl: input.siteUrl })
          : null;
        if (candidateOrigin !== savedOrigin && !confirmSiteUrl) {
          throw new SettingsDomainError(
            "CONFIRMATION_REQUIRED",
            "Confirm the public URL before saving it",
            { candidateOrigin, requestOrigin },
          );
        }

        await validateReferences(tx, input);
        const encryptedToken =
          input.cloudflareApiToken === undefined
            ? before.cloudflareApiTokenEncrypted
            : input.cloudflareApiToken === null
              ? null
              : encryptCloudflareToken(input.cloudflareApiToken);
        // undefined preserves the existing zone; null explicitly clears it;
        // a string replaces it — same contract as the token above (see
        // SettingsInput.cloudflareZoneId doc comment on SettingsInput).
        const cloudflareZoneId =
          input.cloudflareZoneId === undefined
            ? before.cloudflareZoneId
            : input.cloudflareZoneId;
        const next = await tx.siteSettings.update({
          where: { id: SETTINGS_ID },
          data: {
            siteTitle: input.siteTitle,
            tagline: input.tagline ?? null,
            seoDescription: input.seoDescription ?? null,
            faviconMediaId: input.faviconMediaId ?? null,
            siteUrl: input.siteUrl ?? null,
            siteLanguage: input.siteLanguage,
            timezone: input.timezone,
            dateFormat: input.dateFormat,
            timeFormat: input.timeFormat,
            weekStartsOn: input.weekStartsOn,
            homePageId: input.homePageId ?? null,
            indexable: input.indexable,
            allowAiCrawlers: input.allowAiCrawlers,
            sitemapEnabled: input.sitemapEnabled,
            notFoundPageId: input.notFoundPageId ?? null,
            notFoundRedirectToHome: input.notFoundRedirectToHome,
            cloudflareApiTokenEncrypted: encryptedToken,
            cloudflareZoneId,
            webpConversionEnabled: input.webpConversionEnabled,
            revisionRetentionLimit: input.revisionRetentionLimit,
          },
        });

        await logEvent(tx, {
          userId: actorId,
          action: "SETTINGS_UPDATED",
          objectType: "SETTINGS",
          objectLabel: "Site settings",
          ...audit,
        });

        const fields = changed(before, next);
        return {
          settings: asPublicSettings(next),
          scope: scopeForChange(fields),
          affectedPageIds: [
            ...new Set(
              [before.homePageId, next.homePageId].filter((id): id is string =>
                Boolean(id),
              ),
            ),
          ],
        };
      },
    );

    if (scope === "NONE") {
      return {
        settings,
        scope,
        operationId: null,
        affectedPageIds,
        queueStatus: "NONE",
      };
    }

    const pageIds = scope === "HOME" ? affectedPageIds : [];

    // Always rebuild in-process so lang/favicon/title/home take effect immediately
    // after Save (queue-only was silent when Redis accepted the job but the worker
    // lagged or failed). Best-effort enqueue keeps multi-instance workers warm.
    try {
      const { rebuildSettings } =
        await import("@/lib/Publishing/settingsRebuild");
      await rebuildSettings(scope, pageIds);
    } catch {
      return {
        settings,
        scope,
        operationId,
        affectedPageIds,
        queueStatus: "FAILED",
      };
    }

    try {
      const queue = this.queue ?? getPublishingQueue();
      await queue.add(
        `settings-rebuild-${operationId}`,
        {
          type: "settings-rebuild" as const,
          operationId,
          scope,
          pageIds,
          userId: actorId,
          ...(audit.source ? { audit } : {}),
        },
        {
          // BullMQ jobId must not contain ":" (same contract as home side-effects).
          jobId: `settings-rebuild-${operationId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 60_000 },
          removeOnComplete: TRACKED_JOB_RETENTION,
          removeOnFail: false,
        },
      );
    } catch {
      // Inline rebuild already applied; queue is optional.
    }

    return {
      settings,
      scope,
      operationId,
      affectedPageIds,
      queueStatus: "ENQUEUED",
    };
  }
}

export const settingsService = new SettingsService();
