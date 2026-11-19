import { describe, expect, it } from "vitest";

import { findMediaReferenceRanges } from "@/lib/Modules/Pages/Components/mediaReferenceRanges";

function valuesOf(doc: string) {
  return findMediaReferenceRanges(doc).map((range) =>
    doc.slice(range.from, range.to),
  );
}

describe("findMediaReferenceRanges", () => {
  it("detects <img src> values", () => {
    const doc = '<img src="/uploads/a.png" alt="A">';
    expect(valuesOf(doc)).toEqual(["/uploads/a.png"]);
  });

  it("detects url() inside a style attribute", () => {
    const doc = "<div style=\"background-image:url('/uploads/b.png')\"></div>";
    expect(valuesOf(doc)).toEqual(["/uploads/b.png"]);
  });

  it("detects url() inside an embedded <style> block", () => {
    const doc = "<style>body{background:url(/uploads/c.png)}</style>";
    expect(valuesOf(doc)).toEqual(["/uploads/c.png"]);
  });

  it("finds both an <img src> and a style url() in the same document", () => {
    const doc =
      '<img src="/uploads/a.png"><div style="background:url(/uploads/b.png)"></div>';
    expect(valuesOf(doc)).toEqual(["/uploads/a.png", "/uploads/b.png"]);
  });

  it("replacing the detected range preserves the rest of the tag", () => {
    const doc = '<img src="/uploads/old.png" alt="Keep me">';
    const [range] = findMediaReferenceRanges(doc);
    const next =
      doc.slice(0, range.from) + "/uploads/new.png" + doc.slice(range.to);
    expect(next).toBe('<img src="/uploads/new.png" alt="Keep me">');
  });

  it("ignores <img> without a src attribute", () => {
    expect(valuesOf('<img alt="no src">')).toEqual([]);
  });

  it("ignores url() outside CSS context (plain text or script)", () => {
    const doc =
      "<p>Visit url(/uploads/not-css.png) for details</p>" +
      "<script>const x = 'url(/uploads/also-not-css.png)';</script>";
    expect(valuesOf(doc)).toEqual([]);
  });

  it("returns an empty list for HTML with no media references", () => {
    expect(findMediaReferenceRanges("<h1>Hello</h1>")).toEqual([]);
  });
});
