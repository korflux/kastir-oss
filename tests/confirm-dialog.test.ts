// @vitest-environment jsdom

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfirmDialog,
  isConfirmEnabled,
} from "@/components/Shared/ConfirmDialog";

// Habilita o flush determinístico dos efeitos React usados pela montagem.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ConfirmDialog confirm gate", () => {
  it("keeps confirm enabled without expectedText (simple variant)", () => {
    expect(isConfirmEnabled({})).toBe(true);
    expect(isConfirmEnabled({ typed: "anything" })).toBe(true);
  });

  it("requires an exact match when expectedText is set", () => {
    expect(isConfirmEnabled({ expectedText: "DELETAR TODAS", typed: "" })).toBe(
      false,
    );
    expect(
      isConfirmEnabled({
        expectedText: "DELETAR TODAS",
        typed: "deletar todas",
      }),
    ).toBe(false);
    expect(
      isConfirmEnabled({
        expectedText: "DELETAR TODAS",
        typed: "DELETAR TODAS",
      }),
    ).toBe(true);
  });

  it("stays disabled while busy even if the text matches", () => {
    expect(
      isConfirmEnabled({
        busy: true,
        expectedText: "DELETAR TODAS",
        typed: "DELETAR TODAS",
      }),
    ).toBe(false);
    expect(isConfirmEnabled({ busy: true })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Renderizado: texto simples (usos antigos) e corpo rico (restaurar versão)   */
/* -------------------------------------------------------------------------- */

let root: Root | undefined;

function unmount() {
  if (root) {
    act(() => root?.unmount());
    root = undefined;
  }
  document.body.replaceChildren();
}

afterEach(unmount);

function mount(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  unmount();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      createElement(ConfirmDialog, {
        open: true,
        title: "Take offline?",
        description: "The URL will return 404.",
        confirmLabel: "Take offline",
        closeLabel: "Close",
        onOpenChange: () => undefined,
        onConfirm: () => undefined,
        ...props,
      }),
    );
  });
}

function dialogContent(): HTMLElement {
  const content = document.body.querySelector<HTMLElement>(
    '[data-slot="dialog-content"]',
  );
  expect(content).not.toBeNull();
  return content!;
}

describe("ConfirmDialog rendered", () => {
  it("keeps the text-only usage unchanged", () => {
    mount();
    const content = dialogContent();
    expect(content.textContent).toContain("Take offline?");
    expect(content.textContent).toContain("The URL will return 404.");
    expect(content.textContent).toContain("Cancel");
    // Sem corpo extra e sem largura própria: o diálogo mantém o limite padrão.
    expect(content.className).toContain("sm:max-w-sm");
    expect(content.className).not.toContain("460px");
  });

  it("renders a rich body between the sentence and the actions", () => {
    mount({
      contentClassName: "sm:max-w-[460px]",
      children: createElement(
        "ul",
        { "data-testid": "rich-body" },
        createElement("li", null, "Code: +2 / −1 lines"),
      ),
    });
    const content = dialogContent();
    const body = content.querySelector('[data-testid="rich-body"]');
    const description = content.querySelector(
      '[data-slot="dialog-description"]',
    );
    const footer = content.querySelector('[data-slot="dialog-footer"]');
    expect(body?.textContent).toBe("Code: +2 / −1 lines");
    expect(content.className).toContain("sm:max-w-[460px]");
    // Ordem do design: frase, lista, ações.
    expect(
      description!.compareDocumentPosition(body!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      body!.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Fase 4, A3 e design › Diálogos: o X do canto é anunciado "Fechar"/"Close" do dicionário, e o
  // botão do rodapé "Cancelar"/"Cancel". Os dois rótulos são independentes: antes o X herdava o
  // `cancelLabel` quando `closeLabel` faltava, e ~12 consumidores o anunciavam como "Cancelar".
  // `closeLabel` agora é obrigatório (trava de tipo abaixo), então o fallback deixou de existir
  // e o teste que o afirmava passou a afirmar a separação dos dois nomes, em en e pt-BR.
  it.each([
    { cancel: "Cancel", close: "Close" },
    { cancel: "Cancelar", close: "Fechar" },
  ])(
    "names the corner X from closeLabel ($close), apart from the footer cancel ($cancel)",
    ({ cancel, close }) => {
      mount({ cancelLabel: cancel, closeLabel: close });
      const buttons = [...dialogContent().querySelectorAll("button")];

      // O X do canto é o único botão do diálogo que traz o ícone.
      expect(
        buttons.find((button) => button.querySelector("svg"))?.textContent,
      ).toBe(close);
      // O rodapé segue com o texto de cancelar, sem o de fechar.
      expect(
        buttons.filter((button) => button.textContent === cancel),
      ).toHaveLength(1);
      expect(dialogContent().textContent).not.toContain(
        close === "Close" ? "Fechar" : "Close",
      );
    },
  );

  // Trava de tipo (checada pelo `tsc`): sem `closeLabel` não compila, então um consumidor novo
  // não volta a anunciar o X como "Cancelar" por esquecimento.
  it("requires closeLabel at the type level", () => {
    const withoutLabel = () =>
      // @ts-expect-error `closeLabel` é obrigatório no ConfirmDialog.
      createElement(ConfirmDialog, {
        open: true,
        title: "Title",
        description: "Description",
        confirmLabel: "Confirm",
        onOpenChange: () => undefined,
        onConfirm: () => undefined,
      });
    void withoutLabel;
  });

  it("confirms through the primary action and locks it while busy", () => {
    const onConfirm = vi.fn();
    mount({ onConfirm });
    const confirm = [...dialogContent().querySelectorAll("button")].find(
      (button) => button.textContent === "Take offline",
    );
    act(() => confirm?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    mount({ busy: true, busyLabel: "Working…", onConfirm });
    const busyButton = [...dialogContent().querySelectorAll("button")].find(
      (button) => button.textContent === "Working…",
    );
    expect(busyButton?.hasAttribute("disabled")).toBe(true);
  });
});
