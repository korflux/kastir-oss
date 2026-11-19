import { describe, expect, it } from "vitest";

import {
  pageFieldChanges,
  scriptFieldChanges,
  type PageFieldValues,
  type ScriptFieldValues,
} from "@/lib/Modules/Revisions/Components/revisionFieldChanges";
import { getPanelDictionary } from "@/lib/i18n/panel";

const en = getPanelDictionary("en");
const ptBr = getPanelDictionary("pt-BR");

const pageBase: PageFieldValues = {
  title: "Black Friday",
  slug: "black-friday",
  folderId: "folder-a",
  seoTitle: "Black Friday | Store",
  seoDescription: "Up to 50% off.",
  seoKeyword: "sale",
};

const folders: Record<string, string> = {
  "folder-a": "Campaigns",
  "folder-b": "Campaigns / Archive",
};

const scriptBase: ScriptFieldValues = {
  name: "Chat widget",
  location: "HEADER",
  priority: 1,
  scopeType: "ALL_PAGES",
  pageIds: [],
  triggerType: null,
  triggerConfig: null,
  maxDisplays: null,
  displayResetDays: null,
};

const pageNames: Record<string, string> = {
  "page-1": "Pricing",
  "page-2": "About",
};

function pageChanges(
  version: Partial<PageFieldValues>,
  current: Partial<PageFieldValues> = {},
) {
  return pageFieldChanges({
    copy: en.revisions,
    current: { ...pageBase, ...current },
    version: { ...pageBase, ...version },
    folderLabel: (id) => folders[id],
  });
}

function scriptChanges(
  version: Partial<ScriptFieldValues>,
  current: Partial<ScriptFieldValues> = {},
) {
  return scriptFieldChanges({
    copy: en.revisions,
    labels: en.customCode,
    current: { ...scriptBase, ...current },
    version: { ...scriptBase, ...version },
    pageName: (id) => pageNames[id],
  });
}

describe("pageFieldChanges", () => {
  it("reports nothing when every field matches", () => {
    expect(pageChanges({})).toEqual([]);
  });

  // C3 para Pages: cada campo do snapshot (fora o código) aparece quando muda.
  it("reports each changed snapshot field, one by one, with current → version", () => {
    const cases: Array<[Partial<PageFieldValues>, string, string, string]> = [
      [{ title: "Cyber Monday" }, "name", "Black Friday", "Cyber Monday"],
      [{ slug: "cyber-monday" }, "slug", "black-friday", "cyber-monday"],
      [{ folderId: "folder-b" }, "folder", "Campaigns", "Campaigns / Archive"],
      [{ seoTitle: "Cyber" }, "seoTitle", "Black Friday | Store", "Cyber"],
      [
        { seoDescription: "Half price." },
        "seoDescription",
        "Up to 50% off.",
        "Half price.",
      ],
      [{ seoKeyword: "deals" }, "seoKeyword", "sale", "deals"],
    ];

    for (const [version, field, current, next] of cases) {
      expect(pageChanges(version)).toEqual([
        {
          field,
          label: en.revisions.fields[field as keyof typeof en.revisions.fields],
          current,
          next,
        },
      ]);
    }
  });

  it("lists several changes in the order of the spec", () => {
    const changes = pageChanges({
      seoKeyword: "deals",
      title: "Cyber Monday",
      folderId: "folder-b",
    });
    expect(changes.map((change) => change.field)).toEqual([
      "name",
      "folder",
      "seoKeyword",
    ]);
  });

  it("treats empty and null SEO as the same value and shows (empty) otherwise", () => {
    expect(pageChanges({ seoTitle: null }, { seoTitle: "" })).toEqual([]);
    expect(
      pageChanges({ seoDescription: "  " }, { seoDescription: null }),
    ).toEqual([]);
    expect(pageChanges({ seoKeyword: null })).toEqual([
      {
        field: "seoKeyword",
        label: "SEO keyword",
        current: "sale",
        next: en.revisions.fieldEmpty,
      },
    ]);
  });

  it("falls back to the folder id when the folder no longer resolves", () => {
    const [change] = pageChanges({ folderId: "folder-deleted" });
    expect(change).toMatchObject({
      field: "folder",
      current: "Campaigns",
      next: "folder-deleted",
    });
  });

  it("uses the dictionary language for the labels", () => {
    const [change] = pageFieldChanges({
      copy: ptBr.revisions,
      current: pageBase,
      version: { ...pageBase, seoTitle: null },
    });
    expect(change).toMatchObject({
      label: "Título de SEO",
      next: "(vazio)",
    });
  });
});

describe("scriptFieldChanges", () => {
  it("reports nothing when every field matches", () => {
    expect(scriptChanges({})).toEqual([]);
  });

  // C3 para Scripts: cada campo do snapshot (fora o código) aparece quando muda.
  it("reports each changed snapshot field, one by one, with readable values", () => {
    const cases: Array<[Partial<ScriptFieldValues>, string, string, string]> = [
      [{ name: "Support chat" }, "name", "Chat widget", "Support chat"],
      [{ location: "BODY_END" }, "location", "Header", "Body end"],
      [{ priority: 7 }, "priority", "1", "7"],
      [
        { scopeType: "SPECIFIC_PAGES" },
        "scope",
        "All published pages",
        "Selected pages",
      ],
      [
        { pageIds: ["page-2", "page-1"] },
        "scopedPages",
        en.revisions.fieldEmpty,
        "About, Pricing",
      ],
      [
        { triggerType: "SCROLL" },
        "trigger",
        en.customCode.triggerNone,
        "On scroll",
      ],
      [
        { triggerConfig: { percentage: 40 } },
        "triggerConfig",
        en.revisions.fieldEmpty,
        "Scroll (%): 40",
      ],
      [{ maxDisplays: 3 }, "maxDisplays", en.revisions.fieldEmpty, "3"],
      [
        { displayResetDays: 30 },
        "displayResetDays",
        en.revisions.fieldEmpty,
        "30",
      ],
    ];

    for (const [version, field, current, next] of cases) {
      expect(scriptChanges(version)).toEqual([
        {
          field,
          label: en.revisions.fields[field as keyof typeof en.revisions.fields],
          current,
          next,
        },
      ]);
    }
  });

  it("compares scoped pages as a set and falls back to ids that do not resolve", () => {
    const current = { scopeType: "SPECIFIC_PAGES" as const };
    expect(
      scriptChanges(
        { ...current, pageIds: ["page-2", "page-1", "page-1"] },
        { ...current, pageIds: ["page-1", "page-2"] },
      ),
    ).toEqual([]);

    const [change] = scriptChanges(
      { ...current, pageIds: ["page-1", "page-gone"] },
      { ...current, pageIds: ["page-1"] },
    );
    expect(change).toMatchObject({
      field: "scopedPages",
      current: "Pricing",
      next: "page-gone, Pricing",
    });
  });

  it("describes every kind of trigger configuration", () => {
    const text = (triggerConfig: ScriptFieldValues["triggerConfig"]) =>
      scriptChanges({ triggerConfig })[0]?.next;

    expect(text({ selector: "#buy", event: "click" })).toBe("#buy · Click");
    expect(text({ selector: "form.lead", event: "submit" })).toBe(
      "form.lead · Form submit",
    );
    expect(text({ delaySeconds: 5 })).toBe("Delay (seconds): 5");
    expect(text({ percentage: 40 })).toBe("Scroll (%): 40");
    expect(text({ matches: "utm_source=ad" })).toBe(
      "Referrer URL contains: utm_source=ad",
    );
  });

  it("ignores the key order of the trigger configuration", () => {
    expect(
      scriptChanges(
        { triggerConfig: { selector: "#buy", event: "click" } },
        { triggerConfig: { event: "click", selector: "#buy" } },
      ),
    ).toEqual([]);
  });

  it("lists several changes in the order of the spec", () => {
    const changes = scriptChanges({
      displayResetDays: 7,
      name: "Support chat",
      priority: null,
    });
    expect(changes.map((change) => change.field)).toEqual([
      "name",
      "priority",
      "displayResetDays",
    ]);
  });

  it("uses the dictionary language for labels and enum values", () => {
    const [change] = scriptFieldChanges({
      copy: ptBr.revisions,
      labels: ptBr.customCode,
      current: scriptBase,
      version: { ...scriptBase, location: "BODY_START" },
    });
    expect(change).toEqual({
      field: "location",
      label: "Injeção",
      current: "Cabeçalho",
      next: "Início do body",
    });
  });
});
