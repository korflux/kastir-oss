import { describe, expect, it } from "vitest";

import { readFile } from "node:fs/promises";

describe("WebP favicon delivery", () => {
  it("keeps the approved source and the fixed route wired", async () => {
    const [layout, route, nextConfig, nginx] = await Promise.all([
      readFile("app/layout.tsx", "utf8"),
      readFile("app/icon/route.ts", "utf8"),
      readFile("next.config.ts", "utf8"),
      readFile("nginx.conf", "utf8"),
    ]);

    expect(layout).toContain('url: "/icon.webp"');
    expect(route).toContain('join(process.cwd(), "app", "icon.webp")');
    expect(route).toContain('"Content-Type": "image/webp"');
    expect(nextConfig).toContain('source: "/icon.webp"');
    expect(nginx).toContain("location = /icon.webp");
  });
});
