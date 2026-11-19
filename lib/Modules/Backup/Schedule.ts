import { normalizePanelTimezone } from "@/lib/Modules/Settings/format";

/**
 * Cálculo puro do próximo horário de backup automático no fuso do site.
 * Sem BullMQ/Prisma — unit-testável com Intl.DateTimeFormat nativo.
 */

export type BackupScheduleOpts = {
  intervalDays: number;
  hour: number;
  minute: number;
  timezone: string;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Partes de calendário/relógio de `date` no fuso `timeZone`. */
function zonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Instant UTC correspondente a Y-M-D H:M:00 no fuso `timeZone`.
 * Corrige o offset IANA (inclui DST) com um passe de ajuste.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Chute inicial: trata os números como se fossem UTC.
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const actual = zonedParts(new Date(guess), timeZone);
  const actualAsUtc = Date.UTC(
    actual.year,
    actual.month - 1,
    actual.day,
    actual.hour,
    actual.minute,
    actual.second,
  );
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(guess + (desiredAsUtc - actualAsUtc));
}

/** Soma dias de calendário (não 24h UTC) a uma data Y-M-D. */
function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  // Date.UTC lida com overflow de dia/mês corretamente.
  const base = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

/**
 * Próxima ocorrência de `hour:minute` no fuso `timezone` a partir de `now`.
 * Se o horário de hoje ainda não passou → hoje; se já passou →
 * hoje + `intervalDays` no mesmo horário (não "sempre amanhã").
 */
export function nextBackupRunAt(now: Date, opts: BackupScheduleOpts): Date {
  const intervalDays = Math.max(1, Math.floor(opts.intervalDays));
  const hour = Math.min(23, Math.max(0, Math.floor(opts.hour)));
  const minute = Math.min(59, Math.max(0, Math.floor(opts.minute)));
  // Settings aceita atalho "UTC±N" (Schema.ts) que Intl.DateTimeFormat não entende
  // cru — mesma normalização usada pro resto do painel (Settings/format.ts),
  // senão zonedParts() lança RangeError e o scheduler nunca se registra.
  const timeZone = normalizePanelTimezone(opts.timezone || "UTC");

  const today = zonedParts(now, timeZone);
  const candidate = zonedTimeToUtc(
    today.year,
    today.month,
    today.day,
    hour,
    minute,
    timeZone,
  );

  if (candidate.getTime() > now.getTime()) {
    return candidate;
  }

  const next = addCalendarDays(
    today.year,
    today.month,
    today.day,
    intervalDays,
  );
  return zonedTimeToUtc(
    next.year,
    next.month,
    next.day,
    hour,
    minute,
    timeZone,
  );
}
