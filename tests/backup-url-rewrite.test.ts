import { describe, expect, it } from "vitest";

import {
  rewriteOriginInString,
  rewriteOriginsInValue,
} from "@/lib/Modules/Backup/UrlRewrite";

describe("UrlRewrite", () => {
  it("replaces source origin and leaves third-party hosts intact", () => {
    const input =
      "Visit https://old-site.example/page and https://fonts.googleapis.com/css";
    const result = rewriteOriginInString(
      input,
      "https://old-site.example",
      "https://new-site.example",
    );
    expect(result.value).toBe(
      "Visit https://new-site.example/page and https://fonts.googleapis.com/css",
    );
    expect(result.replacements).toBe(1);
  });

  it("does not false-positive on host substrings", () => {
    const input = "https://old-site.example.evil.example/x";
    const result = rewriteOriginInString(
      input,
      "https://old-site.example",
      "https://new-site.example",
    );
    expect(result.value).toBe(input);
    expect(result.replacements).toBe(0);
  });

  it("walks nested JSON and HTML-like strings", () => {
    const payload = {
      content: '<a href="https://old.example/a">x</a>',
      nested: {
        url: "https://old.example/uploads/1/a.webp",
        external: "https://cdn.thirdparty.test/x",
      },
      list: ["https://old.example/", "keep"],
    };
    const { value, stats } = rewriteOriginsInValue(
      payload,
      "https://old.example",
      "https://new.example",
    );
    expect(stats.replacements).toBe(3);
    expect(value).toEqual({
      content: '<a href="https://new.example/a">x</a>',
      nested: {
        url: "https://new.example/uploads/1/a.webp",
        external: "https://cdn.thirdparty.test/x",
      },
      list: ["https://new.example/", "keep"],
    });
  });
});
