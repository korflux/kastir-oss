import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import packageJson from "@/package.json";

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/Logging/logEvent";
import { bootstrapMaster } from "@/lib/Modules/Auth/Bootstrap";
import { acquireBackupApplyLock } from "@/lib/Modules/Backup/ApplyLock";
import { evaluatePackageCompatibility } from "@/lib/Modules/Backup/Compatibility";
import { RESTORE_CONFIRMATION_PHRASE } from "@/lib/Modules/Backup/constants";
import { jobStore, JobStore } from "@/lib/Modules/Backup/JobStore";
import {
  getInstallKastirVersion,
  getInstallSchemaVersion,
} from "@/lib/Modules/Backup/Manifest";
import { MediaApply, mediaApply } from "@/lib/Modules/Backup/MediaApply";
import {
  openSitePackage,
  PackageReaderError,
} from "@/lib/Modules/Backup/PackageReader";
import { buildSitePackage } from "@/lib/Modules/Backup/PackageWriter";
import { getBackupJobsDir } from "@/lib/Modules/Backup/paths";
import { assertBackupRateLimit } from "@/lib/Modules/Backup/RateLimit";
import {
  backupAutoScheduleSchema,
  type BackupAutoScheduleInput,
} from "@/lib/Modules/Backup/Schema";
import {
  SnapshotStore,
  snapshotStore,
} from "@/lib/Modules/Backup/SnapshotStore";
import { rewriteOriginsInValue } from "@/lib/Modules/Backup/UrlRewrite";
import {
  liveRevisionsForExport,
  stripPublishedPointerForInsert,
} from "@/lib/Modules/Revisions/package";
import type {
  BackupJobRecord,
  PackageAsset,
  PackageDataMap,
  SnapshotMeta,
} from "@/lib/Modules/Backup/Types";
import { notify } from "@/lib/Modules/Notifications/Service";
import {
  getPublicOrigin,
  normalizePublicOrigin,
} from "@/lib/Modules/Settings/publicOrigin";
import {
  createMediaStorage,
  type MediaStorage,
} from "@/lib/Processing/mediaStorage";
import {
  getPublishingQueue,
  registerBackupAutoSnapshotScheduler,
  type PublishingQueue,
} from "@/lib/Publishing/queue";

export type BackupDomainErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFIRMATION_REQUIRED"
  | "INCOMPATIBLE"
  | "PACKAGE_INVALID"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export class BackupDomainError extends Error {
  constructor(
    public readonly code: BackupDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BackupDomainError";
  }
}

type QueueLike = Pick<PublishingQueue, "add">;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function usersFromPackage(data: PackageDataMap): {
  users: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
} {
  const payload = data["users.json"] as
    | {
        users?: Array<Record<string, unknown>>;
        accounts?: Array<Record<string, unknown>>;
      }
    | undefined;
  return {
    users: asArray(payload?.users),
    accounts: asArray(payload?.accounts),
  };
}

/**
 * Valida identidades restauráveis antes de qualquer staging ou troca de dados.
 * Backups anteriores ao par issuer/subject são recusados porque converter
 * campos ausentes com String(undefined) inutilizaria credenciais silenciosamente.
 */
function assertRestorableUserIdentities(
  users: Array<Record<string, unknown>>,
  accounts: Array<Record<string, unknown>>,
): void {
  /** Identidades persistidas exigem texto real; coerção não pode inventar credencial. */
  const hasText = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const userIds = new Set(
    users.filter((user) => hasText(user.id)).map((user) => user.id as string),
  );
  const accountUserIds = new Set(
    accounts
      .filter((account) => hasText(account.userId))
      .map((account) => account.userId as string),
  );
  const usersAreValid = users.every(
    (user) => hasText(user.id) && hasText(user.name) && hasText(user.email),
  );
  const accountsAreValid = accounts.every(
    (account) =>
      hasText(account.id) &&
      account.providerId === "credential" &&
      account.issuer === "local:credential" &&
      hasText(account.userId) &&
      account.accountId === account.userId &&
      userIds.has(account.userId) &&
      hasText(account.password),
  );
  const preservesLoginAccess =
    users.some((user) => user.isMaster === true) &&
    userIds.size === users.length &&
    accounts.length === users.length &&
    accountUserIds.size === userIds.size;

  if (!usersAreValid || !accountsAreValid || !preservesLoginAccess) {
    throw new BackupDomainError(
      "INCOMPATIBLE",
      "Package uses an unsupported user account identity schema.",
    );
  }
}

export class BackupService {
  constructor(
    private readonly database: typeof prisma = prisma,
    private readonly store: SnapshotStore = snapshotStore,
    private readonly jobs: JobStore = jobStore,
    private readonly media: MediaStorage = createMediaStorage(),
    private readonly mediaCutover: MediaApply = mediaApply,
    private readonly queue?: QueueLike,
  ) {}

  private getQueue(): QueueLike {
    return this.queue ?? getPublishingQueue();
  }

  assertAdmin(role: string): void {
    if (role !== "MASTER" && role !== "ADMIN") {
      throw new BackupDomainError(
        "FORBIDDEN",
        "Only administrators can manage backups",
      );
    }
  }

  assertConfirmation(phrase: string): void {
    if (phrase !== RESTORE_CONFIRMATION_PHRASE) {
      throw new BackupDomainError(
        "CONFIRMATION_REQUIRED",
        `Type ${RESTORE_CONFIRMATION_PHRASE} to confirm`,
      );
    }
  }

  async listSnapshots(): Promise<SnapshotMeta[]> {
    return this.store.list({ includeSafety: true });
  }

  /** Agendamento atual (campos de SiteSettings + fuso) pra UI/API. */
  async getAutoSchedule(): Promise<{
    enabled: boolean;
    intervalDays: number;
    hour: number;
    minute: number;
    timezone: string;
  }> {
    const settings = await this.database.siteSettings.findUnique({
      where: { id: "singleton" },
      select: {
        backupAutoEnabled: true,
        backupIntervalDays: true,
        backupAutoHour: true,
        backupAutoMinute: true,
        timezone: true,
      },
    });
    return {
      enabled: settings?.backupAutoEnabled ?? false,
      intervalDays: settings?.backupIntervalDays ?? 1,
      hour: settings?.backupAutoHour ?? 0,
      minute: settings?.backupAutoMinute ?? 0,
      timezone: settings?.timezone ?? "UTC",
    };
  }

  /**
   * Persiste agendamento, re-registra o scheduler na hora e audita.
   * Requer MASTER/ADMIN (caller já deve ter passado por assertAdmin na rota).
   */
  async updateAutoSchedule(
    userId: string,
    input: BackupAutoScheduleInput,
  ): Promise<{
    enabled: boolean;
    intervalDays: number;
    hour: number;
    minute: number;
    timezone: string;
    /** false se Redis/fila falhou — settings já persistidos; boot re-registra. */
    schedulerApplied: boolean;
  }> {
    const parsed = backupAutoScheduleSchema.safeParse(input);
    if (!parsed.success) {
      throw new BackupDomainError(
        "VALIDATION_ERROR",
        "Invalid backup schedule",
      );
    }

    const { enabled, intervalDays, hour, minute } = parsed.data;
    const updated = await this.database.siteSettings.update({
      where: { id: "singleton" },
      data: {
        backupAutoEnabled: enabled,
        backupIntervalDays: intervalDays,
        backupAutoHour: hour,
        backupAutoMinute: minute,
      },
      select: {
        backupAutoEnabled: true,
        backupIntervalDays: true,
        backupAutoHour: true,
        backupAutoMinute: true,
        timezone: true,
      },
    });

    // Efeito imediato — não espera restart do processo.
    let schedulerApplied = true;
    try {
      await registerBackupAutoSnapshotScheduler({
        backupAutoEnabled: updated.backupAutoEnabled,
        backupIntervalDays: updated.backupIntervalDays,
        backupAutoHour: updated.backupAutoHour,
        backupAutoMinute: updated.backupAutoMinute,
        timezone: updated.timezone,
      });
    } catch (error) {
      schedulerApplied = false;
      // Settings já no DB; boot re-registra quando Redis voltar.
      console.error(
        "[Kastir] Unable to apply backup auto-snapshot scheduler after schedule save",
        error instanceof Error ? error.message : "unknown error",
      );
    }

    await this.audit(
      userId,
      "BACKUP_AUTO_SCHEDULE_UPDATED",
      enabled
        ? `every ${intervalDays}d at ${hour}:${String(minute).padStart(2, "0")}`
        : "disabled",
    );

    return {
      enabled: updated.backupAutoEnabled,
      intervalDays: updated.backupIntervalDays,
      hour: updated.backupAutoHour,
      minute: updated.backupAutoMinute,
      timezone: updated.timezone,
      schedulerApplied,
    };
  }

  /**
   * Snapshot automático (job de sistema): sem rate limit de usuário.
   * Ator de audit = Master; notifica MASTER/ADMIN só em falha.
   */
  async runAutomaticSnapshot(): Promise<void> {
    const master = await this.database.user.findFirst({
      where: { isMaster: true },
      select: { id: true },
    });
    const masterId = master?.id;

    try {
      const built = await this.collectAndBuildPackage();
      const meta = await this.store.createFromZip(built.zipBytes);
      if (masterId) {
        await this.audit(masterId, "BACKUP_AUTO_EXPORTED", meta.fileName);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Automatic backup failed";
      console.error("[Kastir] Automatic backup failed", message);
      if (masterId) {
        await this.audit(masterId, "BACKUP_AUTO_EXPORT_FAILED", message);
      }
      // Notifica só falha real — sem alerta de "perdeu o horário".
      // Mensagem genérica: error.message pode carregar URL/segredo.
      try {
        // MASTER é isMaster=true (Role enum só tem ADMIN/EDITOR).
        const recipients = await this.database.user.findMany({
          where: { OR: [{ isMaster: true }, { role: "ADMIN" }] },
          select: { id: true },
        });
        const failMessage =
          process.env.PANEL_LANGUAGE === "pt-BR"
            ? "Backup automático falhou — veja os logs"
            : "Automatic backup failed — see logs";
        await Promise.all(
          recipients.map((user) =>
            notify(user.id, failMessage, "/admin/settings/backup"),
          ),
        );
      } catch {
        // notificação não pode derrubar o worker
      }
      // Não rethrow: falha capturada/auditada; próximo ciclo segue normal.
    }
  }

  async getJob(id: string): Promise<BackupJobRecord | null> {
    return this.jobs.get(id);
  }

  async deleteSnapshot(id: string): Promise<void> {
    const meta = await this.store.get(id);
    if (!meta) throw new BackupDomainError("NOT_FOUND", "Snapshot not found");
    await this.store.delete(id);
  }

  async readSnapshotBytes(id: string): Promise<Buffer> {
    const meta = await this.store.get(id);
    if (!meta) throw new BackupDomainError("NOT_FOUND", "Snapshot not found");
    return this.store.readPackageBytes(id);
  }

  private async enqueueOrRun(
    name: string,
    data:
      | { type: "backup-export"; jobId: string }
      | { type: "backup-restore"; jobId: string; snapshotId: string }
      | {
          type: "backup-import";
          jobId: string;
          packagePath: string;
          sourceOrigin: string;
          targetOrigin: string;
        },
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.getQueue().add(name, data, {
        jobId: `${name}-${data.jobId}`,
        removeOnComplete: true,
        removeOnFail: 50,
      });
    } catch {
      // Dev/tests without Redis: run in-process.
      void run().catch(() => undefined);
    }
  }

  private async audit(
    userId: string,
    action: string,
    objectLabel: string,
  ): Promise<void> {
    try {
      await logEvent(this.database, {
        userId,
        action,
        objectType: "SETTINGS",
        objectLabel,
      });
    } catch {
      // never fail the job solely because audit logging failed
    }
  }

  async startExport(userId: string): Promise<BackupJobRecord> {
    await assertBackupRateLimit(userId);
    const job = await this.jobs.create({
      kind: "export",
      userId,
      message: "Export queued",
    });
    await this.audit(userId, "BACKUP_EXPORT_STARTED", job.id);
    await this.enqueueOrRun(
      "backup-export",
      { type: "backup-export", jobId: job.id },
      () => this.runExportJob(job.id),
    );
    return job;
  }

  async runExportJob(jobId: string): Promise<void> {
    const claimed = await this.jobs.tryClaim(jobId, ["queued"]);
    if (!claimed) return;

    try {
      await this.jobs.update(jobId, {
        progress: 5,
        message: "Collecting data",
      });
      const built = await this.collectAndBuildPackage();
      await this.jobs.update(jobId, {
        progress: 80,
        message: "Writing snapshot",
      });
      const meta = await this.store.createFromZip(built.zipBytes);
      await this.jobs.update(jobId, {
        status: "ready",
        progress: 100,
        message: "Export ready",
        snapshotId: meta.id,
      });
      await this.audit(claimed.userId, "BACKUP_EXPORTED", meta.fileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed";
      await this.jobs.update(jobId, { status: "failed", error: message });
      await this.audit(claimed.userId, "BACKUP_EXPORT_FAILED", message);
      throw error;
    }
  }

  async collectAndBuildPackage() {
    const settings = await this.database.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    const origin = getPublicOrigin({
      siteUrl: settings?.siteUrl,
      fallbackOrigin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    });

    const [
      pages,
      pageFolders,
      mediaFiles,
      mediaFolders,
      snippets,
      scopes,
      campaigns,
      destinations,
      users,
      accounts,
      pageRevisions,
      snippetRevisions,
    ] = await Promise.all([
      this.database.page.findMany(),
      this.database.pageFolder.findMany(),
      this.database.mediaFile.findMany({
        where: { processingStatus: "READY" },
      }),
      this.database.mediaFolder.findMany(),
      this.database.snippet.findMany(),
      this.database.snippetPageScope.findMany(),
      this.database.splitCampaign.findMany(),
      this.database.splitDestination.findMany(),
      this.database.user.findMany(),
      this.database.account.findMany(),
      this.database.pageRevision.findMany(),
      this.database.snippetRevision.findMany(),
    ]);

    const settingsExport = settings
      ? {
          ...settings,
          cloudflareApiTokenEncrypted: null,
          createdAt: settings.createdAt.toISOString(),
          updatedAt: settings.updatedAt.toISOString(),
        }
      : null;

    const data: PackageDataMap = {
      "pages.json": pages.map((p) => ({
        ...p,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        deletedAt: p.deletedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      "page-folders.json": pageFolders.map((f) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
      "page-revisions.json": liveRevisionsForExport(pages, pageRevisions).map(
        (revision) => ({
          ...revision,
          createdAt: revision.createdAt.toISOString(),
        }),
      ),
      "media.json": mediaFiles.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      })),
      "media-folders.json": mediaFolders.map((f) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
      "settings.json": settingsExport,
      "custom-code.json": {
        snippets: snippets.map((s) => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        scopes,
      },
      "snippet-revisions.json": liveRevisionsForExport(
        snippets,
        snippetRevisions,
      ).map((revision) => ({
        ...revision,
        createdAt: revision.createdAt.toISOString(),
      })),
      "split-tests.json": {
        campaigns: campaigns.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        destinations: destinations.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
      },
      "users.json": {
        users: users.map((u) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
          updatedAt: u.updatedAt.toISOString(),
        })),
        accounts: accounts.map((a) => ({
          ...a,
          accessToken: null,
          refreshToken: null,
          idToken: null,
          accessTokenExpiresAt: a.accessTokenExpiresAt?.toISOString() ?? null,
          refreshTokenExpiresAt: a.refreshTokenExpiresAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      },
    };

    const assets: PackageAsset[] = [];
    for (const media of mediaFiles) {
      const bytes = await this.media.readPublic(media.id, media.fileName);
      if (!bytes) continue;
      assets.push({
        zipPath: `assets/uploads/${media.id}/${media.fileName}`,
        mediaId: media.id,
        fileName: media.fileName,
        bytes,
      });
    }

    return buildSitePackage({
      origin,
      siteTitle: settings?.siteTitle ?? "Kastir",
      data,
      assets,
      kastirVersion: packageJson.version,
      schemaVersion: getInstallSchemaVersion(),
    });
  }

  async startRestore(
    userId: string,
    snapshotId: string,
    confirmation: string,
  ): Promise<BackupJobRecord> {
    this.assertConfirmation(confirmation);
    await assertBackupRateLimit(userId);
    const meta = await this.store.get(snapshotId);
    if (!meta) throw new BackupDomainError("NOT_FOUND", "Snapshot not found");

    const job = await this.jobs.create({
      kind: "restore",
      userId,
      snapshotId,
      message: "Restore queued",
    });
    await this.audit(userId, "BACKUP_RESTORE_STARTED", snapshotId);
    await this.enqueueOrRun(
      "backup-restore",
      { type: "backup-restore", jobId: job.id, snapshotId },
      () => this.runRestoreJob(job.id),
    );
    return job;
  }

  async runRestoreJob(jobId: string): Promise<void> {
    const claimed = await this.jobs.tryClaim(jobId, ["queued"]);
    if (!claimed?.snapshotId) return;

    let safetyId: string | undefined;
    try {
      const bytes = await this.store.readPackageBytes(claimed.snapshotId);
      const safety = await this.createSafetySnapshot();
      safetyId = safety?.id;
      await this.jobs.update(jobId, {
        progress: 20,
        message: "Applying package",
      });

      const settings = await this.database.siteSettings.findUnique({
        where: { id: "singleton" },
      });
      const targetOrigin = getPublicOrigin({
        siteUrl: settings?.siteUrl,
        fallbackOrigin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      });

      await this.applyPackageBytes(bytes, {
        targetOrigin,
        rewriteIfNeeded: true,
        actorUserId: claimed.userId,
      });

      if (safetyId) await this.store.clearSafetyFlag(safetyId);

      await this.jobs.update(jobId, {
        status: "ready",
        progress: 100,
        message: "Restore complete",
      });
      await this.audit(claimed.userId, "BACKUP_RESTORED", claimed.snapshotId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Restore failed";
      if (safetyId) {
        await this.store.markSafetyFailed(safetyId, "restore failed");
      }
      await this.jobs.update(jobId, { status: "failed", error: message });
      await this.audit(claimed.userId, "BACKUP_RESTORE_FAILED", message);
      throw error;
    }
  }

  async stageImport(
    userId: string,
    zipBytes: Buffer,
    options: {
      sourceOrigin?: string;
      targetOrigin?: string;
      requestOrigin?: string | null;
    } = {},
  ): Promise<BackupJobRecord> {
    await assertBackupRateLimit(userId);

    let opened;
    try {
      opened = openSitePackage(zipBytes);
    } catch (error) {
      if (error instanceof PackageReaderError) {
        throw new BackupDomainError("PACKAGE_INVALID", error.message);
      }
      throw error;
    }

    const compatibility = evaluatePackageCompatibility(opened.manifest, {
      kastirVersion: getInstallKastirVersion(),
      schemaVersion: getInstallSchemaVersion(),
    });
    if (compatibility.level === "block") {
      throw new BackupDomainError(
        "INCOMPATIBLE",
        compatibility.issues.map((i) => i.message).join(" "),
      );
    }

    const { users } = usersFromPackage(opened.data);
    if (users.length === 0) {
      throw new BackupDomainError(
        "PACKAGE_INVALID",
        "Package has no users; refusing import to avoid lockout",
      );
    }

    const settings = await this.database.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    const targetOrigin = normalizePublicOrigin(
      options.targetOrigin ??
        getPublicOrigin({
          siteUrl: settings?.siteUrl,
          requestOrigin: options.requestOrigin,
          fallbackOrigin:
            process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
        }),
    );
    const sourceOrigin = normalizePublicOrigin(
      options.sourceOrigin ?? opened.manifest.origin,
    );

    const rewritten = rewriteOriginsInValue(
      opened.data,
      sourceOrigin,
      targetOrigin,
    );

    await mkdir(getBackupJobsDir(), { recursive: true });
    const packagePath = join(
      getBackupJobsDir(),
      `import-${randomUUID()}.kastir`,
    );
    await writeFile(packagePath, zipBytes);

    const job = await this.jobs.create({
      kind: "import",
      userId,
      status: "queued",
      progress: 0,
      message: "Import staged — confirm to apply",
      packagePath,
      dryRun: {
        replacements: rewritten.stats.replacements,
        warnings: compatibility.issues,
        sourceOrigin,
        targetOrigin,
      },
    });
    await this.audit(userId, "BACKUP_IMPORT_STAGED", job.id);
    return job;
  }

  async confirmImport(
    userId: string,
    jobId: string,
    confirmation: string,
    overrides?: { sourceOrigin?: string; targetOrigin?: string },
  ): Promise<BackupJobRecord> {
    this.assertConfirmation(confirmation);
    await assertBackupRateLimit(userId);

    const job = await this.jobs.get(jobId);
    if (!job || job.kind !== "import") {
      throw new BackupDomainError("NOT_FOUND", "Import job not found");
    }
    if (job.userId !== userId) {
      throw new BackupDomainError(
        "FORBIDDEN",
        "Import job belongs to another user",
      );
    }
    if (job.status !== "queued") {
      throw new BackupDomainError(
        "VALIDATION_ERROR",
        "Import job is not waiting for confirmation",
      );
    }

    const stagedPath = job.packagePath;
    if (!stagedPath) {
      throw new BackupDomainError(
        "VALIDATION_ERROR",
        "Import package is not staged",
      );
    }

    const sourceOrigin =
      overrides?.sourceOrigin ?? job.dryRun?.sourceOrigin ?? "";
    const targetOrigin =
      overrides?.targetOrigin ?? job.dryRun?.targetOrigin ?? "";

    // Claim immediately so a second confirm cannot enqueue another apply.
    const claimed = await this.jobs.tryClaim(jobId, ["queued"]);
    if (!claimed) {
      throw new BackupDomainError(
        "VALIDATION_ERROR",
        "Import job is already running",
      );
    }

    await this.jobs.update(jobId, {
      message: "Import confirmed",
      packagePath: stagedPath,
      dryRun: {
        replacements: job.dryRun?.replacements ?? 0,
        warnings: job.dryRun?.warnings ?? [],
        sourceOrigin,
        targetOrigin,
      },
    });

    await this.audit(userId, "BACKUP_IMPORT_STARTED", jobId);
    await this.enqueueOrRun(
      "backup-import",
      {
        type: "backup-import",
        jobId,
        packagePath: stagedPath,
        sourceOrigin,
        targetOrigin,
      },
      () => this.runImportJob(jobId, stagedPath, sourceOrigin, targetOrigin),
    );

    return (await this.jobs.get(jobId))!;
  }

  async runImportJob(
    jobId: string,
    packagePath: string,
    sourceOrigin: string,
    targetOrigin: string,
  ): Promise<void> {
    const current = await this.jobs.get(jobId);
    if (!current) return;
    if (current.status === "ready" || current.status === "failed") return;

    // Accept queued (worker path without pre-claim) or running (confirm pre-claim).
    if (current.status === "queued") {
      const claimed = await this.jobs.tryClaim(jobId, ["queued"]);
      if (!claimed) return;
    } else if (current.status === "running") {
      // Already claimed — refuse re-entry once apply has progressed.
      if (current.progress >= 20) return;
    } else {
      return;
    }

    const actorUserId = current.userId;
    let safetyId: string | undefined;
    try {
      const bytes = await readFile(packagePath);
      const safety = await this.createSafetySnapshot();
      safetyId = safety?.id;
      await this.jobs.update(jobId, {
        status: "running",
        progress: 25,
        message: "Applying import",
      });

      await this.applyPackageBytes(bytes, {
        targetOrigin,
        sourceOrigin,
        rewriteIfNeeded: true,
        actorUserId,
      });

      if (safetyId) await this.store.clearSafetyFlag(safetyId);
      await rm(packagePath, { force: true });

      await this.jobs.update(jobId, {
        status: "ready",
        progress: 100,
        message: "Import complete",
        packagePath: undefined,
      });
      await this.audit(actorUserId, "BACKUP_IMPORTED", jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed";
      if (safetyId) {
        await this.store.markSafetyFailed(safetyId, "import failed");
      }
      await this.jobs.update(jobId, { status: "failed", error: message });
      await this.audit(actorUserId, "BACKUP_IMPORT_FAILED", message);
      throw error;
    }
  }

  private async createSafetySnapshot(): Promise<SnapshotMeta | null> {
    try {
      const built = await this.collectAndBuildPackage();
      return await this.store.createFromZip(built.zipBytes, { safety: true });
    } catch {
      throw new BackupDomainError(
        "INTERNAL_ERROR",
        "Unable to create safety snapshot before applying package",
      );
    }
  }

  /**
   * Package de backup não é entrada de terceiro: só MASTER/ADMIN + frase
   * RESTAURAR. Campos vão String()/cast — fileStore e browsers seguram o
   * pior. Revalidar schemas de domínio se o restore aceitar package alheio.
   */
  async applyPackageBytes(
    zipBytes: Buffer,
    options: {
      sourceOrigin?: string;
      targetOrigin: string;
      rewriteIfNeeded: boolean;
      actorUserId: string;
    },
  ): Promise<void> {
    const opened = openSitePackage(zipBytes);

    const compatibility = evaluatePackageCompatibility(opened.manifest, {
      kastirVersion: getInstallKastirVersion(),
      schemaVersion: getInstallSchemaVersion(),
    });
    if (compatibility.level === "block") {
      throw new BackupDomainError(
        "INCOMPATIBLE",
        compatibility.issues.map((i) => i.message).join(" "),
      );
    }

    const sourceOrigin = normalizePublicOrigin(
      options.sourceOrigin ?? opened.manifest.origin,
    );
    const targetOrigin = normalizePublicOrigin(options.targetOrigin);

    let data = opened.data;
    if (options.rewriteIfNeeded && sourceOrigin !== targetOrigin) {
      data = rewriteOriginsInValue(data, sourceOrigin, targetOrigin)
        .value as PackageDataMap;
    }

    const { users, accounts } = usersFromPackage(data);
    if (users.length === 0) {
      throw new BackupDomainError(
        "PACKAGE_INVALID",
        "Package has no users; refusing apply to avoid lockout",
      );
    }
    assertRestorableUserIdentities(users, accounts);

    // 1) Stage all media before mutating DB
    const stageToken = await this.mediaCutover.stageAssets(opened.assets);
    const keepMediaIds = new Set(opened.assets.map((a) => a.mediaId));

    const existingSettings = await this.database.siteSettings.findUnique({
      where: { id: "singleton" },
    });
    const preservedToken =
      existingSettings?.cloudflareApiTokenEncrypted ?? null;
    const preservedZone = existingSettings?.cloudflareZoneId ?? null;

    try {
      // 2) DB replace under advisory lock
      await this.database.$transaction(async (tx) => {
        await acquireBackupApplyLock(tx);

        await tx.splitRedirectEvent.deleteMany();
        if (
          "splitRedirectDailyStat" in tx &&
          typeof (
            tx as {
              splitRedirectDailyStat?: { deleteMany: () => Promise<unknown> };
            }
          ).splitRedirectDailyStat?.deleteMany === "function"
        ) {
          await (
            tx as {
              splitRedirectDailyStat: { deleteMany: () => Promise<unknown> };
            }
          ).splitRedirectDailyStat.deleteMany();
        }
        await tx.splitDestination.deleteMany();
        await tx.splitCampaign.deleteMany();
        await tx.snippetPageScope.deleteMany();
        await tx.snippet.deleteMany();
        await tx.page.deleteMany();
        await tx.pageFolder.deleteMany();
        await tx.mediaFile.deleteMany();
        await tx.mediaFolder.deleteMany();
        await tx.session.deleteMany();
        await tx.verification.deleteMany();
        await tx.inviteToken.deleteMany();
        await tx.account.deleteMany();
        await tx.user.deleteMany();

        for (const user of users) {
          await tx.user.create({
            data: {
              id: String(user.id),
              name: String(user.name),
              email: String(user.email),
              emailVerified: Boolean(user.emailVerified),
              image: (user.image as string | null) ?? null,
              role: user.role === "EDITOR" ? "EDITOR" : "ADMIN",
              isMaster: Boolean(user.isMaster),
              createdAt: new Date(String(user.createdAt ?? Date.now())),
              updatedAt: new Date(String(user.updatedAt ?? Date.now())),
            },
          });
        }

        for (const account of accounts) {
          await tx.account.create({
            data: {
              id: String(account.id),
              issuer: String(account.issuer),
              accountId: String(account.accountId),
              providerId: String(account.providerId),
              userId: String(account.userId),
              password: (account.password as string | null) ?? null,
              accessToken: null,
              refreshToken: null,
              idToken: null,
              scope: (account.scope as string | null) ?? null,
              createdAt: new Date(String(account.createdAt ?? Date.now())),
              updatedAt: new Date(String(account.updatedAt ?? Date.now())),
            },
          });
        }

        for (const folder of asArray<Record<string, unknown>>(
          data["page-folders.json"],
        )) {
          await tx.pageFolder.create({
            data: {
              id: String(folder.id),
              name: String(folder.name),
              color: (folder.color as string | null) ?? null,
              parentId: null,
              isBase: Boolean(folder.isBase),
              createdAt: new Date(String(folder.createdAt ?? Date.now())),
              updatedAt: new Date(String(folder.updatedAt ?? Date.now())),
            },
          });
        }
        for (const folder of asArray<Record<string, unknown>>(
          data["page-folders.json"],
        )) {
          if (folder.parentId) {
            await tx.pageFolder.update({
              where: { id: String(folder.id) },
              data: { parentId: String(folder.parentId) },
            });
          }
        }

        for (const folder of asArray<Record<string, unknown>>(
          data["media-folders.json"],
        )) {
          await tx.mediaFolder.create({
            data: {
              id: String(folder.id),
              name: String(folder.name),
              color: (folder.color as string | null) ?? null,
              parentId: null,
              isBase: Boolean(folder.isBase),
              createdAt: new Date(String(folder.createdAt ?? Date.now())),
              updatedAt: new Date(String(folder.updatedAt ?? Date.now())),
            },
          });
        }
        for (const folder of asArray<Record<string, unknown>>(
          data["media-folders.json"],
        )) {
          if (folder.parentId) {
            await tx.mediaFolder.update({
              where: { id: String(folder.id) },
              data: { parentId: String(folder.parentId) },
            });
          }
        }

        for (const page of asArray<Record<string, unknown>>(
          data["pages.json"],
        )) {
          const pageData = stripPublishedPointerForInsert(page);
          await tx.page.create({
            data: {
              id: String(pageData.id),
              title: String(pageData.title),
              slug: String(pageData.slug),
              content: String(pageData.content ?? ""),
              seoTitle: (pageData.seoTitle as string | null) ?? null,
              seoDescription:
                (pageData.seoDescription as string | null) ?? null,
              seoKeyword: (pageData.seoKeyword as string | null) ?? null,
              status: pageData.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
              folderId: String(pageData.folderId),
              authorId: String(pageData.authorId),
              publishedAt: pageData.publishedAt
                ? new Date(String(pageData.publishedAt))
                : null,
              deletedAt: pageData.deletedAt
                ? new Date(String(pageData.deletedAt))
                : null,
              createdAt: new Date(String(pageData.createdAt ?? Date.now())),
              updatedAt: new Date(String(pageData.updatedAt ?? Date.now())),
            },
          });
        }

        for (const revision of asArray<Record<string, unknown>>(
          data["page-revisions.json"],
        )) {
          await tx.pageRevision.create({
            data: {
              id: String(revision.id),
              pageId: String(revision.pageId),
              title: String(revision.title),
              slug: String(revision.slug),
              content: String(revision.content ?? ""),
              seoTitle: (revision.seoTitle as string | null) ?? null,
              seoDescription:
                (revision.seoDescription as string | null) ?? null,
              seoKeyword: (revision.seoKeyword as string | null) ?? null,
              folderId: String(revision.folderId),
              authorId: String(revision.authorId),
              fingerprint: String(revision.fingerprint),
              pinned: Boolean(revision.pinned),
              createdAt: new Date(String(revision.createdAt ?? Date.now())),
            },
          });
        }
        for (const page of asArray<Record<string, unknown>>(
          data["pages.json"],
        )) {
          if (!page.publishedRevisionId) continue;
          await tx.page.update({
            where: { id: String(page.id) },
            data: { publishedRevisionId: String(page.publishedRevisionId) },
          });
        }

        for (const media of asArray<Record<string, unknown>>(
          data["media.json"],
        )) {
          await tx.mediaFile.create({
            data: {
              id: String(media.id),
              name: String(media.name),
              fileName: String(media.fileName),
              url: String(media.url),
              mimeType: String(media.mimeType),
              category: media.category as
                "IMAGE_RASTER" | "IMAGE_SVG" | "DOCUMENT_PDF" | "VIDEO_MP4",
              sizeBytes: Number(media.sizeBytes ?? 0),
              alt: (media.alt as string | null) ?? null,
              description: (media.description as string | null) ?? null,
              folderId: String(media.folderId),
              processingStatus: "READY",
              processingToken: null,
              createdAt: new Date(String(media.createdAt ?? Date.now())),
              updatedAt: new Date(String(media.updatedAt ?? Date.now())),
            },
          });
        }

        const custom = data["custom-code.json"] as
          | {
              snippets?: Array<Record<string, unknown>>;
              scopes?: Array<{ snippetId: string; pageId: string }>;
            }
          | undefined;

        for (const snippet of asArray<Record<string, unknown>>(
          custom?.snippets,
        )) {
          const snippetData = stripPublishedPointerForInsert(snippet);
          await tx.snippet.create({
            data: {
              id: String(snippetData.id),
              name: String(snippetData.name),
              location: snippetData.location as
                "HEADER" | "BODY_START" | "BODY_END",
              content: String(snippetData.content ?? ""),
              status:
                snippetData.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
              priority: (snippetData.priority as number | null) ?? null,
              scopeType:
                snippetData.scopeType === "SPECIFIC_PAGES"
                  ? "SPECIFIC_PAGES"
                  : "ALL_PAGES",
              createdAt: new Date(String(snippetData.createdAt ?? Date.now())),
              updatedAt: new Date(String(snippetData.updatedAt ?? Date.now())),
            },
          });
        }
        for (const revision of asArray<Record<string, unknown>>(
          data["snippet-revisions.json"],
        )) {
          await tx.snippetRevision.create({
            data: {
              id: String(revision.id),
              snippetId: String(revision.snippetId),
              name: String(revision.name),
              location: revision.location as
                "HEADER" | "BODY_START" | "BODY_END",
              content: String(revision.content ?? ""),
              priority: (revision.priority as number | null) ?? null,
              scopeType:
                revision.scopeType === "SPECIFIC_PAGES"
                  ? "SPECIFIC_PAGES"
                  : "ALL_PAGES",
              pageIds: Array.isArray(revision.pageIds)
                ? revision.pageIds.map((pageId) => String(pageId))
                : [],
              triggerType: (revision.triggerType as never) ?? null,
              triggerConfig: (revision.triggerConfig as never) ?? null,
              maxDisplays: (revision.maxDisplays as number | null) ?? null,
              displayResetDays:
                (revision.displayResetDays as number | null) ?? null,
              authorId: String(revision.authorId),
              fingerprint: String(revision.fingerprint),
              pinned: Boolean(revision.pinned),
              createdAt: new Date(String(revision.createdAt ?? Date.now())),
            },
          });
        }
        for (const snippet of asArray<Record<string, unknown>>(
          custom?.snippets,
        )) {
          if (!snippet.publishedRevisionId) continue;
          await tx.snippet.update({
            where: { id: String(snippet.id) },
            data: {
              publishedRevisionId: String(snippet.publishedRevisionId),
            },
          });
        }
        for (const scope of asArray<{ snippetId: string; pageId: string }>(
          custom?.scopes,
        )) {
          await tx.snippetPageScope.create({
            data: {
              snippetId: scope.snippetId,
              pageId: scope.pageId,
            },
          });
        }

        const splits = data["split-tests.json"] as
          | {
              campaigns?: Array<Record<string, unknown>>;
              destinations?: Array<Record<string, unknown>>;
            }
          | undefined;

        for (const campaign of asArray<Record<string, unknown>>(
          splits?.campaigns,
        )) {
          await tx.splitCampaign.create({
            data: {
              id: String(campaign.id),
              name: String(campaign.name),
              slug: String(campaign.slug),
              status: campaign.status === "PAUSED" ? "PAUSED" : "ACTIVE",
              authorId: String(campaign.authorId),
              createdAt: new Date(String(campaign.createdAt ?? Date.now())),
              updatedAt: new Date(String(campaign.updatedAt ?? Date.now())),
            },
          });
        }
        for (const dest of asArray<Record<string, unknown>>(
          splits?.destinations,
        )) {
          await tx.splitDestination.create({
            data: {
              id: String(dest.id),
              campaignId: String(dest.campaignId),
              url: String(dest.url),
              label: (dest.label as string | null) ?? null,
              status: dest.status === "PAUSED" ? "PAUSED" : "ACTIVE",
              sortOrder: Number(dest.sortOrder ?? 0),
              hitCount: Number(dest.hitCount ?? 0),
              createdAt: new Date(String(dest.createdAt ?? Date.now())),
              updatedAt: new Date(String(dest.updatedAt ?? Date.now())),
            },
          });
        }

        const settingsData = data["settings.json"] as Record<
          string,
          unknown
        > | null;
        if (settingsData) {
          await tx.siteSettings.update({
            where: { id: "singleton" },
            data: {
              siteTitle: String(settingsData.siteTitle ?? "Kastir"),
              tagline: (settingsData.tagline as string | null) ?? null,
              seoDescription:
                (settingsData.seoDescription as string | null) ?? null,
              faviconMediaId:
                (settingsData.faviconMediaId as string | null) ?? null,
              siteUrl: targetOrigin,
              siteLanguage: String(settingsData.siteLanguage ?? "en"),
              timezone: String(settingsData.timezone ?? "UTC"),
              dateFormat:
                (settingsData.dateFormat as "DD/MM/YYYY") ?? "DD/MM/YYYY",
              timeFormat: (settingsData.timeFormat as "24H") ?? "24H",
              weekStartsOn: (settingsData.weekStartsOn as "SUNDAY") ?? "SUNDAY",
              homePageId: (settingsData.homePageId as string | null) ?? null,
              indexable: Boolean(settingsData.indexable ?? true),
              sitemapEnabled: Boolean(settingsData.sitemapEnabled ?? true),
              notFoundPageId:
                (settingsData.notFoundPageId as string | null) ?? null,
              notFoundRedirectToHome: Boolean(
                settingsData.notFoundRedirectToHome ?? false,
              ),
              allowAiCrawlers: Boolean(settingsData.allowAiCrawlers ?? true),
              cloudflareApiTokenEncrypted: preservedToken,
              cloudflareZoneId: preservedZone,
              webpConversionEnabled: Boolean(
                settingsData.webpConversionEnabled ?? true,
              ),
            },
          });
        } else {
          await tx.siteSettings.update({
            where: { id: "singleton" },
            data: { siteUrl: targetOrigin },
          });
        }
      });

      // 3) Promote staged media into public uploads, then drop orphans
      await this.mediaCutover.promoteStaged(stageToken, opened.assets);
      await this.mediaCutover.removeOrphanUploads(keepMediaIds);
      await this.mediaCutover.cleanupStaging(stageToken);
    } catch (error) {
      await this.mediaCutover.cleanupStaging(stageToken).catch(() => undefined);
      throw error;
    }

    // 4) Master bootstrap is required (hard fail)
    try {
      await bootstrapMaster(this.database);
    } catch (error) {
      throw new BackupDomainError(
        "INTERNAL_ERROR",
        `Package applied but Master bootstrap failed: ${
          error instanceof Error ? error.message : "unknown error"
        }. Use a recovery snapshot if you cannot sign in.`,
      );
    }

    const master = await this.database.user.findFirst({
      where: { isMaster: true },
    });
    if (!master) {
      throw new BackupDomainError(
        "INTERNAL_ERROR",
        "Package applied but no Master user exists after bootstrap",
      );
    }

    // 5) Rebuild published pages
    try {
      const published = await this.database.page.findMany({
        where: { status: "PUBLISHED", deletedAt: null },
        select: { id: true },
      });
      const queue = this.getQueue();
      for (const page of published) {
        await queue.add(
          "page-rebuild",
          { type: "page-rebuild", pageId: page.id },
          { jobId: `rebuild-after-backup-${page.id}-${Date.now()}` },
        );
      }
      if (published.length > 0) {
        await queue.add(
          "settings-rebuild",
          {
            type: "settings-rebuild",
            operationId: randomUUID(),
            scope: "GLOBAL",
            pageIds: published.map((p) => p.id),
          },
          { jobId: `settings-rebuild-backup-${Date.now()}` },
        );
      }
    } catch {
      // queue optional in unit context
    }
  }
}

export const backupService = new BackupService();
