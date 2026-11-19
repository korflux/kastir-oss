import { describe, expect, it } from "vitest";

import {
  REVISION_PIN_MAX,
  REVISION_RETENTION_DEFAULT,
  REVISION_RETENTION_MAX,
  REVISION_RETENTION_MIN,
  effectiveRevisionRetentionLimit,
} from "@/lib/Modules/Settings/revisionRetention";

describe("revision retention limits", () => {
  it("keeps the global allowlist in one place", () => {
    expect(REVISION_RETENTION_MIN).toBe(5);
    expect(REVISION_RETENTION_MAX).toBe(30);
    expect(REVISION_RETENTION_DEFAULT).toBe(5);
    expect(REVISION_PIN_MAX).toBe(3);
  });

  it("uses 5 when the stored value is missing or outside the allowlist", () => {
    expect(effectiveRevisionRetentionLimit(undefined)).toBe(5);
    expect(effectiveRevisionRetentionLimit(null)).toBe(5);
    expect(effectiveRevisionRetentionLimit(4)).toBe(5);
    expect(effectiveRevisionRetentionLimit(31)).toBe(5);
    expect(effectiveRevisionRetentionLimit(5.5)).toBe(5);
    expect(effectiveRevisionRetentionLimit(12)).toBe(12);
    expect(effectiveRevisionRetentionLimit(5)).toBe(5);
    expect(effectiveRevisionRetentionLimit(30)).toBe(30);
  });
});
