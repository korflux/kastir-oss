"use client";

import { useMemo, useState } from "react";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import type { PanelDictionary } from "@/lib/i18n/panel";
import {
  REVISION_RETENTION_MAX,
  REVISION_RETENTION_MIN,
} from "@/lib/Modules/Settings/revisionRetention";
import type {
  PublicSiteSettings,
  WeekStart,
} from "@/lib/Modules/Settings/Types";
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

type SearchOption = { value: string; label: string };

function SearchSelect({
  id,
  options,
  value,
  placeholder,
  disabled = false,
  onChange,
}: {
  id: string;
  options: SearchOption[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <Combobox
      items={options}
      value={selected}
      disabled={disabled}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
      isItemEqualToValue={(left, right) => left.value === right.value}
      onValueChange={(next) => onChange(next?.value ?? "")}
    >
      <div className="relative">
        <ComboboxInput
          aria-label={placeholder}
          disabled={disabled}
          id={id}
          placeholder={placeholder}
        />
      </div>
      <ComboboxPopup>
        <ComboboxList>
          {options.map((option) => (
            <ComboboxItem key={option.value || "empty"} value={option}>
              {option.label}
            </ComboboxItem>
          ))}
          <ComboboxEmpty>No matching pages.</ComboboxEmpty>
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

function SwitchField({
  id,
  label,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm" htmlFor={id}>
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        name={id}
        onCheckedChange={onCheckedChange}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Aba Settings do Setup — comportamento do site (Figma Setup SETTINGS.png).
 * Autosave por campo; PUT manda o objeto completo (campos de General intactos).
 */
export function SettingsWorkspace({
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
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(buildSettingsPayload(initialForm(initialSettings))),
  );

  const pageOptions = useMemo(
    () =>
      options.homePages.map((page) => ({
        value: page.id,
        label: page.title + " (/" + page.slug + ")",
      })),
    [options.homePages],
  );
  const homeOptions = useMemo(
    () => [{ value: "", label: copy.homePageNone }, ...pageOptions],
    [copy.homePageNone, pageOptions],
  );
  const notFoundOptions = useMemo(
    () => [{ value: "", label: copy.notFoundNone }, ...pageOptions],
    [copy.notFoundNone, pageOptions],
  );
  const timezoneOptions = useMemo(() => {
    const offsets = Array.from({ length: 27 }, (_, index) => index - 12)
      .filter((offset) => offset !== 0)
      .map((offset) => "UTC" + (offset > 0 ? "+" : "") + offset);
    return [
      "UTC",
      ...offsets,
      "America/Sao_Paulo",
      "America/New_York",
      "Europe/Lisbon",
    ];
  }, []);
  const weekDays: Array<{ value: WeekStart; label: string }> = [
    { value: "SUNDAY", label: copy.formats.sunday },
    { value: "MONDAY", label: copy.formats.monday },
    { value: "TUESDAY", label: copy.formats.tuesday },
    { value: "WEDNESDAY", label: copy.formats.wednesday },
    { value: "THURSDAY", label: copy.formats.thursday },
    { value: "FRIDAY", label: copy.formats.friday },
    { value: "SATURDAY", label: copy.formats.saturday },
  ];

  const performSave = async (nextForm: SettingsFormState) => {
    const payload = buildSettingsPayload(nextForm);
    if (JSON.stringify(payload) === savedSnapshot) return;
    if (!nextForm.siteTitle.trim()) {
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
      if (!response.ok && response.status !== 202) {
        throw new Error(copy.error);
      }
      if (body.settings) {
        const applied = applySettingsResponse(nextForm, body.settings);
        setForm(applied);
        setSavedSnapshot(JSON.stringify(buildSettingsPayload(applied)));
      } else {
        setForm(nextForm);
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

  const patchAndSave = <Key extends keyof SettingsFormState>(
    key: Key,
    value: SettingsFormState[Key],
    extra?: Partial<SettingsFormState>,
  ) => {
    const next = { ...form, [key]: value, ...extra };
    setForm(next);
    setSaved(false);
    setError(null);
    void performSave(next);
  };

  return (
    <section
      aria-busy={saving}
      className="flex w-full flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-8 xl:px-10"
      data-testid="setup-settings"
    >
      <header className="shrink-0">
        <h1 className="text-foreground text-4xl font-semibold tracking-tight md:text-5xl">
          {copy.settingsTitle}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-3xl text-base">
          {copy.settingsDescription}
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
        {/* Bloco 1: home / 404 / formatos */}
        <div className="grid gap-4">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
            <label className={`${labelClass()} sm:w-28`} htmlFor="home-page">
              {copy.homePage}
            </label>
            <div className="min-w-0 flex-1">
              <SearchSelect
                id="home-page"
                options={homeOptions}
                placeholder={copy.homePage}
                value={form.homePageId}
                onChange={(value) => patchAndSave("homePageId", value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <label
              className={`${labelClass()} sm:w-28`}
              htmlFor="not-found-page"
            >
              {copy.notFoundPageShort}
            </label>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <div className="min-w-[12rem] flex-1">
                <SearchSelect
                  disabled={form.notFoundRedirectToHome}
                  id="not-found-page"
                  options={notFoundOptions}
                  placeholder={copy.notFoundPage}
                  value={form.notFoundPageId}
                  onChange={(value) => patchAndSave("notFoundPageId", value)}
                />
              </div>
              <span className="text-muted-foreground text-sm">{copy.or}</span>
              <SwitchField
                checked={form.notFoundRedirectToHome}
                id="not-found-redirect"
                label={copy.redirect404Short}
                onCheckedChange={(checked) =>
                  patchAndSave("notFoundRedirectToHome", checked, {
                    notFoundPageId: checked ? "" : form.notFoundPageId,
                  })
                }
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label className={`${labelClass()} sm:w-28`} htmlFor="timezone">
                {copy.timezone}
              </label>
              <select
                className={fieldClass()}
                id="timezone"
                value={form.timezone}
                onChange={(event) =>
                  patchAndSave("timezone", event.target.value)
                }
              >
                {timezoneOptions.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label
                className={`${labelClass()} sm:w-28`}
                htmlFor="date-format"
              >
                {copy.dateFormat}
              </label>
              <select
                className={fieldClass()}
                id="date-format"
                value={form.dateFormat}
                onChange={(event) =>
                  patchAndSave(
                    "dateFormat",
                    event.target.value as SettingsFormState["dateFormat"],
                  )
                }
              >
                <option value="DD/MM/YYYY">{copy.formats.dateDMY}</option>
                <option value="MM/DD/YYYY">{copy.formats.dateMDY}</option>
                <option value="YYYY-MM-DD">{copy.formats.dateISO}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label
                className={`${labelClass()} sm:w-28`}
                htmlFor="time-format"
              >
                {copy.timeFormat}
              </label>
              <select
                className={fieldClass()}
                id="time-format"
                value={form.timeFormat}
                onChange={(event) =>
                  patchAndSave(
                    "timeFormat",
                    event.target.value as SettingsFormState["timeFormat"],
                  )
                }
              >
                <option value="24H">{copy.formats.time24}</option>
                <option value="12H">{copy.formats.time12}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label
                className={`${labelClass()} sm:w-28`}
                htmlFor="week-starts-on"
              >
                {copy.weekStartsOn}
              </label>
              <select
                className={fieldClass()}
                id="week-starts-on"
                value={form.weekStartsOn}
                onChange={(event) =>
                  patchAndSave("weekStartsOn", event.target.value as WeekStart)
                }
              >
                {weekDays.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <hr className="border-border" />

        <div className="space-y-3">
          <h2 className="text-sm font-medium">{copy.indexing}</h2>
          <SwitchField
            checked={form.indexable}
            id="indexable"
            label={copy.indexable}
            onCheckedChange={(checked) => patchAndSave("indexable", checked)}
          />
          <SwitchField
            checked={form.allowAiCrawlers}
            id="allow-ai-crawlers"
            label={copy.allowAiCrawlers}
            onCheckedChange={(checked) =>
              patchAndSave("allowAiCrawlers", checked)
            }
          />
          <SwitchField
            checked={form.sitemapEnabled}
            id="sitemap-enabled"
            label={copy.sitemapEnabled}
            onCheckedChange={(checked) =>
              patchAndSave("sitemapEnabled", checked)
            }
          />
        </div>

        <hr className="border-border" />

        <div className="space-y-3">
          <h2 className="text-sm font-medium">{copy.cache}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={labelClass()} htmlFor="cloudflare-token">
                {copy.cloudflareToken}
              </label>
              <input
                autoComplete="new-password"
                className={fieldClass()}
                id="cloudflare-token"
                placeholder={
                  initialSettings.cloudflareApiTokenConfigured
                    ? copy.tokenPlaceholder
                    : undefined
                }
                type="password"
                value={form.cloudflareApiToken}
                onBlur={() => void performSave(form)}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    cloudflareApiToken: event.target.value,
                  }));
                  setSaved(false);
                }}
              />
              {initialSettings.cloudflareApiTokenConfigured ? (
                <p className="text-muted-foreground text-xs">
                  {copy.tokenConfigured}
                </p>
              ) : null}
              {initialSettings.cloudflareApiTokenConfigured ? (
                <label
                  className="mt-1 flex items-center gap-2 text-xs"
                  htmlFor="remove-token"
                >
                  <input
                    checked={form.removeCloudflareToken}
                    className="accent-primary size-3.5"
                    id="remove-token"
                    type="checkbox"
                    onChange={(event) =>
                      patchAndSave(
                        "removeCloudflareToken",
                        event.target.checked,
                      )
                    }
                  />
                  {copy.removeToken}
                </label>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label className={labelClass()} htmlFor="cloudflare-zone">
                {copy.cloudflareZoneId}
              </label>
              <input
                autoComplete="off"
                className={fieldClass()}
                id="cloudflare-zone"
                value={form.cloudflareZoneId}
                onBlur={() => void performSave(form)}
                onChange={(event) => {
                  setForm((current) => ({
                    ...current,
                    cloudflareZoneId: event.target.value,
                  }));
                  setSaved(false);
                }}
              />
            </div>
          </div>
        </div>

        <hr className="border-border" />

        <div className="space-y-3">
          <h2 className="text-sm font-medium">{copy.webp}</h2>
          <SwitchField
            checked={form.webpConversionEnabled}
            id="webp-conversion"
            label={copy.webpConversion}
            onCheckedChange={(checked) =>
              patchAndSave("webpConversionEnabled", checked)
            }
          />
        </div>

        <hr className="border-border" />

        <div className="space-y-3">
          <h2 className="text-sm font-medium">{copy.revisionRetention}</h2>
          <div className="space-y-1.5">
            <label className={labelClass()} htmlFor="revision-retention">
              {copy.revisionRetentionLimit}
            </label>
            <input
              className={fieldClass()}
              id="revision-retention"
              inputMode="numeric"
              max={REVISION_RETENTION_MAX}
              min={REVISION_RETENTION_MIN}
              type="number"
              value={form.revisionRetentionLimit}
              onBlur={() => void performSave(form)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setForm((current) => ({
                  ...current,
                  revisionRetentionLimit: Number.isFinite(next)
                    ? next
                    : current.revisionRetentionLimit,
                }));
                setSaved(false);
              }}
            />
            <p className="text-muted-foreground text-xs">
              {copy.revisionRetentionHelp}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
