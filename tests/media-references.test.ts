import { describe, expect, it } from "vitest";

import { extractInternalUploadsFromHtml } from "@/lib/Modules/Media/references";

describe("extractInternalUploadsFromHtml", () => {
  it("collects relative uploads and same-origin absolute URLs", () => {
    const html = `
      <img src="/uploads/id-1/a.webp" alt="a" />
      <a href="https://site.example/uploads/id-2/b.pdf">doc</a>
      <div style="background:url('/uploads/id-3/c.webp')"></div>
      <img src="https://cdn.external/uploads/id-x/skip.webp" />
      <img src="https://other.example/hero.png" />
    `;

    const refs = extractInternalUploadsFromHtml(html, "https://site.example");
    expect(refs).toEqual(
      expect.arrayContaining([
        { mediaId: "id-1", fileName: "a.webp" },
        { mediaId: "id-2", fileName: "b.pdf" },
        { mediaId: "id-3", fileName: "c.webp" },
      ]),
    );
    expect(refs).toHaveLength(3);
  });

  it("ignores absolute uploads when public origin is unknown", () => {
    const html = `<img src="https://site.example/uploads/id-1/a.webp" />`;
    expect(extractInternalUploadsFromHtml(html, null)).toEqual([]);
    expect(
      extractInternalUploadsFromHtml(
        `<img src="/uploads/id-1/a.webp" />`,
        null,
      ),
    ).toEqual([{ mediaId: "id-1", fileName: "a.webp" }]);
  });
});
