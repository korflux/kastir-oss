import { describe, expect, it } from "vitest";

import {
  formatPanelDate,
  formatPanelDateTime,
  normalizePanelTimezone,
  weekStartsOnIndex,
} from "@/lib/Modules/Settings/format";

describe("panel date formatting", () => {
  const value = "2026-01-02T15:04:00.000Z";

  it("applies timezone and configured date/time formats", () => {
    expect(
      formatPanelDate(
        value,
        { timezone: "UTC", dateFormat: "YYYY-MM-DD" },
        "en",
      ),
    ).toBe("2026-01-02");
    expect(
      formatPanelDate(
        value,
        { timezone: "America/Sao_Paulo", dateFormat: "DD/MM/YYYY" },
        "pt-BR",
      ),
    ).toBe("02/01/2026");
    expect(
      formatPanelDateTime(
        value,
        { timezone: "UTC", dateFormat: "MM/DD/YYYY", timeFormat: "12H" },
        "en",
      ),
    ).toContain("01/02/2026");
  });

  it("exposes the configured week start", () => {
    expect(weekStartsOnIndex({ weekStartsOn: "SUNDAY" })).toBe(0);
    expect(weekStartsOnIndex({ weekStartsOn: "MONDAY" })).toBe(1);
    expect(weekStartsOnIndex({ weekStartsOn: "SATURDAY" })).toBe(6);
  });

  it("normalizes UTC offset labels accepted by the settings form", () => {
    expect(normalizePanelTimezone("UTC+14")).toBe("Etc/GMT-14");
    expect(normalizePanelTimezone("UTC-12")).toBe("Etc/GMT+12");
    expect(
      formatPanelDate(
        value,
        { timezone: "UTC-3", dateFormat: "YYYY-MM-DD" },
        "en",
      ),
    ).toBe("2026-01-02");
  });

  it("falls back to UTC instead of throwing for an out-of-range offset", () => {
    // Schema validation should already reject "UTC-13"/"UTC-14" (see
    // tests/settings-schema.test.ts), but format.ts is a real formatting
    // boundary in its own right — a bad stored value (legacy data, a direct
    // DB edit) must degrade gracefully, not crash every date render.
    expect(() =>
      formatPanelDate(
        value,
        { timezone: "UTC-14", dateFormat: "YYYY-MM-DD" },
        "en",
      ),
    ).not.toThrow();
  });
});
