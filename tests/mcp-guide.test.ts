import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { BETTER_AUTH_URL: "http://localhost:3000" },
}));
vi.mock("@/lib/Modules/Settings/Service", () => ({
  settingsService: {},
}));
vi.mock("@/lib/Publishing/queue", () => ({
  getPublishingQueue: vi.fn(),
}));

import {
  GUIDE_TOPIC_NAMES,
  GUIDE_TOPICS,
  MCP_POPUP_PLAYBOOK,
  getGuide,
} from "@/lib/Modules/Mcp/Guide";
import { registerSiteTools } from "@/lib/Modules/Mcp/Tools/Site";
import { CONTENT_PATCH_MAX_OPERATIONS } from "@/lib/Modules/Shared/ContentPatchContract";

const context = {
  actor: { id: "user-1", name: "Admin", email: "admin@example.test" },
  userId: "user-1",
  role: "ADMIN" as const,
  scopes: ["cms:read"] as const,
  clientId: "client-1",
  resource: "https://example.test/api/mcp",
  requestId: "request-1",
};

describe("MCP guide", () => {
  it("keeps every registered topic non-empty and within the response budget", () => {
    expect(Object.keys(GUIDE_TOPICS)).toEqual([...GUIDE_TOPIC_NAMES]);

    for (const topic of GUIDE_TOPIC_NAMES) {
      const content = GUIDE_TOPICS[topic];
      expect(content.trim(), topic).not.toBe("");
      expect(Buffer.byteLength(content, "utf8"), topic).toBeLessThanOrEqual(
        8_000,
      );
    }
  });

  it("explains that page and script update never go live without publish", () => {
    expect(GUIDE_TOPICS.pages).toMatch(/saves the draft only/i);
    expect(GUIDE_TOPICS.pages).toContain("kastir_pages_publish");
    expect(GUIDE_TOPICS.pages).toContain("kastir_pages_revisions_");
    expect(GUIDE_TOPICS.pages).toMatch(/no purge or delete/i);
    expect(GUIDE_TOPICS.scripts).toMatch(/saves the draft only/i);
    expect(GUIDE_TOPICS.scripts).toContain("kastir_scripts_publish");
    expect(GUIDE_TOPICS.publishing).toMatch(/never deploy/i);
  });

  it("A20: the pages and scripts topics teach patch, content hash, limits, sizes and the draft diff", () => {
    for (const resource of ["pages", "scripts"] as const) {
      const content = GUIDE_TOPICS[resource];
      const patch = `kastir_${resource}_patch`;

      // Patch: formato, limites de entrada e as duas formas de recusa.
      expect(content, resource).toContain(patch);
      expect(content, resource).toContain(
        `1-${CONTENT_PATCH_MAX_OPERATIONS} operations`,
      );
      expect(content, resource).toMatch(/old non-empty/);
      expect(content, resource).toMatch(/exactly once/);
      expect(content, resource).toMatch(/all or nothing/i);
      expect(content, resource).toContain("2 MiB");
      expect(content, resource).toContain("64 hex");
      expect(content, resource).toContain("expected exactly 1");
      expect(content, resource).toContain(
        `VALIDATION_ERROR 'Invalid arguments for tool ${patch}'`,
      );
      expect(content, resource).toMatch(/without (the )?field or value/i);

      // Hash, tamanhos e precedência da versão esperada.
      expect(content, resource).toContain("expectedContentSha256");
      expect(content, resource).toContain("contentSha256");
      expect(content, resource).toContain("contentBytes");
      expect(content, resource).toContain("current contentSha256");
      expect(content, resource).toContain("expectedUpdatedAt is ignored");
      expect(content, resource).toContain("contentTotal");
      expect(content, resource).toContain("UTF-16");
      expect(content, resource).toContain("CRLF counts 2");
      expect(content, resource).toContain("outside the BMP");
      expect(content, resource).toContain(`kastir_${resource}_revisions_get`);
      expect(content, resource).toContain("draftFingerprint");
      expect(content, resource).toMatch(/not of the content/i);

      // Conferência antes de publicar.
      expect(content, resource).toContain(`kastir_${resource}_revisions_diff`);
      expect(content, resource).toContain("publishedRevisionId");
      expect(content, resource).toContain('to="draft"');
    }
    expect(GUIDE_TOPICS.pages).toContain("kastir_pages_preview");

    // publishing aponta as duas tools de patch e a conferência antes do publish.
    expect(GUIDE_TOPICS.publishing).toContain("kastir_pages_patch");
    expect(GUIDE_TOPICS.publishing).toContain("kastir_scripts_patch");
    expect(GUIDE_TOPICS.publishing).toContain('to="draft"');

    // Os resumos do índice avisam do patch e do hash sem exigir abrir o tópico.
    const summaries = new Map(
      getGuide().topics.map(({ topic, summary }) => [topic, summary]),
    );
    expect(summaries.get("pages")).toMatch(/patch/i);
    expect(summaries.get("pages")).toMatch(/hash/i);
    expect(summaries.get("scripts")).toMatch(/patch/i);
    expect(summaries.get("scripts")).toMatch(/hash/i);
    expect(summaries.get("publishing")).toMatch(/patch/i);
  });

  it("teaches the panel switch playbook: publish on changes, activate on the no-change refusal", () => {
    for (const [topic, activate, unpublish] of [
      ["pages", "kastir_pages_activate", "kastir_pages_unpublish"],
      ["scripts", "kastir_scripts_activate", "kastir_scripts_unpublish"],
    ] as const) {
      const content = GUIDE_TOPICS[topic];
      expect(content, topic).toContain(activate);
      expect(content, topic).toContain(unpublish);
      expect(content, topic).toContain("INVALID_STATE");
      expect(content, topic).toContain("'No ar'");
      expect(content, topic).toContain("'Fora do ar'");
      expect(content, topic).toMatch(/without creating a version/i);
      expect(content, topic).toMatch(/never published/i);
    }
    expect(GUIDE_TOPICS.scripts).toContain("PUBLISH_SCRIPT");

    // publishing resume a regra para os dois tipos e deixa o unpublish como "desligar".
    expect(GUIDE_TOPICS.publishing).toContain("kastir_pages_activate");
    expect(GUIDE_TOPICS.publishing).toContain("kastir_scripts_activate");
    expect(GUIDE_TOPICS.publishing).toMatch(/turn on = publish/i);
    expect(GUIDE_TOPICS.publishing).toMatch(
      /turn off = kastir_pages_unpublish/i,
    );
    expect(GUIDE_TOPICS.publishing).toMatch(/never deploy/i);
  });

  it("explains that creation never activates resources", () => {
    expect(GUIDE_TOPICS["getting-started"]).toMatch(
      /never activates|never active/i,
    );
    expect(GUIDE_TOPICS["getting-started"]).toContain("kastir_pages_publish");
    expect(GUIDE_TOPICS["getting-started"]).toContain("kastir_scripts_publish");
    expect(GUIDE_TOPICS["getting-started"]).toContain(
      "kastir_split_tests_update",
    );
  });

  it("keeps the popup guardrails in the shared playbook", () => {
    expect(MCP_POPUP_PLAYBOOK).toMatch(
      /Do not: popup on ALL_PAGES, popup without close UI, two PAGE_LOAD popups on the same page/i,
    );
  });

  it("distinguishes server compilation from browser execution", () => {
    expect(GUIDE_TOPICS.scripts).toMatch(/server does not execute/i);
    expect(GUIDE_TOPICS.scripts).toMatch(/browser may execute/i);
    expect(GUIDE_TOPICS.publishing).toMatch(/browser interprets/i);
  });

  it("returns only the index without a topic and one topic when requested", () => {
    expect(getGuide()).toEqual({
      topics: GUIDE_TOPIC_NAMES.map((topic) => ({
        topic,
        summary: expect.any(String),
      })),
    });
    expect(getGuide("popups")).toEqual({
      topic: "popups",
      content: GUIDE_TOPICS.popups,
    });
    expect(() => getGuide("unknown" as never)).toThrow(/unknown guide topic/i);
  });

  it("registers the guide with read scope and enum validation", () => {
    const registered = new Map<
      string,
      {
        inputSchema: { safeParse: (value: unknown) => { success: boolean } };
        annotations?: { readOnlyHint?: boolean };
      }
    >();
    registerSiteTools(
      {
        registerTool: (
          name: string,
          options: {
            inputSchema: never;
            annotations?: { readOnlyHint?: boolean };
          },
        ) => {
          registered.set(name, options);
        },
      } as never,
      context,
    );

    const guide = registered.get("kastir_guide_get");
    expect(guide).toBeDefined();
    expect(guide?.annotations?.readOnlyHint).toBe(true);
    expect(guide!.inputSchema.safeParse({}).success).toBe(true);
    expect(guide!.inputSchema.safeParse({ topic: "popups" }).success).toBe(
      true,
    );
    expect(guide!.inputSchema.safeParse({ topic: "unknown" }).success).toBe(
      false,
    );
  });
});
