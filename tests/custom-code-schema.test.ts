import { describe, expect, it } from "vitest";

import {
  MAX_SNIPPET_CONTENT_BYTES,
  SCOPE_PAGE_IDS_MAX,
  createSnippetSchema,
  updateSnippetSchema,
  validateSnippetContent,
} from "@/lib/Modules/CustomCode/Schema";
import { GUIDE_TOPICS, MCP_POPUP_PLAYBOOK } from "@/lib/Modules/Mcp/Guide";

/** cuid sintético válido (`c` + 24 alfanuméricos), o formato do `Page.id` do Prisma. */
const cuid = (n: number) => `c${String(n).padStart(24, "0")}`;

function baseSnippet(overrides: Record<string, unknown> = {}) {
  return {
    name: "Popup",
    location: "BODY_END",
    content: "<div>hi</div>",
    scopeType: "ALL_PAGES",
    pageIds: [],
    ...overrides,
  };
}

describe("CustomCode schema", () => {
  it("accepts content at the exact 2 MiB boundary", () => {
    const content = "a".repeat(MAX_SNIPPET_CONTENT_BYTES);

    expect(
      createSnippetSchema.safeParse({
        name: "Analytics",
        location: "BODY_END",
        content,
        priority: 2,
        scopeType: "ALL_PAGES",
        pageIds: [],
      }).success,
    ).toBe(true);
  });

  it("rejects content above 2 MiB", () => {
    const content = "a".repeat(MAX_SNIPPET_CONTENT_BYTES + 1);

    expect(
      createSnippetSchema.safeParse({
        name: "Analytics",
        location: "BODY_END",
        content,
        scopeType: "ALL_PAGES",
        pageIds: [],
      }).success,
    ).toBe(false);
  });

  it("allows malformed draft content but rejects it at publish validation", () => {
    const draft = createSnippetSchema.safeParse({
      name: "Broken",
      location: "HEADER",
      content: "<script>window.example = true",
      scopeType: "ALL_PAGES",
      pageIds: [],
    });

    expect(draft.success).toBe(true);
    expect(() =>
      validateSnippetContent("<script>window.example = true"),
    ).toThrow(/balanced|closed|well-formed/i);
  });

  it("rejects mismatched tags but accepts a valid mixed snippet", () => {
    expect(() => validateSnippetContent("<div><span></div>")).toThrow();
    expect(() =>
      validateSnippetContent(
        '<script>window.example = "<div>";</script><style>body{color:red}</style>',
      ),
    ).not.toThrow();
  });
});

describe("CustomCode schema — pageIds (escopo de páginas)", () => {
  it("accepts an empty list and defaults a create without pageIds to []", () => {
    const empty = createSnippetSchema.safeParse(baseSnippet({ pageIds: [] }));
    expect(empty.success && empty.data.pageIds).toEqual([]);

    const { pageIds: omitted, ...withoutPageIds } = baseSnippet();
    void omitted;
    const defaulted = createSnippetSchema.safeParse(withoutPageIds);
    expect(defaulted.success && defaulted.data.pageIds).toEqual([]);
  });

  it("trims each id and collapses repeats into one occurrence, keeping first-seen order", () => {
    const parsed = createSnippetSchema.safeParse(
      baseSnippet({
        pageIds: [` ${cuid(2)} `, cuid(2), cuid(1), `${cuid(1)}\n`, cuid(3)],
      }),
    );

    expect(parsed.success && parsed.data.pageIds).toEqual([
      cuid(2),
      cuid(1),
      cuid(3),
    ]);

    const update = updateSnippetSchema.safeParse({
      id: "snip-1",
      pageIds: [cuid(1), cuid(1)],
    });
    expect(update.success && update.data.pageIds).toEqual([cuid(1)]);
  });

  it("leaves pageIds undefined on a partial update that omits it", () => {
    const update = updateSnippetSchema.safeParse({ id: "snip-1", name: "X" });

    expect(update.success && update.data.pageIds).toBeUndefined();
  });

  it("accepts exactly SCOPE_PAGE_IDS_MAX ids and refuses one more", () => {
    const atLimit = Array.from({ length: SCOPE_PAGE_IDS_MAX }, (_, i) =>
      cuid(i + 1),
    );
    const overLimit = [...atLimit, cuid(SCOPE_PAGE_IDS_MAX + 1)];

    expect(SCOPE_PAGE_IDS_MAX).toBe(1000);
    expect(
      createSnippetSchema.safeParse(baseSnippet({ pageIds: atLimit })).success,
    ).toBe(true);
    expect(
      createSnippetSchema.safeParse(baseSnippet({ pageIds: overLimit }))
        .success,
    ).toBe(false);
    expect(
      updateSnippetSchema.safeParse({ id: "snip-1", pageIds: overLimit })
        .success,
    ).toBe(false);
  });

  it("applies the cap to the raw payload, so repeats cannot smuggle a huge list in", () => {
    const repeated = Array.from({ length: SCOPE_PAGE_IDS_MAX + 1 }, () =>
      cuid(1),
    );

    expect(
      createSnippetSchema.safeParse(baseSnippet({ pageIds: repeated })).success,
    ).toBe(false);
  });

  it("keeps the MCP manual in sync with the cap (Guide.ts is client-safe and cannot import the constant)", () => {
    const cap = String(SCOPE_PAGE_IDS_MAX);

    expect(GUIDE_TOPICS.scripts).toContain(`${cap} page`);
    // O playbook de popup só existe em inglês (o MCP o serve em `popups`); o teto vale ali.
    expect(MCP_POPUP_PLAYBOOK).toContain(`${cap} pages`);
    expect(GUIDE_TOPICS.popups).toContain(`${cap} pages`);
  });

  it.each([
    ["page-1 (not a cuid)", ["page-1"]],
    ["empty string", [""]],
    ["blank string", ["   "]],
    ["uppercase cuid body", [`c${"A".repeat(24)}`]],
    ["too short", ["c123"]],
    ["number item", [42]],
    ["null item", [null]],
    ["valid + invalid mix", [cuid(1), "nao-e-cuid"]],
    ["not an array", cuid(1)],
  ])("refuses %s, reporting the issue under pageIds", (_label, pageIds) => {
    const create = createSnippetSchema.safeParse(baseSnippet({ pageIds }));
    const update = updateSnippetSchema.safeParse({ id: "snip-1", pageIds });

    for (const result of [create, update]) {
      expect(result.success).toBe(false);
      if (result.success) continue;
      // O Service escolhe a mensagem do escopo olhando `path[0] === "pageIds"`.
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues.every((i) => i.path[0] === "pageIds")).toBe(
        true,
      );
    }
  });
});

describe("CustomCode schema — trigger fields", () => {
  it("accepts a snippet with no trigger (current behavior)", () => {
    expect(createSnippetSchema.safeParse(baseSnippet()).success).toBe(true);
  });

  it.each([
    ["SELECTOR_EVENT", { selector: "#cta", event: "click" }],
    ["PAGE_LOAD", { delaySeconds: 5 }],
    ["SCROLL", { percentage: 50 }],
    ["REFERRER", { matches: "instagram.com" }],
  ] as const)(
    "accepts a %s trigger with its own config shape",
    (triggerType, triggerConfig) => {
      expect(
        createSnippetSchema.safeParse(
          baseSnippet({ trigger: { triggerType, triggerConfig } }),
        ).success,
      ).toBe(true);
    },
  );

  it("rejects a triggerConfig that doesn't match its triggerType", () => {
    expect(
      createSnippetSchema.safeParse(
        baseSnippet({
          trigger: {
            triggerType: "SCROLL",
            triggerConfig: { selector: "#cta", event: "click" },
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unknown triggerType", () => {
    expect(
      createSnippetSchema.safeParse(
        baseSnippet({ trigger: { triggerType: "HOVER", triggerConfig: {} } }),
      ).success,
    ).toBe(false);
  });

  it("accepts maxDisplays/displayResetDays alongside a trigger", () => {
    expect(
      createSnippetSchema.safeParse(
        baseSnippet({
          trigger: {
            triggerType: "PAGE_LOAD",
            triggerConfig: { delaySeconds: 0 },
          },
          maxDisplays: 3,
          displayResetDays: 7,
        }),
      ).success,
    ).toBe(true);
  });

  it("accepts trigger: null explicitly (clears an existing trigger on update)", () => {
    expect(
      updateSnippetSchema.safeParse({ id: "snip-1", trigger: null }).success,
    ).toBe(true);
  });

  it("accepts a partial update touching only maxDisplays (Service resolves the cross-field invariant)", () => {
    // updateSnippetSchema only validates shape per field; whether maxDisplays
    // is consistent with an existing trigger depends on DB state, checked in
    // Service.ts, not here — see resolveTriggerFields.
    expect(
      updateSnippetSchema.safeParse({ id: "snip-1", maxDisplays: 5 }).success,
    ).toBe(true);
  });
});
