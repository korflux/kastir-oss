import type {
  DateFormat,
  TimeFormat,
  WeekStart,
} from "@/lib/Modules/Settings/Types";

export type PanelFormatSettings = {
  timezone: string;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  weekStartsOn: WeekStart;
};

const defaultFormatSettings: PanelFormatSettings = {
  timezone: "UTC",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24H",
  weekStartsOn: "SUNDAY",
};

export function normalizePanelTimezone(timezone: string): string {
  const match = /^UTC([+-])(\d{1,2})$/.exec(timezone);
  if (!match) return timezone;
  const offset = Number(match[2]);
  if (offset === 0) return "UTC";
  const zone = "Etc/GMT" + (match[1] === "+" ? "-" : "+") + offset;
  try {
    // Etc/GMT only covers -14..+12; a bad stored value (legacy data, a
    // direct DB edit) must degrade to UTC instead of throwing on every date.
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

function partsFor(
  value: string | Date,
  settings: PanelFormatSettings,
  locale: string,
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: normalizePanelTimezone(settings.timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: settings.timeFormat === "12H",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatPanelDate(
  value: string | Date,
  settings: Partial<PanelFormatSettings> = {},
  locale = "en",
): string {
  const merged = { ...defaultFormatSettings, ...settings };
  const parts = partsFor(value, merged, locale);
  if (!parts) return "—";
  if (merged.dateFormat === "MM/DD/YYYY")
    return `${parts.month}/${parts.day}/${parts.year}`;
  if (merged.dateFormat === "YYYY-MM-DD")
    return `${parts.year}-${parts.month}-${parts.day}`;
  return `${parts.day}/${parts.month}/${parts.year}`;
}

export function formatPanelDateTime(
  value: string | Date,
  settings: Partial<PanelFormatSettings> = {},
  locale = "en",
): string {
  const merged = { ...defaultFormatSettings, ...settings };
  const parts = partsFor(value, merged, locale);
  if (!parts) return "—";
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const time =
    merged.timeFormat === "12H" && parts.dayPeriod
      ? `${hour}:${parts.minute} ${parts.dayPeriod}`
      : `${hour}:${parts.minute}`;
  return `${formatPanelDate(value, merged, locale)} ${time}`;
}

export function weekStartsOnIndex(
  settings: Pick<PanelFormatSettings, "weekStartsOn">,
): number {
  return [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ].indexOf(settings.weekStartsOn);
}
