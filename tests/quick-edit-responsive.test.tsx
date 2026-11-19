// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { Popover, PopoverContent } from "@/components/ui/popover";
import { CustomCodeScopeSelector } from "@/lib/Modules/CustomCode/Components/CustomCodeScopeSelector";
import { getPanelDictionary } from "@/lib/i18n/panel";

describe("quick edit responsivo", () => {
  it("limita o popover à viewport e prepara foco de entrada e retorno", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          Popover,
          { open: true },
          createElement(
            PopoverContent,
            null,
            createElement("span", null, "Quick edit"),
          ),
        ),
      );
    });

    const html = document.body.innerHTML;

    expect(html).toContain("w-[min(20rem,calc(100vw-1rem))]");
    expect(html).toContain("max-h-[calc(100svh-1rem)]");

    await act(async () => root.unmount());
    container.remove();
  });

  it("gera ids únicos para dois seletores de páginas no mesmo DOM", () => {
    const dictionary = getPanelDictionary("en").customCode;
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(CustomCodeScopeSelector, {
          dictionary,
          pageIds: [],
          onChange: () => undefined,
        }),
        createElement(CustomCodeScopeSelector, {
          dictionary,
          pageIds: [],
          onChange: () => undefined,
        }),
      ),
    );
    const ids = [...html.matchAll(/id="([^"]*page-search[^"]*)"/g)].map(
      ([, id]) => id,
    );

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
