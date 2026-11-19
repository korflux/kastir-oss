import { describe, expect, it } from "vitest";

import {
  getNewPageTemplate,
  NEW_PAGE_TEMPLATE_EN,
  NEW_PAGE_TEMPLATE_PT_BR,
  resolveNewPageTemplateLocale,
} from "@/lib/Modules/Pages/newPageTemplate";

describe("newPageTemplate", () => {
  it("resolves known locales and falls back to en", () => {
    expect(resolveNewPageTemplateLocale("en")).toBe("en");
    expect(resolveNewPageTemplateLocale("pt-BR")).toBe("pt-BR");
    expect(resolveNewPageTemplateLocale("pt")).toBe("pt-BR");
    expect(resolveNewPageTemplateLocale("fr")).toBe("en");
  });

  it("returns the matching didactic HTML body", () => {
    expect(getNewPageTemplate("en")).toBe(NEW_PAGE_TEMPLATE_EN);
    expect(getNewPageTemplate("pt-BR")).toBe(NEW_PAGE_TEMPLATE_PT_BR);
    expect(getNewPageTemplate("fr")).toBe(NEW_PAGE_TEMPLATE_EN);
    expect(getNewPageTemplate("en")).toContain("Your page title");
    expect(getNewPageTemplate("pt-BR")).toContain("Título da sua página");
  });
});
