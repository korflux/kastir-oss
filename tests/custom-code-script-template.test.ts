import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CustomCodeTriggerFields } from "@/lib/Modules/CustomCode/Components/CustomCodeTriggerFields";
import {
  getNewScriptTemplate,
  NEW_POPUP_TEMPLATE_EN,
  NEW_POPUP_TEMPLATE_PT_BR,
  NEW_SCRIPT_TEMPLATE_EN,
  NEW_SCRIPT_TEMPLATE_PT_BR,
  resolveNewScriptTemplateLocale,
} from "@/lib/Modules/CustomCode/newScriptTemplate";
import { MCP_POPUP_PLAYBOOK } from "@/lib/Modules/Mcp/Guide";
import { getPanelDictionary } from "@/lib/i18n/panel";

describe("newScriptTemplate", () => {
  it("resolves locale like the page starter", () => {
    expect(resolveNewScriptTemplateLocale("en")).toBe("en");
    expect(resolveNewScriptTemplateLocale("pt-BR")).toBe("pt-BR");
    expect(resolveNewScriptTemplateLocale("pt")).toBe("pt-BR");
    expect(resolveNewScriptTemplateLocale("pt-PT")).toBe("pt-BR");
    expect(resolveNewScriptTemplateLocale("fr")).toBe("en");
  });

  it("returns base and popup variants per language", () => {
    expect(getNewScriptTemplate("en")).toBe(NEW_SCRIPT_TEMPLATE_EN);
    expect(getNewScriptTemplate("pt-BR")).toBe(NEW_SCRIPT_TEMPLATE_PT_BR);
    expect(getNewScriptTemplate("en", { popup: true })).toBe(
      NEW_POPUP_TEMPLATE_EN,
    );
    expect(getNewScriptTemplate("pt-BR", { popup: true })).toBe(
      NEW_POPUP_TEMPLATE_PT_BR,
    );
  });

  it("popup starter is accessible and does not recreate the compile wrapper", () => {
    const html = getNewScriptTemplate("en", { popup: true });

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("data-kastir-popup-close");
    expect(html).toMatch(/Escape|keydown/);
    expect(html).toContain("previouslyFocused");
    expect(html).toContain("focus");
    // Wrapper is created by compile — starter must not invent data-kastir-trigger=.
    expect(html).not.toMatch(/data-kastir-trigger=/);
    expect(html).toContain("data-kastir-trigger");
  });

  it("defers focus and Escape until the compile wrapper is shown", () => {
    const html = getNewScriptTemplate("en", { popup: true });

    // Must not focus on inject; open waits for wrapper visibility.
    expect(html).toContain("MutationObserver");
    expect(html).toContain("openPopup");
    expect(html).toContain("syncOpenState");
    // Global querySelector(".kastir-popup") would grab the wrong dialog.
    expect(html).not.toMatch(/querySelector\(\s*["']\.kastir-popup["']\s*\)/);
    // openPopup only after isShown(wrapper) or when there is no wrapper.
    expect(html).toMatch(
      /if\s*\(\s*!root\.closest\(\s*["']\[data-kastir-trigger\]["']\s*\)\s*\)\s*openPopup/,
    );
  });

  it("traps keyboard focus and generates a title id per popup instance", () => {
    const html = getNewScriptTemplate("en", { popup: true });

    expect(html).toContain("focusableElements");
    expect(html).toContain("shiftKey");
    expect(html).toContain("preventDefault");
    expect(html).toContain("titleSequence");
    expect(html).toContain("data-kastir-popup-title");
    expect(html).not.toContain('aria-labelledby="kastir-popup-title"');
    expect(html).not.toMatch(/id="kastir-popup-title"/);
  });

  it("warns that an untriggered popup opens on every page in its scope", () => {
    expect(NEW_POPUP_TEMPLATE_EN).toMatch(/without a trigger/i);
    expect(NEW_POPUP_TEMPLATE_PT_BR).toMatch(/sem gatilho/i);
  });

  it("teaches all four triggers with visible example markup, like the page starter", () => {
    for (const html of [NEW_SCRIPT_TEMPLATE_EN, NEW_SCRIPT_TEMPLATE_PT_BR]) {
      expect(html).toContain("SELECTOR_EVENT");
      expect(html).toContain("PAGE_LOAD");
      expect(html).toContain("SCROLL");
      expect(html).toContain("REFERRER");
      expect(html).toContain("data-kastir-trigger");
      expect(html).toContain("<style>");
      expect(html).toContain("<script>");
      expect(html).toContain('class="kastir-snippet"');
      expect(html).toMatch(/<button[\s\S]*open-notice/);
    }
    expect(NEW_SCRIPT_TEMPLATE_EN).toMatch(/Details on the right/i);
    expect(NEW_SCRIPT_TEMPLATE_PT_BR).toMatch(
      /Details à direita|campos do Details/i,
    );
  });

  it("renders trigger fields without the popup guidance block", () => {
    const dictionary = getPanelDictionary("en").customCode;
    const html = renderToStaticMarkup(
      createElement(CustomCodeTriggerFields, {
        dictionary,
        snippetId: "snippet-id",
        selectClassName: "select",
        triggerType: "PAGE_LOAD",
        selector: "",
        selectorEvent: "click",
        delaySeconds: "2",
        percentage: "",
        referrerMatches: "",
        maxDisplays: "",
        displayResetDays: "",
        onTriggerTypeChange: () => undefined,
        onSelectorChange: () => undefined,
        onSelectorEventChange: () => undefined,
        onDelaySecondsChange: () => undefined,
        onPercentageChange: () => undefined,
        onReferrerMatchesChange: () => undefined,
        onMaxDisplaysChange: () => undefined,
        onDisplayResetDaysChange: () => undefined,
        onDirty: () => undefined,
      }),
    );

    expect(html).not.toContain('data-testid="custom-code-popup-guidance"');
    expect(html).not.toContain("Use popup starter");
    expect(html).toContain('id="trigger-delay"');
    // O painel não exibe as regras de popup do manual do MCP (só o MCP as serve, em inglês).
    expect(html).not.toContain(MCP_POPUP_PLAYBOOK.slice(0, 40));
  });
});
