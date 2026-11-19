import { describe, expect, it } from "vitest";

import {
  canDisplay,
  nextDisplayState,
  referrerMatches,
  type StoredDisplayState,
} from "@/public-scripts/popup-triggers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("popup-triggers runtime — nextDisplayState", () => {
  it("starts a fresh window at count 1 when there is no prior state", () => {
    expect(nextDisplayState(1000, null)).toEqual({
      count: 1,
      windowStart: 1000,
    });
  });

  it("increments the count while inside the window", () => {
    const stored: StoredDisplayState = { count: 2, windowStart: 1000 };
    expect(nextDisplayState(2000, stored, DAY_MS)).toEqual({
      count: 3,
      windowStart: 1000,
    });
  });

  it("resets the window once it has expired", () => {
    const stored: StoredDisplayState = { count: 5, windowStart: 0 };
    const now = 30 * DAY_MS + 1;
    expect(nextDisplayState(now, stored, 30 * DAY_MS)).toEqual({
      count: 1,
      windowStart: now,
    });
  });
});

describe("popup-triggers runtime — canDisplay", () => {
  it("always allows display when maxDisplays is null (no cap)", () => {
    expect(canDisplay(1000, { count: 999, windowStart: 0 }, null)).toBe(true);
  });

  it("allows display when there is no prior state", () => {
    expect(canDisplay(1000, null, 3)).toBe(true);
  });

  it("allows display once the window has expired, regardless of the old count", () => {
    const stored: StoredDisplayState = { count: 3, windowStart: 0 };
    expect(canDisplay(30 * DAY_MS + 1, stored, 3, 30 * DAY_MS)).toBe(true);
  });

  it("blocks display once the count reaches maxDisplays inside the window", () => {
    const stored: StoredDisplayState = { count: 3, windowStart: 0 };
    expect(canDisplay(1000, stored, 3, 30 * DAY_MS)).toBe(false);
  });

  it("allows display below maxDisplays inside the window", () => {
    const stored: StoredDisplayState = { count: 2, windowStart: 0 };
    expect(canDisplay(1000, stored, 3, 30 * DAY_MS)).toBe(true);
  });
});

describe("popup-triggers runtime — referrerMatches", () => {
  it("matches a simple substring", () => {
    expect(
      referrerMatches("https://www.instagram.com/p/xyz", "instagram.com"),
    ).toBe(true);
  });

  it("does not match an unrelated referrer", () => {
    expect(referrerMatches("https://www.google.com/", "instagram.com")).toBe(
      false,
    );
  });

  it("does not match an empty referrer", () => {
    expect(referrerMatches("", "instagram.com")).toBe(false);
  });
});
