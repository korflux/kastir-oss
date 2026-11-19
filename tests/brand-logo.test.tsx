import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandLogo } from "@/components/Shared/BrandLogo";

describe("BrandLogo", () => {
  it.each([
    ["symbol", "kastir-symbol-light.webp", "kastir-symbol-dark.webp"],
    ["logo", "kastir-logo-light.webp", "kastir-logo-dark.webp"],
  ] as const)(
    "renders the approved %s variants for class-based theme",
    (kind, light, dark) => {
      const html = renderToStaticMarkup(
        <BrandLogo className="brand-size" kind={kind} label="Kastir" />,
      );

      expect(html).toContain(light);
      expect(html).toContain(dark);
      expect(html).toContain("dark:hidden");
      expect(html).toContain("dark:block");
      expect(html.match(/aria-label="Kastir"/g)).toHaveLength(1);
      expect(html.match(/alt=""/g)).toHaveLength(2);
    },
  );

  it("preloads only the light variant when priority is requested", () => {
    const html = renderToStaticMarkup(
      <BrandLogo kind="logo" label="Kastir" priority />,
    );

    expect(html.match(/<link rel="preload"/g)).toHaveLength(1);
    const preload = html.slice(0, html.indexOf("<span"));
    expect(preload).toContain("kastir-logo-light.webp");
    expect(preload).not.toContain("kastir-logo-dark.webp");
  });
});
