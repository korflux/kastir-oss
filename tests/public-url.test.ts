import { describe, expect, it } from "vitest";

import {
  getListedPageAbsoluteUrl,
  getListedPagePath,
  getPublishedPagePath,
} from "@/lib/Modules/Pages/publicUrl";

describe("published page public URL", () => {
  it("maps a slug to its clean canonical public URL", () => {
    expect(getPublishedPagePath("landing-promo")).toBe("/landing-promo");
  });

  it("strips accidental leading or trailing slashes", () => {
    expect(getPublishedPagePath("/about/")).toBe("/about");
  });

  it("lists the home page as / and other pages as /slug", () => {
    expect(getListedPagePath("home", true)).toBe("/");
    expect(getListedPagePath("discord", false)).toBe("/discord");
  });

  it("joins the public origin to the listed path without a double slash", () => {
    expect(
      getListedPageAbsoluteUrl("https://kastir.com.br/", "discord", false),
    ).toBe("https://kastir.com.br/discord");
    expect(
      getListedPageAbsoluteUrl("https://kastir.com.br", "home", true),
    ).toBe("https://kastir.com.br/");
  });
});
