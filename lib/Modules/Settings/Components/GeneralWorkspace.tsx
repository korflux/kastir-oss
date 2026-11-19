"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ConfirmDialog } from "@/components/Shared/ConfirmDialog";
import { MediaPickerDialog } from "@/components/Shared/MediaPickerDialog";
import { RequiredMark } from "@/components/Shared/RequiredMark";
import { Button } from "@/components/ui/button";
import { SeoDot } from "@/lib/Modules/Pages/Components/SeoFields";
import type { PanelDictionary } from "@/lib/i18n/panel";
import type { PublicSiteSettings } from "@/lib/Modules/Settings/Types";
import {
  applySettingsResponse,
  buildSettingsPayload,
  fieldClass,
  initialForm,
  labelClass,
  type SettingsFormState,
} from "@/lib/Modules/Settings/Components/settingsFormShared";

type SettingsCopy = PanelDictionary["settings"];

type SettingsOptions = {
  faviconMedia: Array<{
    id: string;
    name: string;
    url: string;
    category: string;
  }>;
  homePages: Array<{ id: string; title: string; slug: string }>;
};

/**
 * Aba General do Setup — identidade do site (Figma Setup.png).
 * Autosave no blur; PUT manda o objeto completo (campos de Settings intactos).
 */
export function GeneralWorkspace({
  copy,
  initialSettings,
  options,
}: {
  copy: SettingsCopy;
  initialSettings: PublicSiteSettings;
  options: SettingsOptions;
}) {
  const [form, setForm] = useState(() => initialForm(initialSettings));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Snapshot do form no último save bem-sucedido — evita save no blur sem mudança. */
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(buildSettingsPayload(initialForm(initialSettings))),
  );

  const update = <Key extends keyof SettingsFormState>(
    key: Key,
    value: SettingsFormState[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError(null);
  };

  const performSave = async (payload: Record<string, unknown>) => {
    if (
      !String(payload.siteTitle ?? "")
        .toString()
        .trim()
    ) {
      setError(copy.invalidTitle);
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        code?: string;
        settings?: PublicSiteSettings;
      };
      if (response.status === 409 && body.code === "CONFIRMATION_REQUIRED") {
        setPendingPayload(payload);
        setConfirmOpen(true);
        return;
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(copy.error);
      }
      if (body.settings) {
        const next = applySettingsResponse(form, body.settings);
        setForm(next);
        setSavedSnapshot(JSON.stringify(buildSettingsPayload(next)));
      } else {
        setSavedSnapshot(JSON.stringify(payload));
      }
      setSaved(true);
      if (response.status === 202) setError(copy.queueFailed);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.error);
    } finally {
      setSaving(false);
    }
  };

  /** Autosave: só se o payload mudou desde o último save. */
  const saveIfDirty = async () => {
    const payload = buildSettingsPayload(form);
    if (JSON.stringify(payload) === savedSnapshot) return;
    await performSave(payload);
  };

  const selectedMedia = options.faviconMedia.find(
    (media) => media.id === form.faviconMediaId,
  );

  return (
    <section
      aria-busy={saving}
      className="flex w-full flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-8 xl:px-10"
      data-testid="setup-general"
    >
      <header className="shrink-0">
        <h1 className="text-foreground text-4xl font-semibold tracking-tight md:text-5xl">
          {copy.generalTitle}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-base">
          {copy.generalDescription}
        </p>
        {(saving || saved || error) && (
          <p
            className={
              error
                ? "text-destructive mt-2 text-sm"
                : "text-muted-foreground mt-2 text-sm"
            }
            role={error ? "alert" : "status"}
          >
            {error ?? (saving ? copy.saving : copy.saved)}
          </p>
        )}
      </header>

      <div className="flex max-w-3xl flex-col gap-6">
        {/* Bloco 1: título / tagline / SEO */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className={labelClass()} htmlFor="site-title">
              {copy.siteTitle}
              <RequiredMark />
            </label>
            <input
              className={fieldClass()}
              id="site-title"
              maxLength={200}
              required
              value={form.siteTitle}
              onBlur={() => void saveIfDirty()}
              onChange={(event) => update("siteTitle", event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass()} htmlFor="tagline">
              {copy.tagline}
            </label>
            <input
              className={fieldClass()}
              id="tagline"
              maxLength={200}
              value={form.tagline}
              onBlur={() => void saveIfDirty()}
              onChange={(event) => update("tagline", event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label
              className="text-muted-foreground flex items-center gap-1.5 text-sm"
              htmlFor="seo-description"
            >
              {copy.seoDescription}
              <SeoDot />
            </label>
            <textarea
              className="border-input bg-muted/40 focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-lg border px-2.5 py-2 text-sm outline-none focus-visible:ring-3"
              id="seo-description"
              maxLength={320}
              value={form.seoDescription}
              onBlur={() => void saveIfDirty()}
              onChange={(event) => update("seoDescription", event.target.value)}
            />
          </div>
        </div>

        <hr className="border-border" />

        {/* Bloco 2: URL / ícone / idioma */}
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <label className={labelClass()} htmlFor="site-url">
              {copy.url}
              <RequiredMark />
            </label>
            <input
              className={fieldClass()}
              id="site-url"
              inputMode="url"
              placeholder="https://example.com"
              value={form.siteUrl}
              onBlur={() => void saveIfDirty()}
              onChange={(event) => update("siteUrl", event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1 space-y-1.5">
              <label className={labelClass()} htmlFor="favicon-display">
                {copy.favicon}
                <RequiredMark />
              </label>
              <input
                className={fieldClass()}
                id="favicon-display"
                readOnly
                value={selectedMedia?.name ?? ""}
                onClick={() => setPickerOpen(true)}
              />
            </div>
            <Button
              className="rounded-full"
              type="button"
              variant="outline"
              onClick={() => setPickerOpen(true)}
            >
              <Plus className="size-4" />
              {copy.selectMedia}
            </Button>
            {form.faviconMediaId ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  update("faviconMediaId", "");
                  // Clear + autosave no próximo tick com form atualizado via performSave.
                  void performSave(
                    buildSettingsPayload({ ...form, faviconMediaId: "" }),
                  );
                }}
              >
                {copy.clearMedia}
              </Button>
            ) : null}
          </div>
          <div className="max-w-xs space-y-1.5">
            <label className={labelClass()} htmlFor="site-language">
              {copy.siteLanguage}
            </label>
            <select
              className={fieldClass()}
              id="site-language"
              value={form.siteLanguage}
              onChange={(event) => {
                const next = {
                  ...form,
                  siteLanguage: event.target.value,
                };
                setForm(next);
                setSaved(false);
                void performSave(buildSettingsPayload(next));
              }}
            >
              <option value="en">{copy.formats.en}</option>
              <option value="pt-BR">{copy.formats.ptBR}</option>
            </select>
          </div>
        </div>
      </div>

      <MediaPickerDialog
        cancelLabel={copy.cancel}
        closeLabel={copy.close}
        open={pickerOpen}
        selectLabel={copy.selectMedia}
        selectedId={form.faviconMediaId}
        title={copy.favicon}
        onOpenChange={setPickerOpen}
        onSelect={(item) => {
          const next = { ...form, faviconMediaId: item.id };
          setForm(next);
          setPickerOpen(false);
          void performSave(buildSettingsPayload(next));
        }}
      />
      <ConfirmDialog
        busy={saving}
        busyLabel={copy.saving}
        cancelLabel={copy.cancel}
        closeLabel={copy.close}
        confirmLabel={copy.confirm}
        description={copy.confirmUrlDescription}
        open={confirmOpen}
        title={copy.confirmUrlTitle}
        onConfirm={async () => {
          if (!pendingPayload) return;
          setConfirmOpen(false);
          await performSave({ ...pendingPayload, confirmSiteUrl: true });
        }}
        onOpenChange={setConfirmOpen}
      />
    </section>
  );
}
