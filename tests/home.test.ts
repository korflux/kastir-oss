import { describe, expect, it } from "vitest";

import {
  fillTemplate,
  formatGreeting,
  formatSizeMb,
  timeOfDayKey,
} from "@/lib/Modules/Home/format";
import { getPanelDictionary } from "@/lib/i18n/panel";

describe("Home greeting helpers", () => {
  it("replaces every canonical name placeholder", () => {
    expect(formatGreeting("Hi, {name}! {name} is ready.", "Ada")).toBe(
      "Hi, Ada! Ada is ready.",
    );
  });

  it("preserves literal replacement characters in user names", () => {
    expect(formatGreeting("Hello, {name}.", "<b>$&</b>")).toBe(
      "Hello, <b>$&</b>.",
    );
  });

  it("maps hours to morning/afternoon/evening", () => {
    expect(timeOfDayKey(8)).toBe("morning");
    expect(timeOfDayKey(14)).toBe("afternoon");
    expect(timeOfDayKey(20)).toBe("evening");
  });

  it("formats media size in whole megabytes", () => {
    expect(formatSizeMb(0)).toBe(0);
    expect(formatSizeMb(183 * 1024 * 1024)).toBe(183);
  });

  it("fills overview detail templates", () => {
    expect(
      fillTemplate(getPanelDictionary("en").home.pagesDetail, { count: 8 }),
    ).toBe("Published 8 new pages this week");
  });
});
