import { describe, expect, it } from "vitest";

import {
  MAX_PAGE_CONTENT_BYTES,
  PAGE_FOLDER_PRESET_COLORS,
  assertPublishableSlug,
  createPageSchema,
  folderColorSchema,
  nextAvailableSlug,
  normalizeSlug,
  pageObjectLabel,
} from "@/lib/Modules/Pages/Schema";

describe("pages schema and slug rules", () => {
  it("normalizes an accented title into a URL-safe slug", () => {
    expect(normalizeSlug("  Promoção de Verão!  ")).toBe("promocao-de-verao");
  });

  it("increments automatically generated slugs without colliding", () => {
    expect(
      nextAvailableSlug("promo", new Set(["promo", "promo-2", "promo-3"])),
    ).toBe("promo-4");
  });

  it("rejects reserved slugs and path traversal", () => {
    for (const slug of [
      "admin",
      "api",
      "_next",
      "favicon.ico",
      "uploads",
      "../x",
      "a/b",
      "",
    ]) {
      expect(() => assertPublishableSlug(slug)).toThrow();
    }
  });

  it("accepts a normal unicode slug after canonical normalization", () => {
    expect(assertPublishableSlug("Próxima Página")).toBe("proxima-pagina");
  });

  it("accepts exactly 2 MiB and rejects the next byte", () => {
    const valid = "a".repeat(MAX_PAGE_CONTENT_BYTES);
    const tooLarge = `${valid}b`;

    expect(
      createPageSchema.safeParse({
        title: "Large page",
        slug: "large-page",
        content: valid,
        folderId: "base-id",
      }).success,
    ).toBe(true);
    expect(
      createPageSchema.safeParse({
        title: "Too large",
        slug: "too-large",
        content: tooLarge,
        folderId: "base-id",
      }).success,
    ).toBe(false);
  });

  it("canonicalizes preset and custom folder colors", () => {
    expect(folderColorSchema.parse(PAGE_FOLDER_PRESET_COLORS[0])).toBe(
      PAGE_FOLDER_PRESET_COLORS[0],
    );
    expect(folderColorSchema.parse("#abc")).toBe("#AABBCC");
    expect(() => folderColorSchema.parse("#12")).toThrow();
  });

  it("builds a stable page object label snapshot", () => {
    expect(pageObjectLabel({ title: "Landing", slug: "landing" })).toBe(
      "Landing (/landing)",
    );
  });
});
