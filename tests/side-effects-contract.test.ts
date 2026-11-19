import { describe, expect, it } from "vitest";

import {
  buildHomePageRemovedMessage,
  buildSnippetDisabledMessage,
} from "@/lib/SideEffects/automaticNotifications";

describe("automatic side-effect notification contract", () => {
  it("localizes messages and keeps links internal", () => {
    expect(
      buildSnippetDisabledMessage("en", "snippet-id", "Pixel", "Landing"),
    ).toEqual({
      message: expect.stringContaining("Pixel"),
      link: "/admin/custom-code/snippet-id",
    });
    expect(buildHomePageRemovedMessage("pt-BR", "Home")).toEqual({
      message: expect.stringContaining("Home"),
      link: "/admin/settings",
    });
  });

  it("bounds hostile, oversized labels deterministically", () => {
    const result = buildSnippetDisabledMessage(
      "en",
      "snippet-id",
      `<script>token@example.test</script>${"x".repeat(3_000)}`,
      "Landing",
    );

    expect(result.message.length).toBeLessThanOrEqual(2_000);
    expect(result.message).not.toContain("<script>");
    expect(result.message).not.toContain("token@example.test");
  });

  it("strips an unclosed tag fragment from the page title", () => {
    const result = buildSnippetDisabledMessage(
      "en",
      "snippet-id",
      "Pixel",
      "x <script",
    );

    expect(result.message).not.toContain("<script");
    expect(result.message).toContain("Pixel");
  });
});
