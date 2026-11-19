import { describe, expect, it } from "vitest";

import { PREVIEW_HEADERS } from "@/lib/Modules/Pages/PreviewHeaders";

describe("private preview CSP", () => {
  const csp = PREVIEW_HEADERS["Content-Security-Policy"];

  it("keeps the opaque sandbox and names the img-src https trade-off", () => {
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("media-src 'self' data:");
    expect(csp).not.toMatch(/media-src[^;]*https:/);
  });

  it("pins framing and form fallbacks that default-src does not inherit", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });
});
