// @vitest-environment jsdom

import {
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// Habilita o flush determinístico dos efeitos React usados pela reprodução.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, children),
}));

vi.mock("@/lib/requestJson", () => ({ requestJson: requestJsonMock }));

vi.mock("@/components/Shared/ConfirmDialog", () => ({
  ConfirmDialog: ({
    onConfirm,
    open,
  }: {
    onConfirm: () => void;
    open: boolean;
  }) =>
    open
      ? createElement(
          "button",
          { "data-testid": "confirm-mutation", onClick: onConfirm },
          "Confirm",
        )
      : null,
}));

vi.mock(
  "@/lib/Modules/CustomCode/Components/CustomCodeQuickEditPopover",
  () => ({
    CustomCodeQuickEditPopover: () => null,
  }),
);

vi.mock(
  "@/lib/Modules/SplitTests/Components/SplitTestQuickEditPopover",
  () => ({
    SplitTestQuickEditPopover: () => null,
  }),
);

import { CustomCodeList } from "@/lib/Modules/CustomCode/Components/CustomCodeList";
import { SplitTestsList } from "@/lib/Modules/SplitTests/Components/SplitTestsList";
import { getPanelDictionary } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en");

const item = {
  id: "item-a",
  name: "Script A",
  location: "HEADER" as const,
  priority: 1,
  status: "DRAFT" as const,
  createdAt: "2026-08-10T00:00:00.000Z",
  deletedAt: null,
  deletedBy: null,
  scopeType: "ALL_PAGES" as const,
  scopedPages: [],
};

const replacementItem = { ...item, id: "item-b", name: "Script B" };

afterEach(() => {
  requestJsonMock.mockReset();
  document.body.innerHTML = "";
});

describe("seleção das listas após mutação individual", () => {
  it("remove o item da seleção quando a lixeira individual recarrega outro dataset", async () => {
    let listCalls = 0;
    requestJsonMock.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "DELETE") return Promise.resolve({});

      listCalls += 1;
      return Promise.resolve({
        items: [listCalls === 1 ? item : replacementItem],
      });
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(CustomCodeList, {
          bulkDictionary: dictionary.bulk,
          canBulk: true,
          dictionary: dictionary.customCode,
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });

    const rowCheckbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(rowCheckbox).not.toBeNull();

    await act(async () => {
      rowCheckbox!.click();
    });
    expect(
      container.querySelector('[data-testid="bulk-action-bar"]'),
    ).not.toBeNull();

    const trashButton = [
      ...container.querySelectorAll("button[aria-label]"),
    ].find(
      (button) =>
        button.getAttribute("aria-label") === dictionary.customCode.moveToTrash,
    );
    expect(trashButton).not.toBeUndefined();

    await act(async () => {
      (trashButton as HTMLButtonElement).click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="confirm-mutation"]')
        ?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="bulk-action-bar"]'),
    ).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });
});

/**
 * Fase 4, T4 (A4): a direção da ordenação por nome é anunciada no `columnheader` da coluna Nome
 * (`aria-sort`, padrão ARIA de tabela ordenável) também em Scripts e Split Tests, que usam o mesmo
 * `NameSortHeader` de Pages. `aria-sort` só vale em `columnheader` dentro de uma `table`, e o
 * botão de dentro não leva o atributo. Vale na lista ativa e na lixeira.
 */
const campaign = {
  id: "campaign-a",
  name: "Campaign A",
  slug: "campaign-a",
  status: "ACTIVE" as const,
  author: null,
  activeDestinationCount: 1,
  totalHits: 0,
  deletedAt: null,
  deletedBy: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

describe.each([
  {
    name: "Scripts",
    render: () =>
      createElement(CustomCodeList, {
        bulkDictionary: dictionary.bulk,
        canBulk: true,
        dictionary: dictionary.customCode,
      }),
    items: [item],
  },
  {
    name: "Split Tests",
    render: () =>
      createElement(SplitTestsList, {
        bulkDictionary: dictionary.bulk,
        canBulk: true,
        dictionary: dictionary.splitTests,
        publicOrigin: "https://example.com",
      }),
    items: [campaign],
  },
])("direção da ordenação por nome anunciada em $name", ({ render, items }) => {
  /** Cabeçalho da coluna Nome: o `columnheader` que contém o botão de ordenação. */
  const nameColumn = (container: HTMLElement) =>
    container
      .querySelector('[role="columnheader"] button')!
      .closest<HTMLElement>('[role="columnheader"]')!;

  async function mountList() {
    requestJsonMock.mockImplementation(() => Promise.resolve({ items }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(render());
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    });
    return { container, root };
  }

  it("lista ativa e lixeira: só a coluna Nome tem aria-sort, dentro de uma table, e o botão alterna crescente/decrescente", async () => {
    const { container, root } = await mountList();

    for (const mode of ["ativa", "lixeira"]) {
      if (mode === "lixeira") {
        const toggle = container.querySelector<HTMLButtonElement>(
          "button[aria-pressed]",
        )!;
        await act(async () => {
          toggle.click();
        });
        await act(async () => {
          await new Promise((resolve) => window.setTimeout(resolve, 220));
        });
        // A direção escolhida na lista ativa vale na lixeira (mesmo estado).
        expect(nameColumn(container).getAttribute("aria-sort")).toBe(
          "descending",
        );
      }

      const name = nameColumn(container);
      const button = name.querySelector("button")!;
      expect(name.closest('[role="table"]')).not.toBeNull();
      expect(button.hasAttribute("aria-sort")).toBe(false);
      expect([
        ...container.querySelectorAll('[role="columnheader"][aria-sort]'),
      ]).toEqual([name]);

      if (mode === "ativa") {
        expect(name.getAttribute("aria-sort")).toBe("ascending");
        await act(async () => {
          button.click();
        });
        expect(name.getAttribute("aria-sort")).toBe("descending");
      }
    }

    await act(async () => root.unmount());
    container.remove();
  });
});
