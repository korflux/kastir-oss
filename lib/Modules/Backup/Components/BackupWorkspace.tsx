"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, Plus } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { PanelDictionary } from "@/lib/i18n/panel";
import {
  BACKUP_AUTO_INTERVAL_DAYS_MAX,
  RESTORE_CONFIRMATION_PHRASE,
} from "@/lib/Modules/Backup/constants";
import type { BackupJobRecord, SnapshotMeta } from "@/lib/Modules/Backup/Types";

type BackupCopy = PanelDictionary["backup"];

export type BackupAutoScheduleState = {
  enabled: boolean;
  intervalDays: number;
  hour: number;
  minute: number;
  timezone: string;
  /** Presente na resposta do POST schedule; ausente no GET. */
  schedulerApplied?: boolean;
};

type Props = {
  copy: BackupCopy;
  initialSnapshots: SnapshotMeta[];
  initialSchedule: BackupAutoScheduleState;
};

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function timeValue(hour: number, minute: number) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * Aba Backup do Setup (Figma Setup BACKUPS.png).
 * Restore por snapshot → ConfirmDialog escrito; Import mantém input inline.
 */
export function BackupWorkspace({
  copy,
  initialSnapshots,
  initialSchedule,
}: Props) {
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [job, setJob] = useState<BackupJobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importConfirmation, setImportConfirmation] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [sessionEndedFor, setSessionEndedFor] = useState<
    "restore" | "import" | null
  >(null);
  const [targetOrigin, setTargetOrigin] = useState(
    typeof window !== "undefined" ? window.location.origin : "",
  );
  // Form do agendamento automático (estado local até salvar).
  const [scheduleEnabled, setScheduleEnabled] = useState(
    initialSchedule.enabled,
  );
  const [scheduleIntervalDays, setScheduleIntervalDays] = useState(
    String(initialSchedule.intervalDays),
  );
  const [scheduleTime, setScheduleTime] = useState(
    timeValue(initialSchedule.hour, initialSchedule.minute),
  );
  const [scheduleTimezone, setScheduleTimezone] = useState(
    initialSchedule.timezone,
  );
  const [savingSchedule, setSavingSchedule] = useState(false);

  const refreshSnapshots = useCallback(async () => {
    const response = await fetch("/api/admin/backup", { cache: "no-store" });
    const body = await readJson(response);
    if (!response.ok) {
      setError(typeof body.error === "string" ? body.error : copy.error);
      return;
    }
    setSnapshots((body.snapshots as SnapshotMeta[]) ?? []);
    const schedule = body.schedule as BackupAutoScheduleState | undefined;
    if (schedule) {
      setScheduleEnabled(schedule.enabled);
      setScheduleIntervalDays(String(schedule.intervalDays));
      setScheduleTime(timeValue(schedule.hour, schedule.minute));
      setScheduleTimezone(schedule.timezone);
    }
  }, [copy.error]);

  useEffect(() => {
    if (!job || job.status === "ready" || job.status === "failed") return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/admin/backup/jobs/${job.id}`, {
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        clearInterval(timer);
        if (job.kind === "restore" || job.kind === "import") {
          // 401 pós-restore/import = sessões apagadas (sucesso), não falha.
          setSessionEndedFor(job.kind);
          setJob(null);
        } else {
          setError(copy.sessionExpired);
          setJob((prev) =>
            prev
              ? { ...prev, status: "failed", error: copy.sessionExpired }
              : prev,
          );
        }
        return;
      }
      if (!response.ok) return;
      const body = await readJson(response);
      const next = body.job as BackupJobRecord;
      setJob(next);
      if (next.status === "ready") {
        setMessage(
          next.kind === "export"
            ? copy.successExport
            : next.kind === "import"
              ? copy.successImport
              : copy.successRestore,
        );
        void refreshSnapshots();
      }
      if (next.status === "failed") {
        setError(next.error ?? copy.error);
        void refreshSnapshots();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [job, copy, refreshSnapshots]);

  async function handleExport() {
    setError(null);
    setMessage(null);
    setExporting(true);
    try {
      const response = await fetch("/api/admin/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export" }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : copy.error);
        return;
      }
      setJob(body.job as BackupJobRecord);
    } catch {
      setError(copy.error);
    } finally {
      setExporting(false);
    }
  }

  async function handleStageImport() {
    if (!file) return;
    setError(null);
    setMessage(null);
    setImporting(true);
    try {
      const form = new FormData();
      form.set("file", file);
      if (targetOrigin) form.set("targetOrigin", targetOrigin);
      const response = await fetch("/api/admin/backup/import", {
        method: "POST",
        body: form,
      });
      const body = await readJson(response);
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : copy.error);
        return;
      }
      setJob(body.job as BackupJobRecord);
    } catch {
      setError(copy.error);
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmImport() {
    if (!job || job.kind !== "import") return;
    setError(null);
    setImporting(true);
    try {
      const response = await fetch("/api/admin/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          confirmation: importConfirmation,
          targetOrigin: job.dryRun?.targetOrigin ?? targetOrigin,
          sourceOrigin: job.dryRun?.sourceOrigin,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : copy.error);
        return;
      }
      setJob(body.job as BackupJobRecord);
      setImportConfirmation("");
    } catch {
      setError(copy.error);
    } finally {
      setImporting(false);
    }
  }

  async function handleRestore(snapshotId: string, confirmation: string) {
    setError(null);
    setMessage(null);
    setRestoringId(snapshotId);
    try {
      const [response] = await Promise.all([
        fetch(`/api/admin/backup/snapshots/${snapshotId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation }),
        }),
        new Promise((resolve) => setTimeout(resolve, 900)),
      ]);
      const body = await readJson(response);
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : copy.error);
        return;
      }
      setJob(body.job as BackupJobRecord);
      setPendingRestoreId(null);
    } catch {
      setError(copy.error);
    } finally {
      setRestoringId(null);
    }
  }

  async function handleDelete(snapshotId: string) {
    setError(null);
    const response = await fetch(`/api/admin/backup/snapshots/${snapshotId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const body = await readJson(response);
      setError(typeof body.error === "string" ? body.error : copy.error);
      return;
    }
    await refreshSnapshots();
  }

  async function handleSaveSchedule() {
    setError(null);
    setMessage(null);
    const intervalDays = Number.parseInt(scheduleIntervalDays, 10);
    if (
      !Number.isFinite(intervalDays) ||
      intervalDays < 1 ||
      intervalDays > BACKUP_AUTO_INTERVAL_DAYS_MAX
    ) {
      setError(copy.autoInvalidInterval);
      return;
    }
    // type=time pode devolver HH:MM ou HH:MM:SS conforme o browser.
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(scheduleTime);
    if (!match) {
      setError(copy.error);
      return;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
      setError(copy.error);
      return;
    }

    setSavingSchedule(true);
    try {
      const response = await fetch("/api/admin/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "schedule",
          enabled: scheduleEnabled,
          intervalDays,
          hour,
          minute,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : copy.error);
        return;
      }
      const schedule = body.schedule as BackupAutoScheduleState | undefined;
      if (schedule) {
        setScheduleEnabled(schedule.enabled);
        setScheduleIntervalDays(String(schedule.intervalDays));
        setScheduleTime(timeValue(schedule.hour, schedule.minute));
        setScheduleTimezone(schedule.timezone);
      }
      setMessage(
        schedule?.schedulerApplied === false
          ? copy.autoSavedSchedulerDeferred
          : copy.autoSaved,
      );
    } catch {
      setError(copy.error);
    } finally {
      setSavingSchedule(false);
    }
  }

  return (
    <section
      className="flex w-full flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-8 xl:px-10"
      data-testid="setup-backup"
    >
      <header>
        <h1 className="text-foreground text-4xl font-semibold tracking-tight md:text-5xl">
          {copy.title}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-3xl text-base">
          {copy.description}
        </p>
      </header>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-green-700 dark:text-green-400" role="status">
          {message}
        </p>
      ) : null}
      {job ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
          <span>
            {copy.jobStatus}: {job.kind} — {job.status}
            {job.progress != null ? ` (${job.progress}%)` : ""}
            {job.dryRun
              ? ` · ${copy.replacements}: ${job.dryRun.replacements}`
              : ""}
          </span>
          {job.kind === "export" && job.status === "ready" && job.snapshotId ? (
            <a
              className="text-primary font-medium underline-offset-4 hover:underline"
              href={`/api/admin/backup/snapshots/${job.snapshotId}`}
            >
              {copy.downloadExport}
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Criar snapshot */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-sm">
          {copy.exportTitle}
        </span>
        <Button
          className="rounded-full"
          disabled={exporting}
          type="button"
          variant="outline"
          onClick={() => void handleExport()}
        >
          <Plus className="text-brand size-4" />
          {exporting ? copy.exportWorking : copy.createSnapshot}
        </Button>
      </div>

      {/* Backup automático — toggle, intervalo, horário no fuso do site. */}
      <div
        className="bg-muted/20 border-border space-y-4 rounded-xl border p-4"
        data-testid="setup-backup-auto"
      >
        <div>
          <h2 className="text-sm font-medium">{copy.autoTitle}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {copy.autoDescription}
          </p>
        </div>
        <label
          className="flex items-center gap-3 text-sm"
          htmlFor="backup-auto-enabled"
        >
          <Switch
            checked={scheduleEnabled}
            id="backup-auto-enabled"
            onCheckedChange={setScheduleEnabled}
          />
          <span>{copy.autoEnabled}</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label
              className="text-muted-foreground text-sm"
              htmlFor="backup-auto-interval"
            >
              {copy.autoIntervalDays}
            </label>
            <Input
              className="h-9"
              id="backup-auto-interval"
              inputMode="numeric"
              max={BACKUP_AUTO_INTERVAL_DAYS_MAX}
              min={1}
              step={1}
              type="number"
              value={scheduleIntervalDays}
              onChange={(event) => setScheduleIntervalDays(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label
              className="text-muted-foreground text-sm"
              htmlFor="backup-auto-time"
            >
              {copy.autoTime}
            </label>
            <Input
              className="h-9"
              id="backup-auto-time"
              type="time"
              value={scheduleTime}
              onChange={(event) => setScheduleTime(event.target.value)}
            />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          {copy.autoTimezone.replace("{timezone}", scheduleTimezone)}
        </p>
        <Button
          className="rounded-full"
          disabled={savingSchedule}
          type="button"
          variant="outline"
          onClick={() => void handleSaveSchedule()}
        >
          {savingSchedule ? copy.autoSaving : copy.autoSave}
        </Button>
      </div>

      {/* History */}
      <div className="bg-muted/20 border-border rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{copy.historyTitle}</h2>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => void refreshSnapshots()}
          >
            {copy.refresh}
          </Button>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.historyEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshots.map((snap) => (
              <li
                key={snap.id}
                className="border-border flex flex-col gap-2 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[0.7rem]">
                  Type: &quot;{RESTORE_CONFIRMATION_PHRASE}&quot;
                </span>
                <Button
                  className="rounded-full"
                  disabled={restoringId === snap.id}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => setPendingRestoreId(snap.id)}
                >
                  {restoringId === snap.id ? copy.restoreWorking : copy.restore}
                </Button>
                <a
                  aria-label={copy.download}
                  className={buttonVariants({
                    size: "icon-sm",
                    variant: "ghost",
                  })}
                  href={`/api/admin/backup/snapshots/${snap.id}`}
                >
                  <Download className="size-4" />
                </a>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span>{snap.siteTitle || snap.id}</span>
                    {snap.safety ? (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-200">
                        {copy.recoveryBadge}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {new Date(snap.createdAt).toLocaleString()} ·{" "}
                    {(snap.sizeBytes / 1024).toFixed(1)} KB · v
                    {snap.kastirVersion} · {snap.origin}
                  </p>
                </div>
                <Button
                  className="rounded-full"
                  disabled={restoringId === snap.id}
                  size="sm"
                  type="button"
                  variant="destructive"
                  onClick={() => void handleDelete(snap.id)}
                >
                  {copy.delete}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Import package — confirmação inline (mockup). */}
      <div className="bg-muted/20 border-border space-y-4 rounded-xl border p-4">
        <h2 className="text-sm font-medium">{copy.importTitle}</h2>
        <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
          <label
            className="text-muted-foreground text-sm"
            htmlFor="backup-file"
          >
            {copy.importChooseFile}
          </label>
          <Input
            accept=".kastir,.zip,application/zip"
            className="h-9"
            id="backup-file"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button
            className="rounded-full"
            type="button"
            variant="outline"
            onClick={() => document.getElementById("backup-file")?.click()}
          >
            <Plus className="size-4" />
            {copy.selectArchive}
          </Button>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:items-center">
          <label
            className="text-muted-foreground text-sm"
            htmlFor="target-origin"
          >
            {copy.targetOrigin}
          </label>
          <Input
            className="h-9"
            id="target-origin"
            value={targetOrigin}
            onChange={(event) => setTargetOrigin(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:items-center">
          <label
            className="text-muted-foreground text-sm"
            htmlFor="confirm-import"
          >
            {copy.confirmationLabel}
          </label>
          <Input
            autoComplete="off"
            className="h-9"
            id="confirm-import"
            placeholder={copy.restoreConfirmPlaceholder}
            value={importConfirmation}
            onChange={(event) => setImportConfirmation(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="rounded-full"
            disabled={!file || importing}
            type="button"
            variant="outline"
            onClick={() => void handleStageImport()}
          >
            {importing ? copy.importWorking : copy.importStage}
          </Button>
          <Button
            className="rounded-full"
            disabled={
              !job ||
              job.kind !== "import" ||
              job.status !== "queued" ||
              importConfirmation !== RESTORE_CONFIRMATION_PHRASE ||
              importing
            }
            type="button"
            variant="destructive"
            onClick={() => void handleConfirmImport()}
          >
            {copy.importConfirm}
          </Button>
        </div>
      </div>

      {/* Restore: ConfirmDialog com frase escrita. */}
      <ConfirmDialog
        busy={restoringId !== null}
        busyLabel={copy.restoreWorking}
        cancelLabel={copy.cancel}
        closeLabel={copy.close}
        confirmLabel={copy.restore}
        description={copy.confirmationHint}
        destructive
        expectedText={RESTORE_CONFIRMATION_PHRASE}
        expectedTextLabel={copy.confirmationLabel}
        expectedTextPlaceholder={copy.restoreConfirmPlaceholder}
        open={pendingRestoreId !== null}
        title={copy.restore}
        onConfirm={async () => {
          if (!pendingRestoreId) return;
          // ConfirmDialog só habilita com frase exata — reenvia a frase canônica.
          await handleRestore(pendingRestoreId, RESTORE_CONFIRMATION_PHRASE);
        }}
        onOpenChange={(open) => {
          if (!open && restoringId === null) setPendingRestoreId(null);
        }}
      />

      <Dialog
        open={sessionEndedFor !== null}
        onOpenChange={(open) => {
          if (!open) setSessionEndedFor(null);
        }}
      >
        <DialogContent closeLabel={copy.close}>
          <DialogHeader>
            <DialogTitle>{copy.sessionEndedTitle}</DialogTitle>
            <DialogDescription>
              {sessionEndedFor === "import"
                ? copy.sessionEndedImportDescription
                : copy.sessionEndedRestoreDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Link
              className={buttonVariants({ variant: "default" })}
              href="/admin/login"
            >
              {copy.goToLogin}
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
