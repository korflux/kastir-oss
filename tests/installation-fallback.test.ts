import { describe, expect, it } from "vitest";

import packageJson from "@/package.json";
import { buildInstallationFallbackHtml } from "@/lib/Publishing/installationFallbackHtml";

describe("installation fallback brand", () => {
  it("uses approved light/dark assets without duplicating accessible text", () => {
    const html = buildInstallationFallbackHtml();

    expect(html).toContain('href="/icon.webp" type="image/webp"');
    expect(html.match(/media="\(prefers-color-scheme: dark\)"/g)).toHaveLength(
      2,
    );
    for (const asset of [
      "kastir-symbol-light.webp",
      "kastir-symbol-dark.webp",
      "kastir-logo-light.webp",
      "kastir-logo-dark.webp",
    ]) {
      expect(html).toContain(`/admin-brand/${asset}`);
    }
    expect(html.match(/alt="Kastir"/g)).toHaveLength(1);
    expect(html).not.toMatch(/k-logo\.png|kastir-wordmark\.png/);
  });

  it("does not fingerprint the installed package version on the public landing", () => {
    const html = buildInstallationFallbackHtml();
    expect(html).not.toContain(packageJson.version);
    expect(html).not.toMatch(/class="version"|class="num"/);
  });
});
