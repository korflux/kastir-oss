import { describe, expect, it } from "vitest";

import { compilePage } from "@/lib/Publishing/compile";
import type { CompilableSnippet } from "@/lib/Publishing/compile";

const page = {
  content:
    "<!doctype html><html><head><title>Page</title></head><body><main>Content</main></body></html>",
};

function snippet(
  id: string,
  location: CompilableSnippet["location"],
  content: string,
  priority: number | null,
  createdAt: string,
  trigger?: Pick<
    CompilableSnippet,
    "triggerType" | "triggerConfig" | "maxDisplays" | "displayResetDays"
  >,
): CompilableSnippet {
  return {
    id,
    location,
    content,
    priority,
    createdAt: new Date(createdAt),
    ...trigger,
  };
}

describe("compilePage with custom code", () => {
  it("embeds author JavaScript without evaluating it in the server process", () => {
    const marker = "__kastir_compile_probe_38__";
    const html = compilePage(
      { content: "<html><head></head><body></body></html>" },
      [
        snippet(
          "untrusted",
          "BODY_END",
          `<script>globalThis.${marker} = true;</script>`,
          null,
          "2026-01-01T00:00:00Z",
        ),
      ],
      undefined,
      { includeAdminBar: false },
    );

    expect(html).toContain(`globalThis.${marker} = true`);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it("injects snippets at each location in deterministic priority order", () => {
    const html = compilePage(page, [
      snippet(
        "late",
        "BODY_END",
        "<script>late()</script>",
        2,
        "2026-01-01T00:00:02Z",
      ),
      snippet(
        "early",
        "BODY_END",
        "<script>early()</script>",
        1,
        "2026-01-01T00:00:03Z",
      ),
      snippet(
        "header",
        "HEADER",
        '<meta name="example">',
        null,
        "2026-01-01T00:00:00Z",
      ),
      snippet(
        "body-start",
        "BODY_START",
        '<div id="banner"></div>',
        null,
        "2026-01-01T00:00:00Z",
      ),
    ]);

    expect(html.indexOf("early()")).toBeLessThan(html.indexOf("late()"));
    expect(html).toContain(
      '<head><meta charset="UTF-8"><meta name="example">\n<title>Page',
    );
    expect(html).toContain('<body><div id="banner"></div>\n<main>');
    expect(html).toContain(
      "</main>\n<script>early()</script>\n<script>late()</script></body>",
    );
  });

  it("orders equal priorities by creation time and then id", () => {
    const html = compilePage(
      { content: "<html><head></head><body></body></html>" },
      [
        snippet("z", "HEADER", "SNIPPET_Z", 1, "2026-01-01T00:00:00Z"),
        snippet("a", "HEADER", "SNIPPET_A", 1, "2026-01-01T00:00:00Z"),
        snippet("old", "HEADER", "SNIPPET_OLD", null, "2025-01-01T00:00:00Z"),
      ],
    );

    expect(html.indexOf("SNIPPET_A")).toBeLessThan(html.indexOf("SNIPPET_Z"));
    expect(html.indexOf("SNIPPET_Z")).toBeLessThan(html.indexOf("SNIPPET_OLD"));
  });

  it("uses deterministic fallbacks for HTML fragments", () => {
    const html = compilePage({ content: "<main>Content</main>" }, [
      snippet("header", "HEADER", "header", null, "2026-01-01T00:00:00Z"),
      snippet(
        "body-start",
        "BODY_START",
        "start",
        null,
        "2026-01-01T00:00:01Z",
      ),
      snippet("body-end", "BODY_END", "end", null, "2026-01-01T00:00:02Z"),
    ]);

    expect(html).toBe("header\nstart\n<main>Content</main>\nend");
  });

  it("rebuilds from the original page blob without duplicating injections", () => {
    const snippets = [
      snippet(
        "one",
        "BODY_END",
        "<script>one()</script>",
        null,
        "2026-01-01T00:00:00Z",
      ),
    ];

    const first = compilePage(page, snippets);
    const second = compilePage({ content: page.content }, snippets);

    expect(second).toBe(first);
    expect(second.match(/one\(\)/g)).toHaveLength(1);
  });

  it("preserves replacement markers inside snippet content", () => {
    const html = compilePage(
      { content: "<html><body><main>Content</main></body></html>" },
      [
        snippet(
          "marker",
          "BODY_END",
          "<script>const marker = '$&';</script>",
          null,
          "2026-01-01T00:00:00Z",
        ),
      ],
    );

    expect(html).toContain("const marker = '$&';");
  });
});

describe("compilePage with popup triggers", () => {
  it("leaves snippets without a trigger byte-for-byte unchanged", () => {
    const withoutTrigger = compilePage(page, [
      snippet(
        "plain",
        "BODY_END",
        "<script>plain()</script>",
        null,
        "2026-01-01T00:00:00Z",
      ),
    ]);

    expect(withoutTrigger).not.toContain("data-kastir-trigger");
    expect(withoutTrigger).not.toContain("kastir-popup-config");
    expect(withoutTrigger).not.toContain("popup-triggers.js");
  });

  it("wraps a triggered snippet in a hidden container and injects the runtime script", () => {
    const html = compilePage(page, [
      snippet(
        "popup-1",
        "BODY_END",
        "<div>Subscribe</div>",
        null,
        "2026-01-01T00:00:00Z",
        {
          triggerType: "SCROLL",
          triggerConfig: { percentage: 50 },
          maxDisplays: 3,
          displayResetDays: 30,
        },
      ),
    ]);

    expect(html).toContain(
      '<div data-kastir-trigger="popup-1" style="display:none"><div>Subscribe</div></div>',
    );
    expect(html).toContain(
      '<script type="application/json" id="kastir-popup-config">',
    );
    expect(html).toContain(
      '"popup-1":{"triggerType":"SCROLL","triggerConfig":{"percentage":50},"maxDisplays":3,"displayResetDays":30}',
    );
    expect(html).toContain(
      '<script defer src="/_kastir/popup-triggers.js" data-kastir-popup-triggers="1"></script>',
    );
  });

  it("does not inject the runtime script when no snippet on the page has a trigger", () => {
    const html = compilePage(page, [
      snippet(
        "plain",
        "BODY_END",
        "<script>plain()</script>",
        null,
        "2026-01-01T00:00:00Z",
      ),
    ]);

    expect(html).not.toContain("popup-triggers.js");
    expect(html).not.toContain("kastir-popup-config");
  });

  it("escapes </script sequences inside a triggerConfig value so it can't break out of the config tag", () => {
    const html = compilePage(page, [
      snippet(
        "popup-1",
        "BODY_END",
        "<div>hi</div>",
        null,
        "2026-01-01T00:00:00Z",
        {
          triggerType: "REFERRER",
          triggerConfig: { matches: "</script><script>alert(1)</script>" },
        },
      ),
    ]);

    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain("<\\/script><script>alert(1)<\\/script>");
  });

  it("does not duplicate the popup config/script tags on recompilation", () => {
    const snippets = [
      snippet(
        "popup-1",
        "BODY_END",
        "<div>hi</div>",
        null,
        "2026-01-01T00:00:00Z",
        {
          triggerType: "PAGE_LOAD",
          triggerConfig: { delaySeconds: 5 },
        },
      ),
    ];

    const first = compilePage(page, snippets);
    const second = compilePage({ content: first }, snippets);

    expect(second.match(/popup-triggers\.js/g)).toHaveLength(1);
    expect(second.match(/kastir-popup-config/g)).toHaveLength(1);
    expect(second.match(/data-kastir-trigger="popup-1"/g)).toHaveLength(1);
  });
});
