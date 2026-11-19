// @vitest-environment jsdom

/**
 * Fase 2, T3: o cabeçalho compartilhado dos editores (`EditorHeader`) renderiza, para cada
 * estado da matriz de `getEditorHeaderState`, exatamente o que a spec promete: rótulo do
 * switch, botão principal habilitado só com pendência, indicador "Não salvo", faixa de
 * alterações salvas, itens do menu ⋯, motivo visível de cada controle indisponível (C4) e a
 * dica de pausa em comparação. O mesmo componente atende Pages e Scripts (sem Pré-visualizar).
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import {
  EditorFeedback,
  EditorHeader,
  type EditorHeaderBusy,
  type EditorHeaderCopy,
} from "@/lib/Modules/Revisions/Components/EditorHeader";
import {
  getEditorHeaderState,
  type EditorStateInput,
} from "@/lib/Modules/Revisions/Components/revisionEditorState";
import { getPanelDictionary } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en");
const pagesCopy = dictionary.pages.publishing;
const scriptsCopy = dictionary.customCode.publishing;

/** Item existente, fora do ar, já publicado uma vez, sem nenhuma pendência. */
const base: EditorStateInput = {
  hasResource: true,
  hasPublishedRevision: true,
  live: false,
  hasUnpublishedChanges: false,
  isDirty: false,
  inspecting: false,
  formValid: true,
  canPreview: true,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});

/** Monta o cabeçalho para um estado e devolve os callbacks espiados. */
async function mountHeader(
  overrides: Partial<EditorStateInput> = {},
  options: {
    copy?: EditorHeaderCopy;
    busy?: EditorHeaderBusy;
    versionInfo?: string;
    trailing?: boolean;
  } = {},
) {
  const callbacks = {
    onPrimary: vi.fn(),
    onToggle: vi.fn(),
    onMenuAction: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(EditorHeader, {
        busy: options.busy ?? null,
        copy: options.copy ?? pagesCopy,
        state: getEditorHeaderState({ ...base, ...overrides }),
        title: "Minha página",
        trailing: options.trailing
          ? createElement("button", { type: "button" }, "Excluir")
          : undefined,
        versionInfo:
          options.versionInfo ?? "Live version: 14/10/2026 10:00 · Ana",
        workingLabel: "Working…",
        ...callbacks,
      }),
    );
  });
  return callbacks;
}

const text = () => container!.textContent ?? "";
const byTestId = (id: string) =>
  container!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const primary = () => byTestId("editor-primary-action") as HTMLButtonElement;
const moreActions = () => byTestId("editor-more-actions") as HTMLButtonElement;
const switchEl = () =>
  container!.querySelector<HTMLButtonElement>('[role="switch"]')!;

/** O menu do Base UI abre por teclado no jsdom (o clique do mouse depende de eventos de ponteiro). */
async function openMenu() {
  await act(async () => {
    moreActions().focus();
    moreActions().dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    );
  });
}

const menuItems = () =>
  [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
    (item) => item.dataset.testid,
  );

describe("EditorHeader: matriz de estados", () => {
  it("nunca publicada: switch com o rótulo do estado e Salvar só com edição", async () => {
    await mountHeader({ hasPublishedRevision: false });

    expect(switchEl().textContent).toBe(pagesCopy.switchNeverPublished);
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(primary().textContent).toBe(pagesCopy.buttonSave);
    expect(primary().disabled).toBe(true);
    expect(text()).toContain(pagesCopy.reasonNothingToSave);
    expect(byTestId("editor-unsaved-indicator")).toBeNull();
    expect(byTestId("editor-pending-banner")).toBeNull();
  });

  it("fora do ar com edição: indicador Não salvo e Salvar habilitado, sem 'e publicar'", async () => {
    const { onPrimary } = await mountHeader({ isDirty: true });

    expect(switchEl().textContent).toBe(pagesCopy.switchOff);
    expect(byTestId("editor-unsaved-indicator")?.textContent).toContain(
      pagesCopy.unsavedIndicator,
    );
    expect(primary().textContent).toBe(pagesCopy.buttonSave);
    expect(primary().disabled).toBe(false);

    await act(async () => primary().click());
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("no ar em dia: 'Salvar e publicar' desabilitado com o motivo e sem faixa de pendência", async () => {
    await mountHeader({ live: true });

    expect(switchEl().textContent).toBe(pagesCopy.switchLive);
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(primary().textContent).toBe(pagesCopy.buttonSaveAndPublish);
    expect(primary().disabled).toBe(true);
    expect(text()).toContain(pagesCopy.reasonNothingToPublish);
    expect(byTestId("editor-pending-banner")).toBeNull();
  });

  it("no ar com alterações salvas: faixa de pendência e botão habilitado", async () => {
    await mountHeader({ live: true, hasUnpublishedChanges: true });

    expect(byTestId("editor-pending-banner")?.textContent).toBe(
      pagesCopy.pendingBanner,
    );
    expect(primary().textContent).toBe(pagesCopy.buttonSaveAndPublish);
    expect(primary().disabled).toBe(false);
  });

  it("no ar com edição não salva: indicador, botão habilitado e sem faixa (a edição vem antes)", async () => {
    await mountHeader({
      live: true,
      hasUnpublishedChanges: true,
      isDirty: true,
    });

    expect(byTestId("editor-unsaved-indicator")).not.toBeNull();
    expect(primary().disabled).toBe(false);
    expect(byTestId("editor-pending-banner")).toBeNull();
  });

  it("formulário inválido: botão e switch desligado ficam desabilitados com o motivo uma vez só", async () => {
    await mountHeader({ isDirty: true, formValid: false });

    expect(primary().disabled).toBe(true);
    expect(switchEl().disabled).toBe(true);
    const occurrences = text().split(pagesCopy.reasonInvalidForm).length - 1;
    expect(occurrences).toBe(1);
  });

  it("item novo: 'Criar', switch ligável com formulário válido e menu ⋯ desabilitado com motivo", async () => {
    await mountHeader({
      hasResource: false,
      hasPublishedRevision: false,
      isDirty: true,
    });

    expect(primary().textContent).toBe(pagesCopy.buttonCreate);
    expect(primary().disabled).toBe(false);
    expect(switchEl().disabled).toBe(false);
    expect(switchEl().textContent).toBe(pagesCopy.switchNeverPublished);
    expect(moreActions().disabled).toBe(true);
    expect(text()).toContain(pagesCopy.reasonNewItem);
  });

  it("nunca mostra um botão Publicar (o switch é o publicar)", async () => {
    for (const overrides of [
      { live: true },
      { live: true, hasUnpublishedChanges: true },
      { isDirty: true },
      { hasPublishedRevision: false },
    ] satisfies Partial<EditorStateInput>[]) {
      await mountHeader(overrides);
      const labels = [...container!.querySelectorAll("button")].map((button) =>
        button.textContent?.trim(),
      );
      expect(labels).not.toContain("Publish");
      act(() => root?.unmount());
      container?.remove();
    }
  });
});

describe("EditorHeader: comparação de versão", () => {
  it("pausa switch, botão e menu e mostra a dica de pausa uma única vez", async () => {
    await mountHeader({ live: true, isDirty: true, inspecting: true });

    expect(switchEl().disabled).toBe(true);
    expect(primary().disabled).toBe(true);
    expect(moreActions().disabled).toBe(true);
    expect(byTestId("editor-paused-hint")?.textContent).toBe(
      pagesCopy.reasonInspecting,
    );
    // O motivo de pausa tem a dica própria; não repete na linha de motivos.
    expect(text().split(pagesCopy.reasonInspecting).length - 1).toBe(1);
  });
});

describe("EditorHeader: menu ⋯", () => {
  it("no ar com edição: versão no ar, 'Salvar sem publicar' e 'Pré-visualizar'", async () => {
    const { onMenuAction } = await mountHeader({ live: true, isDirty: true });
    await openMenu();

    expect(document.body.textContent).toContain(
      "Live version: 14/10/2026 10:00 · Ana",
    );
    expect(menuItems()).toEqual([
      "editor-menu-saveWithoutPublishing",
      "editor-menu-preview",
    ]);
    expect(document.body.textContent).toContain(
      pagesCopy.menuSaveWithoutPublishingHint,
    );

    await act(async () =>
      document.body
        .querySelector<HTMLElement>(
          '[data-testid="editor-menu-saveWithoutPublishing"]',
        )!
        .click(),
    );
    expect(onMenuAction).toHaveBeenCalledWith("saveWithoutPublishing");
  });

  it("no ar sem edição: só Pré-visualizar (Salvar sem publicar não se aplica e não aparece)", async () => {
    await mountHeader({ live: true });
    await openMenu();

    expect(menuItems()).toEqual(["editor-menu-preview"]);
  });

  it("nunca publicada: a primeira linha diz 'Ainda não publicada'", async () => {
    await mountHeader(
      { hasPublishedRevision: false },
      { versionInfo: pagesCopy.menuNeverPublished },
    );
    await openMenu();

    expect(
      document.body.querySelector('[data-testid="editor-version-info"]')
        ?.textContent,
    ).toBe(pagesCopy.menuNeverPublished);
  });

  it("Scripts (canPreview falso): menu sem Pré-visualizar mesmo com edição no ar", async () => {
    await mountHeader(
      { live: true, isDirty: true, canPreview: false },
      { copy: scriptsCopy },
    );
    await openMenu();

    expect(menuItems()).toEqual(["editor-menu-saveWithoutPublishing"]);
    expect(primary().textContent).toBe(scriptsCopy.buttonSaveAndPublish);
  });
});

describe("EditorHeader: operação em andamento", () => {
  it("salvando: botão com 'Salvando…' e tudo inerte", async () => {
    await mountHeader({ isDirty: true }, { busy: "saving" });

    expect(primary().textContent).toBe(pagesCopy.buttonSaving);
    expect(primary().disabled).toBe(true);
    expect(switchEl().disabled).toBe(true);
    expect(moreActions().disabled).toBe(true);
  });

  it("publicando: botão com 'Publicando…'", async () => {
    await mountHeader({ live: true, isDirty: true }, { busy: "publishing" });

    expect(primary().textContent).toBe(pagesCopy.buttonPublishing);
  });

  it("ligando o switch: o switch mostra 'Publicando…'; desligando mostra o rótulo genérico", async () => {
    await mountHeader({ isDirty: true }, { busy: "turningOn" });
    expect(switchEl().textContent).toBe(pagesCopy.buttonPublishing);

    act(() => root?.unmount());
    container?.remove();
    await mountHeader({ live: true }, { busy: "turningOff" });
    expect(switchEl().textContent).toBe("Working…");
  });

  it("switch desabilitado não dispara; habilitado dispara onToggle", async () => {
    const paused = await mountHeader({ inspecting: true });
    await act(async () => switchEl().click());
    expect(paused.onToggle).not.toHaveBeenCalled();

    act(() => root?.unmount());
    container?.remove();
    const enabled = await mountHeader({ isDirty: true });
    await act(async () => switchEl().click());
    expect(enabled.onToggle).toHaveBeenCalledTimes(1);
  });

  it("o destrutivo (Excluir) fica no cabeçalho, depois das demais ações", async () => {
    await mountHeader({ isDirty: true }, { trailing: true });
    const labels = [...container!.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );

    expect(labels.at(-1)).toBe("Excluir");
    expect(labels.indexOf(pagesCopy.buttonSave)).toBeLessThan(
      labels.indexOf("Excluir"),
    );
  });
});

describe("EditorFeedback", () => {
  async function mountFeedback(props: Parameters<typeof EditorFeedback>[0]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(EditorFeedback, props));
    });
  }

  it("erro vira alerta e resultado vira status; sem ação não há botão", async () => {
    await mountFeedback({ error: "Falhou", notice: "Salvo" });

    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(
      "Falhou",
    );
    expect(container!.querySelector('[role="status"]')?.textContent).toBe(
      "Salvo",
    );
    expect(byTestId("editor-notice-action")).toBeNull();
  });

  it("aviso com ação: o botão dispara o callback e, ocupado, troca o rótulo e trava", async () => {
    const onAction = vi.fn();
    await mountFeedback({
      error: null,
      notice: "Restaurado",
      action: { label: "Desfazer", onAction },
    });
    expect(byTestId("editor-notice-action")?.textContent).toBe("Desfazer");

    await act(async () => byTestId("editor-notice-action")!.click());
    expect(onAction).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    container?.remove();
    await mountFeedback({
      error: null,
      notice: "Restaurado",
      action: { label: "Desfazer", onAction },
      actionBusy: true,
      actionBusyLabel: "Desfazendo…",
    });
    const busyButton = byTestId("editor-notice-action") as HTMLButtonElement;
    expect(busyButton.textContent).toBe("Desfazendo…");
    expect(busyButton.disabled).toBe(true);
  });
});
