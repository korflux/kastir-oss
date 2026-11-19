import { describe, expect, it } from "vitest";

import { isAdReviewCrawler } from "@/lib/Modules/SplitTests/adCrawlers";

describe("isAdReviewCrawler", () => {
  it.each([
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "facebookexternalhit/1.1",
    "FACEBOOKEXTERNALHIT/1.1",
    "Meta-ExternalAgent/1.0",
    "meta-externalagent",
    "WhatsApp/2.23.20.0 A",
    "WhatsApp/2.23.20.0 I",
    "whatsapp/2.0",
  ])("detects Meta ad-review/preview UA: %s", (ua) => {
    expect(isAdReviewCrawler(ua)).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Instagram 123.0.0.21.114 Android",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  ])("rejects normal browser/app UA: %s", (ua) => {
    expect(isAdReviewCrawler(ua)).toBe(false);
  });

  it("rejects null and empty", () => {
    expect(isAdReviewCrawler(null)).toBe(false);
    expect(isAdReviewCrawler("")).toBe(false);
  });
});
