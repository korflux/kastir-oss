// @vitest-environment jsdom

/**
 * Fase 2, T5: o switch das listagens de Pages e Scripts segue a mesma regra do editor
 * (spec A12, C1, F9). Jornadas observáveis no DOM, com o servidor mockado em `requestJson`:
 * ligar publica o rascunho salvo; ativar só entra na recusa "sem alteração não publicada";
 * item nunca publicado é ligável; desligar pede confirmação e só então chama unpublish;
 * o rótulo curto do mobile mantém o nome acessível completo; o StatusToggle sem a prop
 * nova renderiza como antes (Split tests e editores dependem disso).
 */

import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) =>
    createElement("a", props, children),
}));

vi.mock("@/lib/requestJson", () => ({ requestJson: requestJsonMock }));

// Diálogo mínimo que expõe título, frase e botões, para provar o conteúdo e o fluxo da
// confirmação sem depender do portal do Dialog.
vi.mock("@/components/Shared/ConfirmDialog", () => ({
  ConfirmDialog: ({
    cancelLabel,
    confirmLabel,
    description,
    onConfirm,
    onOpenChange,
    open,
    title,
  }: {
    cancelLabel?: string;
    confirmLabel: string;
    description: string;
    onConfirm: () => void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    title: string;
  }) =>
    open
      ? createElement(
          "div",
          { "data-testid": "confirm", role: "dialog" },
          createElement("h2", null, title),
          createElement("p", null, description),
          createElement(
            "button",
            { "data-testid": "confirm-yes", onClick: onConfirm },
            confirmLabel,
          ),
          createElement(
            "button",
            { "data-testid": "confirm-no", onClick: () => onOpenChange(false) },
            cancelLabel,
          ),
        )
      : null,
}));

vi.mock("@/lib/Modules/Pages/Components/PageQuickEditPopover", () => ({
  PageQuickEditPopover: () => null,
}));
vi.mock(
  "@/lib/Modules/CustomCode/Components/CustomCodeQuickEditPopover",
  () => ({
    CustomCodeQuickEditPopover: () => null,
  }),
);

import { StatusToggle } from "@/components/Shared/StatusToggle";
import { CustomCodeList } from "@/lib/Modules/CustomCode/Components/CustomCodeList";
import { PagesWorkspace } from "@/lib/Modules/Pages/Components/PagesWorkspace";
import { getPanelDictionary, type PublishingCopy } from "@/lib/i18n/panel";

const dictionary = getPanelDictionary("en");
const pagesCopy = dictionary.pages;
const scriptsCopy = dictionary.customCode;

/* -------------------------------------------------------------------------- */
/* StatusToggle                                                                */
/* -------------------------------------------------------------------------- */

describe("StatusToggle", () => {
  const base = {
    appearance: "switch" as const,
    publishedLabel: "Live",
    draftLabel: "Offline",
    publishLabel: "Put live",
    unpublishLabel: "Take offline",
    busyLabel: "Working",
    onToggle: () => undefined,
  };

  // Marcação capturada do componente ANTES da prop `draftShortLabel` existir: sem a prop, a
  // saída precisa ser idêntica (Split tests e editores consomem o switch sem mudança).
  const TRACK_ON =
    '<span aria-hidden="true" class="relative inline-flex h-[19px] w-10 shrink-0 items-center rounded-full transition-colors bg-brand"><span class="absolute top-1/2 size-[17px] -translate-y-1/2 rounded-full bg-white shadow transition-all left-[21px]"></span></span>';
  const TRACK_OFF =
    '<span aria-hidden="true" class="relative inline-flex h-[19px] w-10 shrink-0 items-center rounded-full transition-colors bg-muted"><span class="absolute top-1/2 size-[17px] -translate-y-1/2 rounded-full bg-white shadow transition-all left-0.5"></span></span>';
  const BUTTON_CLASS =
    "focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-md text-sm outline-none focus-visible:ring-2";

  it("sem a prop nova renderiza exatamente a marcação anterior", () => {
    expect(
      renderToStaticMarkup(
        createElement(StatusToggle, { ...base, published: true }),
      ),
    ).toBe(
      `<button aria-checked="true" aria-disabled="false" aria-label="Take offline" class="${BUTTON_CLASS}" role="switch" type="button">${TRACK_ON}<span class="text-sm text-foreground">Live</span></button>`,
    );
    expect(
      renderToStaticMarkup(
        createElement(StatusToggle, { ...base, published: false }),
      ),
    ).toBe(
      `<button aria-checked="false" aria-disabled="false" aria-label="Put live" class="${BUTTON_CLASS}" role="switch" type="button">${TRACK_OFF}<span class="text-sm text-muted-foreground">Offline</span></button>`,
    );
    expect(
      renderToStaticMarkup(
        createElement(StatusToggle, { ...base, published: false, busy: true }),
      ),
    ).toBe(
      `<button aria-checked="false" aria-disabled="true" aria-label="Put live" class="${BUTTON_CLASS} opacity-60" disabled="" role="switch" type="button">${TRACK_OFF}<span class="text-sm text-muted-foreground">Working</span></button>`,
    );
    expect(
      renderToStaticMarkup(
        createElement(StatusToggle, {
          ...base,
          published: false,
          disabled: true,
        }),
      ),
    ).toBe(
      `<button aria-checked="false" aria-disabled="true" aria-label="Put live" class="${BUTTON_CLASS} opacity-60" disabled="" role="switch" type="button">${TRACK_OFF}<span class="text-sm text-muted-foreground">Offline</span></button>`,
    );
  });

  it("rótulo curto só troca o texto visível fora do ar; o nome acessível segue completo", () => {
    const off = renderToStaticMarkup(
      createElement(StatusToggle, {
        ...base,
        published: false,
        draftShortLabel: "Off",
      }),
    );
    // Texto longo a partir de `sm`, curto abaixo; o aria-label não depende da largura.
    expect(off).toContain('<span class="hidden sm:inline">Offline</span>');
    expect(off).toContain('<span class="sm:hidden">Off</span>');
    expect(off).toContain('aria-label="Put live"');

    // No ar e ocupado ignoram o rótulo curto ("No ar" já é curto; o ocupado é transitório).
    const on = renderToStaticMarkup(
      createElement(StatusToggle, {
        ...base,
        published: true,
        draftShortLabel: "Off",
      }),
    );
    expect(on).toContain(">Live</span>");
    expect(on).not.toContain("sm:hidden");
    const busy = renderToStaticMarkup(
      createElement(StatusToggle, {
        ...base,
        published: false,
        busy: true,
        draftShortLabel: "Off",
      }),
    );
    expect(busy).toContain(">Working</span>");
    expect(busy).not.toContain("sm:hidden");
  });

  it("a aparência botão ignora o rótulo curto", () => {
    const props = {
      published: false,
      draftLabel: "Draft",
      onToggle: () => undefined,
    };
    expect(
      renderToStaticMarkup(
        createElement(StatusToggle, { ...props, draftShortLabel: "Off" }),
      ),
    ).toBe(renderToStaticMarkup(createElement(StatusToggle, props)));
  });
});

/* -------------------------------------------------------------------------- */
/* Apoio das jornadas das listagens                                            */
/* -------------------------------------------------------------------------- */

type Row = {
  id: string;
  /** Título (Pages) ou nome (Scripts); a ordem alfabética define a ordem das linhas. */
  label: string;
  status: "DRAFT" | "PUBLISHED";
  publishedRevisionId: string | null;
};

const ROWS: Row[] = [
  {
    id: "r-out",
    label: "A fora do ar",
    status: "DRAFT",
    publishedRevisionId: "rev-1",
  },
  {
    id: "r-never",
    label: "B nunca publicada",
    status: "DRAFT",
    publishedRevisionId: null,
  },
  {
    id: "r-live",
    label: "C no ar",
    status: "PUBLISHED",
    publishedRevisionId: "rev-2",
  },
];

/** Erro como o `requestJson` real o devolve: mensagem do servidor + `code`. */
function apiError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

type ApiCall = { url: string; method: string };

/**
 * Servidor falso de uma listagem. `base` é o prefixo da API do módulo; `refusePublish`
 * decide, por id, se o publish é recusado e com qual erro. O estado das linhas muda como o
 * servidor mudaria (publish/activate ligam, unpublish desliga) para provar o recarregamento.
 */
function installApi(options: {
  base: string;
  listKey: "pages" | "items";
  toDto: (row: Row) => Record<string, unknown>;
  extraListFields?: Record<string, unknown>;
  refusePublish?: (id: string) => Error | null;
}) {
  const rows = ROWS.map((row) => ({ ...row }));
  const calls: ApiCall[] = [];
  requestJsonMock.mockImplementation(
    async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (method === "GET") {
        return {
          [options.listKey]: rows.map(options.toDto),
          ...options.extraListFields,
        };
      }
      const match = url.slice(options.base.length).match(/^\/([^/]+)\/(\w+)$/);
      if (!match) throw new Error(`rota inesperada: ${method} ${url}`);
      const [, id, action] = match;
      const row = rows.find((candidate) => candidate.id === id)!;
      if (action === "publish") {
        const refusal = options.refusePublish?.(id);
        if (refusal) throw refusal;
        row.status = "PUBLISHED";
        row.publishedRevisionId = row.publishedRevisionId ?? "rev-new";
      } else if (action === "activate") {
        row.status = "PUBLISHED";
      } else if (action === "unpublish") {
        row.status = "DRAFT";
      }
      return {};
    },
  );
  return {
    calls,
    /** Chamadas de ciclo de vida (tudo que não é a leitura da lista). */
    actions: () =>
      calls
        .filter((call) => call.method !== "GET")
        .map((call) => `${call.method} ${call.url.slice(options.base.length)}`),
  };
}

let mounted: { root: Root; container: HTMLElement } | null = null;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  });
}

async function mount(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(element);
  });
  // Pages carrega em seguida; Scripts espera um debounce de 180 ms.
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 260));
  });
  return container;
}

afterEach(async () => {
  requestJsonMock.mockReset();
  if (mounted) {
    await act(async () => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  document.body.innerHTML = "";
});

/** Switch da n-ésima linha (ordem alfabética de `ROWS`). */
function switchAt(container: HTMLElement, index: number): HTMLButtonElement {
  const actions = container.querySelectorAll<HTMLElement>(
    '[data-testid="page-row-actions"], [data-testid="script-row-actions"]',
  );
  const toggle =
    actions[index]?.querySelector<HTMLButtonElement>('[role="switch"]');
  if (!toggle) throw new Error(`switch da linha ${index} não encontrado`);
  return toggle;
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

const byTestId = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/* -------------------------------------------------------------------------- */
/* Jornadas: a mesma regra em Pages e em Scripts                               */
/* -------------------------------------------------------------------------- */

type Scenario = {
  name: string;
  base: string;
  copy: PublishingCopy;
  working: string;
  render: () => ReactNode;
  install: (
    refusePublish?: (id: string) => Error | null,
  ) => ReturnType<typeof installApi>;
};

const scenarios: Scenario[] = [
  {
    name: "Pages",
    base: "/api/admin/pages",
    copy: pagesCopy.publishing,
    working: pagesCopy.working,
    render: () =>
      createElement(PagesWorkspace, {
        bulkDictionary: dictionary.bulk,
        canBulk: false,
        dictionary: pagesCopy,
        folderDictionary: dictionary.folders,
        publicOrigin: "https://example.com",
      }),
    install: (refusePublish) =>
      installApi({
        base: "/api/admin/pages",
        listKey: "pages",
        refusePublish,
        extraListFields: {
          folders: [
            {
              id: "base",
              name: "Base",
              color: null,
              parentId: null,
              isBase: true,
            },
          ],
        },
        toDto: (row) => ({
          id: row.id,
          title: row.label,
          slug: row.id,
          status: row.status,
          folderId: "base",
          authorId: "u1",
          author: { id: "u1", name: "Ana" },
          publishedRevisionId: row.publishedRevisionId,
          publishedAt: null,
          deletedAt: null,
          createdAt: "2026-08-10T00:00:00.000Z",
        }),
      }),
  },
  {
    name: "Scripts",
    base: "/api/admin/custom-code",
    copy: scriptsCopy.publishing,
    working: scriptsCopy.working,
    render: () =>
      createElement(CustomCodeList, {
        bulkDictionary: dictionary.bulk,
        canBulk: false,
        dictionary: scriptsCopy,
      }),
    install: (refusePublish) =>
      installApi({
        base: "/api/admin/custom-code",
        listKey: "items",
        refusePublish,
        toDto: (row) => ({
          id: row.id,
          name: row.label,
          location: "HEADER",
          priority: 1,
          status: row.status,
          publishedRevisionId: row.publishedRevisionId,
          createdAt: "2026-08-10T00:00:00.000Z",
          deletedAt: null,
          deletedBy: null,
          scopeType: "ALL_PAGES",
          scopedPages: [],
        }),
      }),
  },
];

const nothingToPublish = (kind: string) =>
  apiError("INVALID_STATE", `${kind} has no unpublished changes`);

describe.each(scenarios)("switch da listagem de $name", (scenario) => {
  const { copy } = scenario;
  const noticeText = (container: HTMLElement) =>
    container.querySelector('[role="status"]')?.textContent ?? "";

  it("mostra No ar, Fora do ar e Fora do ar · nunca publicada, com rótulo curto no mobile", async () => {
    scenario.install();
    const container = await mount(scenario.render());

    const [out, never, live] = [0, 1, 2].map((i) => switchAt(container, i));
    // Fora do ar com versão guardada: texto completo + curto (CSS escolhe pela largura).
    expect(out.getAttribute("aria-checked")).toBe("false");
    expect(out.textContent).toContain(copy.switchOff);
    expect(out.textContent).toContain(copy.switchOffShort);
    // Nome acessível é a ação completa, independente do rótulo curto.
    expect(out.getAttribute("aria-label")).toBe(copy.switchTurnOn);
    // Nunca publicado: texto próprio do módulo.
    expect(never.textContent).toContain(copy.switchNeverPublished);
    expect(never.textContent).toContain(copy.switchOffShort);
    // No ar: "No ar"/"Live" e o nome acessível de desligar.
    expect(live.getAttribute("aria-checked")).toBe("true");
    expect(live.textContent).toBe(copy.switchLive);
    expect(live.getAttribute("aria-label")).toBe(copy.switchTurnOff);
  });

  it("ligar um item fora do ar publica o rascunho salvo, sem salvar nem ativar", async () => {
    const api = scenario.install();
    const container = await mount(scenario.render());

    await click(switchAt(container, 0));

    expect(api.actions()).toEqual([`POST /r-out/publish`]);
    expect(noticeText(container)).toBe(copy.noticePublished);
    // A lista foi recarregada e o switch agora está ligado.
    expect(switchAt(container, 0).getAttribute("aria-checked")).toBe("true");
  });

  it("quando o servidor recusa 'sem alteração não publicada', ativa a versão publicada", async () => {
    const api = scenario.install((id) =>
      id === "r-out" ? nothingToPublish("Item") : null,
    );
    const container = await mount(scenario.render());

    await click(switchAt(container, 0));

    expect(api.actions()).toEqual([
      `POST /r-out/publish`,
      `POST /r-out/activate`,
    ]);
    expect(noticeText(container)).toBe(copy.noticeBackLive);
    expect(switchAt(container, 0).getAttribute("aria-checked")).toBe("true");
  });

  it("item nunca publicado fica habilitado e liga publicando", async () => {
    const api = scenario.install();
    const container = await mount(scenario.render());

    const never = switchAt(container, 1);
    expect(never.disabled).toBe(false);
    expect(never.getAttribute("aria-disabled")).toBe("false");

    await click(never);

    expect(api.actions()).toEqual([`POST /r-never/publish`]);
    expect(noticeText(container)).toBe(copy.noticePublished);
    expect(switchAt(container, 1).getAttribute("aria-checked")).toBe("true");
  });

  it("outro erro do publish (ex.: mídia não pronta) é mostrado, não ativa e mantém o switch fora", async () => {
    const mediaError = apiError(
      "VALIDATION_ERROR",
      "Referenced media is not ready to publish",
    );
    const api = scenario.install((id) => (id === "r-out" ? mediaError : null));
    const container = await mount(scenario.render());

    await click(switchAt(container, 0));

    expect(api.actions()).toEqual([`POST /r-out/publish`]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Referenced media is not ready to publish",
    );
    expect(switchAt(container, 0).getAttribute("aria-checked")).toBe("false");
    expect(switchAt(container, 0).disabled).toBe(false);
  });

  it("desligar abre a confirmação e só chama unpublish ao confirmar", async () => {
    const api = scenario.install();
    const container = await mount(scenario.render());

    await click(switchAt(container, 2));

    // Confirmação com o texto do módulo; nada foi chamado ainda.
    const dialog =
      byTestId(container, "confirm") ?? byTestId(document.body, "confirm");
    expect(dialog?.textContent).toContain(copy.unpublishTitle);
    expect(dialog?.textContent).toContain(copy.unpublishDescription);
    expect(byTestId(container, "confirm-yes")?.textContent).toBe(
      copy.unpublishConfirm,
    );
    expect(api.actions()).toEqual([]);

    // Cancelar não muda nada.
    await click(byTestId(container, "confirm-no")!);
    expect(api.actions()).toEqual([]);
    expect(byTestId(container, "confirm")).toBeNull();
    expect(switchAt(container, 2).getAttribute("aria-checked")).toBe("true");

    // Confirmar tira do ar, avisa e fecha o diálogo.
    await click(switchAt(container, 2));
    await click(byTestId(container, "confirm-yes")!);
    expect(api.actions()).toEqual([`POST /r-live/unpublish`]);
    expect(noticeText(container)).toBe(copy.noticeTakenOffline);
    expect(byTestId(container, "confirm")).toBeNull();
    expect(switchAt(container, 2).getAttribute("aria-checked")).toBe("false");
    // Item tirado do ar guarda a versão publicada: texto "Fora do ar", não "nunca publicada".
    expect(switchAt(container, 2).textContent).toContain(copy.switchOff);
    expect(switchAt(container, 2).textContent).not.toContain(
      copy.switchNeverPublished,
    );
  });

  it("ocupado aparece só na linha em curso; as demais ficam inertes", async () => {
    let releasePublish: () => void = () => undefined;
    const api = scenario.install();
    const baseImpl = requestJsonMock.getMockImplementation()!;
    requestJsonMock.mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (url.endsWith("/r-out/publish")) {
          await new Promise<void>((resolve) => {
            releasePublish = resolve;
          });
        }
        return baseImpl(url, init);
      },
    );
    const container = await mount(scenario.render());

    await act(async () => {
      switchAt(container, 0).click();
    });
    expect(switchAt(container, 0).textContent).toBe(copy.buttonPublishing);
    expect(switchAt(container, 0).disabled).toBe(true);
    // Outra linha: sem rótulo de ocupado, só inerte.
    expect(switchAt(container, 1).textContent).not.toContain(
      copy.buttonPublishing,
    );
    expect(switchAt(container, 1).disabled).toBe(true);

    await act(async () => {
      releasePublish();
    });
    await settle();
    expect(api.actions()).toEqual([`POST /r-out/publish`]);
    expect(switchAt(container, 1).disabled).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Scripts: rótulo de cancelar das confirmações unitárias                      */
/* -------------------------------------------------------------------------- */

/**
 * As confirmações de lixeira e de exclusão permanente de uma linha são decisões, não
 * navegação: o botão que as dispensa diz "Cancelar", como nas demais confirmações do módulo,
 * e nunca "Voltar para scripts" (rótulo de saída do editor, mesma causa raiz da T5 do editor).
 * O ConfirmDialog mockado acima expõe `cancelLabel` em `confirm-no`.
 */
describe.each(["en", "pt-BR"] as const)(
  "confirmações unitárias da lista de Scripts (%s)",
  (locale) => {
    const copy = getPanelDictionary(locale).customCode;
    const panel = getPanelDictionary(locale);

    /** Lista com uma linha; `trash` devolve a mesma linha já na lixeira. */
    const installList = () =>
      requestJsonMock.mockImplementation(async (url: string) => ({
        items: [
          {
            id: "s-1",
            name: "Script A",
            location: "HEADER",
            priority: 1,
            status: "DRAFT",
            publishedRevisionId: null,
            createdAt: "2026-08-10T00:00:00.000Z",
            deletedAt: url.includes("trash=1")
              ? "2026-08-11T00:00:00.000Z"
              : null,
            deletedBy: null,
            scopeType: "ALL_PAGES",
            scopedPages: [],
          },
        ],
      }));

    const mountList = () =>
      mount(
        createElement(CustomCodeList, {
          bulkDictionary: panel.bulk,
          canBulk: true,
          dictionary: copy,
        }),
      );

    it("os rótulos de cancelar e de voltar são distintos (a prova não é vazia)", () => {
      expect(copy.cancel).not.toBe(copy.back);
    });

    it("a lixeira unitária dispensa com Cancelar, não com Voltar", async () => {
      installList();
      const container = await mountList();

      const trash = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${copy.moveToTrash}"]`,
      );
      expect(trash).not.toBeNull();
      await click(trash!);

      expect(byTestId(container, "confirm")).not.toBeNull();
      expect(byTestId(container, "confirm-no")?.textContent).toBe(copy.cancel);
      expect(byTestId(container, "confirm-no")?.textContent).not.toBe(
        copy.back,
      );
    });

    it("a exclusão permanente unitária dispensa com Cancelar, não com Voltar", async () => {
      installList();
      const container = await mountList();

      // Entra na lixeira (botão alternador identificado por aria-pressed).
      const toggle = container.querySelector<HTMLButtonElement>(
        "button[aria-pressed]",
      );
      expect(toggle).not.toBeNull();
      await click(toggle!);
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 260));
      });

      const permanent = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === copy.permanentlyDelete,
      );
      expect(permanent).not.toBeUndefined();
      await click(permanent!);

      expect(byTestId(container, "confirm")).not.toBeNull();
      expect(byTestId(container, "confirm-no")?.textContent).toBe(copy.cancel);
      expect(byTestId(container, "confirm-no")?.textContent).not.toBe(
        copy.back,
      );
    });
  },
);
