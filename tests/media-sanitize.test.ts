import { describe, expect, it } from "vitest";

import { sanitizeSvg } from "@/lib/Processing/sanitizeSvg";

describe("SVG sanitization", () => {
  it("removes scripts and inline event handlers while keeping the SVG", () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(2)</script>
        <rect width="10" height="10" fill="red" onclick="alert(3)" />
      </svg>
    `;

    const sanitized = sanitizeSvg(svg);

    expect(sanitized).toContain("<svg");
    expect(sanitized).toContain("<rect");
    expect(sanitized).not.toMatch(/<script|onload|onclick/i);
  });

  it("rejects content that is not an SVG document", () => {
    expect(() => sanitizeSvg("<html><body>not an svg</body></html>")).toThrow(
      "valid SVG",
    );
  });

  it("rejects text wrapping the SVG root", () => {
    expect(() =>
      sanitizeSvg(
        'junk<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>tail',
      ),
    ).toThrow("valid SVG");
  });

  it("rejects stylesheet import and HTML data URLs that DOMPurify keeps", () => {
    expect(() =>
      sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css);</style></svg>',
      ),
    ).toThrow("valid SVG");
    expect(() =>
      sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:text/html;base64,PHNjcmlwdD5hPC9zY3JpcHQ+" /></svg>',
      ),
    ).toThrow("valid SVG");
  });

  it("keeps a raster data URL on image and returns a trimmed single-root document", () => {
    const sanitized = sanitizeSvg(
      '\n  <svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA" /></svg>\n',
    );
    expect(sanitized.startsWith("<svg")).toBe(true);
    expect(sanitized.endsWith("</svg>")).toBe(true);
    expect(sanitized).toContain("data:image/png;base64,AAAA");
  });
});
